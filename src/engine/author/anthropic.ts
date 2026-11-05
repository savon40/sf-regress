/* eslint-disable camelcase -- Anthropic API parameters are snake_case */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  authorReplySchema,
  draftTestsSchema,
  type AuthorModel,
  type AuthorReply,
  type AuthorSession,
  type DraftCase,
  type TokenUsage,
} from './model.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export type AnthropicModelOptions = {
  /** The user's own key. Never stored or logged. */
  apiKey: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

/** AuthorModel backed by the Anthropic Messages API, with structured (JSON) replies. */
export function anthropicModel(options: AnthropicModelOptions): AuthorModel {
  const client = new Anthropic({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? 'medium';
  return {
    name: model,
    startSession: (system) => new AnthropicSession(client, model, effort, system),
    async splitDraft(system, document): Promise<{ tests: DraftCase[]; usage: TokenUsage }> {
      const { parsed, usage } = await call(client, {
        model,
        effort: 'low',
        system,
        messages: [{ role: 'user', content: document }],
        schema: draftTestsSchema,
      });
      return { tests: parsed.tests, usage };
    },
  };
}

export class AuthorApiError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthorApiError';
  }
}

class AnthropicSession implements AuthorSession {
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];
  private readonly totals: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  public constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly effort: NonNullable<AnthropicModelOptions['effort']>,
    private readonly system: string
  ) {}

  public async send(message: string): Promise<AuthorReply> {
    this.messages.push({ role: 'user', content: message });
    const { parsed, usage, content } = await call(this.client, {
      model: this.model,
      effort: this.effort,
      system: this.system,
      messages: this.messages,
      schema: authorReplySchema,
    });
    this.totals.inputTokens += usage.inputTokens;
    this.totals.cacheReadTokens += usage.cacheReadTokens;
    this.totals.outputTokens += usage.outputTokens;
    // Keep the full content (including thinking blocks) so the next turn continues the same conversation.
    this.messages.push({ role: 'assistant', content });
    return parsed;
  }

  public usage(): TokenUsage {
    return { ...this.totals };
  }
}

type CallOptions<T> = {
  model: string;
  effort: NonNullable<AnthropicModelOptions['effort']>;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: z.ZodType<T>;
};

/** One structured-output request, with friendly errors. */
async function call<T>(
  client: Anthropic,
  options: CallOptions<T>
): Promise<{ parsed: T; usage: TokenUsage; content: Anthropic.Beta.BetaContentBlock[] }> {
  let response;
  try {
    response = await client.beta.messages.parse({
      model: options.model,
      max_tokens: 16_000,
      system: options.system,
      messages: options.messages,
      // Cache the system prompt and conversation so follow-up turns are cheap.
      cache_control: { type: 'ephemeral' },
      output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
      // If a safety classifier declines, let the API retry on its recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (error) {
    throw new AuthorApiError(describeApiError(error), { cause: error });
  }

  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    outputTokens: response.usage.output_tokens,
  };
  if (response.stop_reason === 'refusal') {
    throw new AuthorApiError('The model declined this request. Try rewording the test description.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AuthorApiError('The model ran out of output space. Try splitting the input into smaller pieces.');
  }
  if (!response.parsed_output) throw new AuthorApiError('The model returned a reply that could not be read.');
  return { parsed: response.parsed_output, usage, content: response.content };
}

function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY (in your environment or .env).';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return `Your Anthropic API key can't use this model: ${error.message}`;
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `Model not found - check --model: ${error.message}`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit reached. Wait a minute and try again.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error${error.status ? ` ${error.status}` : ''}: ${error.message}`;
  }
  return `Could not reach the Anthropic API: ${(error as Error).message}`;
}
