import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  addUsage,
  anthropicModel,
  authorTest,
  connectionMetadata,
  DEFAULT_MODEL,
  findDrafts,
  isDraftFile,
  moveToConverted,
  readDraft,
  slug,
  splitDraft,
  type AuthorModel,
  type AuthorOptions,
  type AuthorStatus,
  type DraftCase,
  type MetadataSource,
  type TokenUsage,
} from '../../engine/index.js';
import { AuthorCli } from '../../cli/author.js';
import { withHeader } from '../../cli/header.js';
import { displayPath, formatTestResult } from '../../cli/output.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-regress', 'regress.convert');

export type ConvertedTest = {
  name: string;
  /** "exists" = skipped because the test file was already there. */
  status: AuthorStatus | 'exists';
  file?: string;
  verified?: boolean;
  notes: string[];
  questions: string[];
};

export type ConvertedDocument = {
  file: string;
  /** Where the document was moved once all its tests were saved. */
  movedTo?: string;
  tests: ConvertedTest[];
  error?: string;
};

export type RegressConvertResult = {
  documents: ConvertedDocument[];
  model: string;
  usage: TokenUsage;
};

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

export default class RegressConvert extends SfCommand<RegressConvertResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    file: Flags.file({ char: 'f', summary: messages.getMessage('flags.file.summary'), multiple: true }),
    'tests-dir': Flags.directory({
      char: 'd',
      summary: messages.getMessage('flags.tests-dir.summary'),
      default: 'tests',
    }),
    force: Flags.boolean({ summary: messages.getMessage('flags.force.summary'), default: false }),
    'api-key': Flags.string({ summary: messages.getMessage('flags.api-key.summary') }),
    model: Flags.string({ summary: messages.getMessage('flags.model.summary'), default: DEFAULT_MODEL }),
    verify: Flags.boolean({ summary: messages.getMessage('flags.verify.summary'), default: true, allowNo: true }),
    prompt: Flags.boolean({ summary: messages.getMessage('flags.prompt.summary'), default: true, allowNo: true }),
    'allow-production': Flags.boolean({
      summary: messages.getMessage('flags.allow-production.summary'),
      default: false,
    }),
  };

  private readonly author = new AuthorCli(this);
  private usage: TokenUsage = NO_USAGE;

  public async run(): Promise<RegressConvertResult> {
    const { flags } = await this.parse(RegressConvert);
    const draftsDir = join(flags['tests-dir'], 'drafts');
    const files = flags.file ?? (await findDrafts(draftsDir));
    for (const file of flags.file ?? []) {
      if (!existsSync(file)) throw new SfError(messages.getMessage('error.notFound', [file]), 'FileNotFound');
      if (!isDraftFile(file)) throw new SfError(messages.getMessage('error.fileType', [file]), 'UnsupportedFile');
    }
    if (files.length === 0) {
      this.log(`No documents to convert in ${displayPath(draftsDir)} (.docx, .md, .txt).`);
      return { documents: [], model: flags.model, usage: NO_USAGE };
    }

    const apiKey = this.author.apiKey(flags['api-key']);
    const targetOrg = flags['target-org'];
    const conn = targetOrg.getConnection(flags['api-version']);
    const context: Context = {
      model: anthropicModel({ apiKey, model: flags.model }),
      metadata: connectionMetadata(conn),
      verify: await this.author.verification(targetOrg, conn, flags),
      ask: this.author.asker(flags.prompt),
      testsDir: flags['tests-dir'],
      force: flags.force,
    };

    const documents: ConvertedDocument[] = [];
    for (const file of files) {
      // One document at a time: questions are asked in the terminal and verification uses the org.
      // eslint-disable-next-line no-await-in-loop
      documents.push(await this.convertDocument(file, context));
    }

    this.summarize(documents);
    this.author.logUsage(flags.model, this.usage);
    if (documents.some((d) => !d.movedTo)) process.exitCode = 1;
    return { documents, model: flags.model, usage: this.usage };
  }

  private async convertDocument(file: string, context: Context): Promise<ConvertedDocument> {
    this.log(StandardColors.info(`\n${displayPath(file)}`));
    const text = await readDraft(file);
    if (!text) {
      this.warn(`${displayPath(file)} is empty.`);
      return { file, tests: [], error: 'empty' };
    }

    this.spinner.start('Finding the tests in the document');
    const split = await this.author
      .withApiErrors(() => splitDraft(context.model, text))
      .finally(() => this.spinner.stop());
    this.usage = addUsage(this.usage, split.usage);
    if (split.tests.length === 0) {
      this.warn(`No tests found in ${displayPath(file)}.`);
      return { file, tests: [], error: 'no tests found' };
    }
    this.log(`Found ${split.tests.length} test${split.tests.length === 1 ? '' : 's'}.`);

    const tests: ConvertedTest[] = [];
    for (const [i, draft] of split.tests.entries()) {
      this.log(`\n[${i + 1}/${split.tests.length}] ${draft.name}`);
      // eslint-disable-next-line no-await-in-loop
      tests.push(await this.convertTest(draft, file, context));
    }

    const saved = tests.every((t) => t.file);
    const movedTo = saved ? await moveToConverted(file) : undefined;
    return { file, movedTo, tests };
  }

  private async convertTest(draft: DraftCase, source: string, context: Context): Promise<ConvertedTest> {
    const file = join(context.testsDir, `${slug(draft.name)}.yaml`);
    const base = { name: draft.name, notes: [], questions: [] };
    if (existsSync(file) && !context.force) {
      this.log(`Skipped: ${displayPath(file)} already exists (--force to overwrite).`);
      return { ...base, status: 'exists', file };
    }

    this.spinner.start('Starting');
    const result = await this.author
      .withApiErrors(() =>
        authorTest({
          request: draft.description,
          name: draft.name,
          model: context.model,
          metadata: context.metadata,
          ask: context.ask,
          verify: context.verify,
          onProgress: (message) => {
            this.spinner.status = message;
          },
        })
      )
      .finally(() => this.spinner.stop());
    this.usage = addUsage(this.usage, result.usage);
    const outcome = { ...base, status: result.status, notes: result.notes, questions: result.questions };

    if (result.status === 'questions' || !result.yaml || !result.test) {
      this.author.logQuestions(result.questions);
      this.warn('Not saved. Add these details to the document and run the command again.');
      return outcome;
    }

    await mkdir(context.testsDir, { recursive: true });
    await writeFile(
      file,
      withHeader(result.yaml, {
        origin: `Converted with "sf regress convert" from ${displayPath(source)}`,
        description: draft.description,
        notes: result.notes,
        status: result.status,
      })
    );
    if (result.verification) formatTestResult(result.verification).forEach((line) => this.log(line));
    this.log(`Saved ${StandardColors.success(displayPath(file))} (${result.test.steps.length} steps)`);
    for (const note of result.notes) this.log(`  - ${note}`);
    if (result.status === 'org_mismatch') this.warn('The org does not behave as described, so this test fails.');
    if (result.status === 'unverified') this.warn('This test still fails after the AI tried to fix it. Review it.');
    const verified = result.verification ? result.status === 'created' : undefined;
    return { ...outcome, file, verified };
  }

  private summarize(documents: ConvertedDocument[]): void {
    const tests = documents.flatMap((d) => d.tests);
    const count = (status: ConvertedTest['status']): number => tests.filter((t) => t.status === status).length;
    this.log(StandardColors.info('\nSummary'));
    for (const doc of documents) {
      const where = doc.movedTo
        ? `moved to ${displayPath(doc.movedTo)}`
        : StandardColors.warning(doc.error ?? 'left in place: some tests were not saved');
      this.log(`  ${displayPath(doc.file)}: ${where}`);
    }
    const parts = [
      `${count('created')} written`,
      count('org_mismatch') ? `${count('org_mismatch')} where the org behaves differently` : '',
      count('unverified') ? `${count('unverified')} still failing` : '',
      count('questions') ? `${count('questions')} needing answers` : '',
      count('exists') ? `${count('exists')} already existed` : '',
    ].filter(Boolean);
    this.log(`  Tests: ${parts.join(', ')}`);
  }
}

type Context = {
  model: AuthorModel;
  metadata: MetadataSource;
  verify: AuthorOptions['verify'];
  ask: AuthorOptions['ask'];
  testsDir: string;
  force: boolean;
};
