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

/** One test found in a draft document by the splitter. */
export const draftTestsSchema = z.object({
  tests: z.array(z.object({ name: z.string(), description: z.string() })),
});

export type DraftCase = z.infer<typeof draftTestsSchema>['tests'][number];

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
  /** One-shot call that splits a draft document into separate test descriptions. */
  splitDraft(system: string, document: string): Promise<{ tests: DraftCase[]; usage: TokenUsage }>;
};
