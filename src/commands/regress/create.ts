import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Args } from '@oclif/core';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  anthropicModel,
  authorTest,
  connectionMetadata,
  DEFAULT_MODEL,
  slug,
  type AuthorResult,
  type AuthorStatus,
  type TokenUsage,
} from '../../engine/index.js';
import { AuthorCli } from '../../cli/author.js';
import { withHeader } from '../../cli/header.js';
import { displayPath, formatTestResult } from '../../cli/output.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-regress', 'regress.create');

export type RegressCreateResult = {
  status: AuthorStatus;
  file?: string;
  name?: string;
  notes: string[];
  questions: string[];
  verified?: boolean;
  model: string;
  usage: TokenUsage;
};

export default class RegressCreate extends SfCommand<RegressCreateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    description: Args.string({ description: messages.getMessage('args.description.summary'), required: true }),
  };

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    name: Flags.string({ char: 'n', summary: messages.getMessage('flags.name.summary') }),
    output: Flags.file({ char: 'f', summary: messages.getMessage('flags.output.summary') }),
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

  public async run(): Promise<RegressCreateResult> {
    const { args, flags } = await this.parse(RegressCreate);

    const apiKey = this.author.apiKey(flags['api-key']);
    if (flags.output && existsSync(flags.output) && !flags.force) {
      throw new SfError(messages.getMessage('error.exists', [flags.output]), 'FileExists');
    }

    const targetOrg = flags['target-org'];
    const conn = targetOrg.getConnection(flags['api-version']);
    const verify = await this.author.verification(targetOrg, conn, flags);
    const ask = this.author.asker(flags.prompt);

    this.spinner.start('Starting');
    const result = await this.author
      .withApiErrors(() =>
        authorTest({
          request: args.description,
          name: flags.name,
          model: anthropicModel({ apiKey, model: flags.model }),
          metadata: connectionMetadata(conn),
          ask,
          verify,
          onProgress: (message) => {
            this.spinner.status = message;
          },
        })
      )
      .finally(() => this.spinner.stop());

    const base = {
      status: result.status,
      notes: result.notes,
      questions: result.questions,
      model: result.model,
      usage: result.usage,
    };

    if (result.status === 'questions' || !result.yaml || !result.test) {
      this.author.logQuestions(result.questions);
      this.warn(messages.getMessage('error.questions'));
      this.author.logUsage(result.model, result.usage);
      process.exitCode = 1;
      return base;
    }

    // Save.
    const name = result.test.name;
    const file = flags.output ?? join(flags['tests-dir'], `${slug(name)}.yaml`);
    if (!flags.output && existsSync(file) && !flags.force) {
      throw new SfError(messages.getMessage('error.exists', [file]), 'FileExists');
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      withHeader(result.yaml, {
        origin: 'Created with "sf regress create"',
        description: args.description,
        notes: result.notes,
        status: result.status,
      })
    );

    const verified = this.report(result, file);
    return { ...base, file, name, verified };
  }

  /** Prints the outcome of a saved test; returns whether it passed verification (undefined if not run). */
  private report(result: AuthorResult, file: string): boolean | undefined {
    if (result.verification) formatTestResult(result.verification).forEach((line) => this.log(line));
    this.log(`Saved ${StandardColors.success(displayPath(file))} (${result.test?.steps.length ?? 0} steps)`);
    for (const note of result.notes) this.log(`  - ${note}`);

    if (result.status === 'created') {
      this.log(
        StandardColors.success(
          result.verification ? 'The test runs cleanly against the org.' : 'Not run against the org (--no-verify).'
        )
      );
    } else if (result.status === 'org_mismatch') {
      this.warn(
        'The test is saved, but the org does not behave as described, so it fails. Check whether the test or the org is wrong.'
      );
    } else {
      this.warn('The test is saved, but it still fails after the AI tried to fix it. Review the failed step above.');
      process.exitCode = 1;
    }

    this.author.logUsage(result.model, result.usage);
    return result.verification ? result.status === 'created' : undefined;
  }
}
