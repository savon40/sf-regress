import { z } from 'zod';

/** What the AI sends back on each turn. See "Your reply" in prompt.ts. */
export const authorReplySchema = z.object({
  kind: z.enum(['test', 'questions', 'need_objects', 'org_mismatch']),
  yaml: z.string(),
  questions: z.array(z.string()),
  objects: z.array(z.string()),
  notes: z.array(z.string()),
});

export type AuthorReply = z.infer<typeof authorReplySchema>;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

/** One conversation with the model. Keeps its own history. */
export type AuthorSession = {
  send(message: string): Promise<AuthorReply>;
  usage(): TokenUsage;
};

/** The AI that drafts tests. Implemented with the Anthropic SDK in anthropic.ts; mocked in unit tests. */
export type AuthorModel = {
  readonly name: string;
  startSession(system: string): AuthorSession;
};
