/* eslint-disable camelcase -- Anthropic API parameters are snake_case */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { authorReplySchema, type AuthorModel, type AuthorReply, type AuthorSession, type TokenUsage } from './model.js';

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
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16_000,
        system: this.system,
        messages: this.messages,
        // Cache the system prompt and conversation so follow-up turns are cheap.
        cache_control: { type: 'ephemeral' },
        output_config: { effort: this.effort, format: betaZodOutputFormat(authorReplySchema) },
        // If a safety classifier declines, let the API retry on its recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (error) {
      throw new AuthorApiError(describeApiError(error), { cause: error });
    }

    this.totals.inputTokens += response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0);
    this.totals.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    this.totals.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') {
      throw new AuthorApiError('The model declined this request. Try rewording the test description.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AuthorApiError('The model ran out of output space. Try splitting the test into smaller tests.');
    }
    // Keep the full content (including thinking blocks) so the next turn continues the same conversation.
    this.messages.push({ role: 'assistant', content: response.content });
    if (!response.parsed_output) throw new AuthorApiError('The model returned a reply that could not be read.');
    return response.parsed_output;
  }

  public usage(): TokenUsage {
    return { ...this.totals };
  }
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
