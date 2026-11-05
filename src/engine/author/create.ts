import { parseTest } from '../loader.js';
import { runTests, type RunOptions } from '../runner.js';
import type { OrgClient, TestDefinition, TestResult } from '../types.js';
import type { AuthorModel, AuthorReply, AuthorSession, TokenUsage } from './model.js';
import {
  findMentionedObjects,
  formatOrgContext,
  listObjects,
  loadOrgContext,
  type MetadataSource,
  type ObjectSummary,
} from './org-context.js';
import { firstMessage, SYSTEM_PROMPT } from './prompt.js';

/**
 * Turns a plain-English description into a YAML test:
 * org metadata -> AI draft -> validate -> (questions / more metadata) -> verification run -> fixes.
 * Shared by `sf regress create` and `sf regress convert`.
 */

export type AuthorOptions = {
  /** Plain-English description of the test. */
  request: string;
  /** Test name to use (otherwise the AI picks one). */
  name?: string;
  model: AuthorModel;
  metadata: MetadataSource;
  /**
   * Asks the person the AI's questions and returns their answers (one per question).
   * Without it, questions end the run with status "questions".
   */
  ask?: (questions: string[]) => Promise<string[]>;
  /** Verification run against the org. Omit to skip verification. */
  verify?: { client: OrgClient; options?: RunOptions };
  /** Progress messages for a spinner. */
  onProgress?: (message: string) => void;
  /** Limits, overridable for tests. */
  maxFixes?: number;
  maxObjectRequests?: number;
  maxQuestionRounds?: number;
};

export type AuthorStatus =
  /** Draft passed verification (or verification was skipped). */
  | 'created'
  /** The test looks right but the org doesn't behave as described. The YAML is still returned. */
  | 'org_mismatch'
  /** Verification still fails after the allowed fixes. The last YAML is returned. */
  | 'unverified'
  /** The AI needs answers and no `ask` was given (or the person gave none). */
  | 'questions';

export type AuthorResult = {
  status: AuthorStatus;
  yaml?: string;
  test?: TestDefinition;
  notes: string[];
  questions: string[];
  /** Verification result of the last draft, if it ran. */
  verification?: TestResult;
  usage: TokenUsage;
  model: string;
};

export async function authorTest(options: AuthorOptions): Promise<AuthorResult> {
  const progress = options.onProgress ?? ((): void => {});
  progress('Reading org metadata');
  const objects = await listObjects(options.metadata);
  const mentioned = findMentionedObjects(options.request, objects);
  const context = await loadOrgContext(options.metadata, mentioned);

  const author = new Author(options, objects, new Set(mentioned), progress);
  progress(`Drafting the test with ${options.model.name}`);
  let reply = await author.session.send(
    firstMessage({
      request: options.request,
      name: options.name,
      objectList: objects.filter((o) => !mentioned.includes(o.name)),
      orgContext: formatOrgContext(context),
    })
  );
  // One reply at a time: each handler either finishes or sends the next message.
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const step = await author.handle(reply);
    if ('done' in step) return step.done;
    reply = step.next;
  }
}

type Step = { next: AuthorReply } | { done: AuthorResult };

/** State of one authoring conversation, and how each kind of reply is handled. */
class Author {
  public readonly session: AuthorSession;
  private fixes = 0;
  private objectRequests = 0;
  private questionRounds = 0;
  private readonly maxFixes: number;
  private readonly maxObjectRequests: number;
  private readonly maxQuestionRounds: number;

  public constructor(
    private readonly options: AuthorOptions,
    private readonly objects: ObjectSummary[],
    private readonly loaded: Set<string>,
    private readonly progress: (message: string) => void
  ) {
    this.session = options.model.startSession(SYSTEM_PROMPT);
    this.maxFixes = options.maxFixes ?? 3;
    this.maxObjectRequests = options.maxObjectRequests ?? 2;
    this.maxQuestionRounds = options.maxQuestionRounds ?? 2;
  }

  public async handle(reply: AuthorReply): Promise<Step> {
    if (reply.kind === 'need_objects') return this.needObjects(reply);
    if (reply.kind === 'questions') return this.questions(reply);
    return this.draft(reply);
  }

  private result(status: AuthorStatus, extra: Partial<AuthorResult> = {}): { done: AuthorResult } {
    return {
      done: {
        status,
        notes: [],
        questions: [],
        usage: this.session.usage(),
        model: this.options.model.name,
        ...extra,
      },
    };
  }

  private async send(message: string): Promise<Step> {
    return { next: await this.session.send(message) };
  }

  private async needObjects(reply: AuthorReply): Promise<Step> {
    const wanted = knownObjects(reply.objects, this.objects).filter((name) => !this.loaded.has(name));
    const allowed = this.objectRequests < this.maxObjectRequests;
    this.objectRequests++;
    if (wanted.length === 0) {
      return this.send(
        `None of these are objects in this org that you haven't been given already: ${reply.objects.join(
          ', '
        )}. Write the test with the metadata you have, or ask questions.`
      );
    }
    if (!allowed)
      return this.send('No more metadata can be loaded. Write the test with what you have, or ask questions.');
    this.progress(`Reading metadata for ${wanted.join(', ')}`);
    wanted.forEach((name) => this.loaded.add(name));
    const more = await loadOrgContext(this.options.metadata, wanted);
    return this.send(`# More org metadata\n${formatOrgContext(more)}`);
  }

  private async questions(reply: AuthorReply): Promise<Step> {
    // Strip any numbering the model added; the CLI numbers them.
    const questions = reply.questions.map((q) => q.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
    const { ask } = this.options;
    if (!ask || this.questionRounds >= this.maxQuestionRounds || questions.length === 0) {
      return this.result('questions', { questions, notes: reply.notes });
    }
    this.questionRounds++;
    const answers = await ask(questions);
    if (answers.every((a) => !a.trim())) return this.result('questions', { questions, notes: reply.notes });
    this.progress('Updating the test with your answers');
    return this.send(formatAnswers(questions, answers));
  }

  /** A test (or org_mismatch): validate the YAML, then verify it against the org. */
  private async draft(reply: AuthorReply): Promise<Step> {
    const { yaml, notes } = reply;
    const parsed = tryParse(yaml);
    if ('error' in parsed) {
      if (this.fixes >= this.maxFixes) return this.result('unverified', { yaml, notes: [...notes, parsed.error] });
      this.fixes++;
      this.progress('Fixing the test file format');
      return this.send(`The YAML is not a valid test:\n${parsed.error}\n\nReply with the full corrected test.`);
    }
    const { test } = parsed;
    if (reply.kind === 'org_mismatch') return this.result('org_mismatch', { yaml, test, notes });
    const { verify } = this.options;
    if (!verify) return this.result('created', { yaml, test, notes });

    this.progress('Running the test against the org to check it');
    const verification = (await runTests([test], verify.client, verify.options)).tests[0];
    if (verification.status === 'passed') return this.result('created', { yaml, test, notes, verification });
    if (this.fixes >= this.maxFixes) return this.result('unverified', { yaml, test, notes, verification });
    this.fixes++;
    this.progress(`Fixing a failed step (attempt ${this.fixes} of ${this.maxFixes})`);
    return this.send(formatFailure(verification));
  }
}

export function formatAnswers(questions: string[], answers: string[]): string {
  const lines = questions.map(
    (q, i) => `Q: ${q}\nA: ${answers[i]?.trim() || '(no answer - use your best judgment and say so in notes)'}`
  );
  return `Answers to your questions:\n\n${lines.join('\n\n')}\n\nNow write the test.`;
}

/** The verification failure, as the AI sees it: which step failed, where, and why. */
export function formatFailure(result: TestResult): string {
  const lines = ['The verification run failed.'];
  if (result.error) lines.push(`Test error: ${result.error}`);
  for (const step of result.steps) {
    const where = step.line ? ` (line ${step.line})` : '';
    const label = `${step.index}. ${step.type}${step.name ? ` "${step.name}"` : ''}${where}`;
    if (step.status === 'failed') lines.push(`FAILED ${label}: ${step.error ?? 'failed'}`);
    else if (step.status === 'passed') lines.push(`passed ${label}${step.detail ? ` - ${step.detail}` : ''}`);
    else lines.push(`skipped ${label}`);
  }
  for (const error of result.cleanup.errors) lines.push(`Cleanup could not delete ${error.sobject}: ${error.error}`);
  lines.push(
    '',
    'If the test is written wrong, reply with the full corrected test. If the org just behaves differently from the description, reply with kind "org_mismatch".'
  );
  return lines.join('\n');
}

function tryParse(yaml: string): { test: TestDefinition } | { error: string } {
  if (!yaml.trim()) return { error: 'The reply had no YAML.' };
  try {
    // Not saved yet, so no file name in the verification output.
    return { test: { ...parseTest(yaml, 'draft.yaml'), file: undefined } };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Object names the AI asked for, matched case-insensitively against the org's objects. */
function knownObjects(names: string[], objects: ObjectSummary[]): string[] {
  const byLower = new Map(objects.map((o) => [o.name.toLowerCase(), o.name]));
  return [...new Set(names.map((n) => byLower.get(n.trim().toLowerCase())).filter((n): n is string => Boolean(n)))];
}
