import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Args } from '@oclif/core';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  anthropicModel,
  AuthorApiError,
  authorTest,
  connectionClient,
  connectionMetadata,
  DEFAULT_MODEL,
  isProduction,
  slug,
  type AuthorResult,
  type AuthorStatus,
  type TokenUsage,
} from '../../engine/index.js';
import { MissingApiKeyError, resolveApiKey } from '../../cli/api-key.js';
import { browserFor } from '../../cli/org-browser.js';
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

  public async run(): Promise<RegressCreateResult> {
    const { args, flags } = await this.parse(RegressCreate);

    const apiKey = this.apiKey(flags['api-key']);
    if (flags.output && existsSync(flags.output) && !flags.force) {
      throw new SfError(messages.getMessage('error.exists', [flags.output]), 'FileExists');
    }

    const targetOrg = flags['target-org'];
    const conn = targetOrg.getConnection(flags['api-version']);
    const client = connectionClient(conn);
    if (flags.verify) {
      const org = await client.getOrgInfo();
      if (isProduction(org) && !flags['allow-production']) {
        throw new SfError(messages.getMessage('error.production', [org.name]), 'ProductionOrg');
      }
    }

    const interactive = flags.prompt && !this.jsonEnabled() && Boolean(process.stdin.isTTY);
    this.spinner.start('Starting');
    let result;
    try {
      result = await authorTest({
        request: args.description,
        name: flags.name,
        model: anthropicModel({ apiKey, model: flags.model }),
        metadata: connectionMetadata(conn),
        ask: interactive ? (questions): Promise<string[]> => this.ask(questions) : undefined,
        verify: flags.verify
          ? {
              client,
              options: {
                allowProduction: flags['allow-production'],
                browser: browserFor(targetOrg, conn, true),
                resultsDir: 'regress-results',
              },
            }
          : undefined,
        onProgress: (message) => {
          this.spinner.status = message;
        },
      });
    } catch (error) {
      if (error instanceof AuthorApiError) throw new SfError(error.message, 'AnthropicApiError');
      throw error;
    } finally {
      this.spinner.stop();
    }

    const base = {
      status: result.status,
      notes: result.notes,
      questions: result.questions,
      model: result.model,
      usage: result.usage,
    };

    if (result.status === 'questions' || !result.yaml || !result.test) {
      this.log('\nThe AI needs more detail before it can write this test:\n');
      result.questions.forEach((q, i) => this.log(`  ${i + 1}. ${q}`));
      this.log('');
      this.warn(messages.getMessage('error.questions'));
      this.logUsage(result.model, result.usage);
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
    await writeFile(file, withHeader(result.yaml, args.description, result.notes, result.status));

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

    this.logUsage(result.model, result.usage);
    return result.verification ? result.status === 'created' : undefined;
  }

  private apiKey(flag: string | undefined): string {
    try {
      const found = resolveApiKey(flag);
      if (found.warning) this.warn(found.warning);
      return found.key;
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw new SfError(error.message, 'MissingApiKey');
      throw error;
    }
  }

  private async ask(questions: string[]): Promise<string[]> {
    this.spinner.stop();
    this.log('\nThe AI has some questions (press Enter to skip one):\n');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answers: string[] = [];
    try {
      for (const [i, question] of questions.entries()) {
        // eslint-disable-next-line no-await-in-loop
        answers.push(await rl.question(`${i + 1}. ${question}\n> `));
      }
    } finally {
      rl.close();
    }
    this.log('');
    this.spinner.start('Continuing');
    return answers;
  }

  private logUsage(model: string, usage: TokenUsage): void {
    const total = usage.inputTokens + usage.cacheReadTokens;
    this.log(
      StandardColors.info(
        `${model}: ${total.toLocaleString()} input tokens (${usage.cacheReadTokens.toLocaleString()} cached), ${usage.outputTokens.toLocaleString()} output tokens`
      )
    );
  }
}

function withHeader(yaml: string, description: string, notes: string[], status: AuthorStatus): string {
  const lines = [
    `# Created with "sf regress create" on ${new Date().toISOString().slice(0, 10)} from:`,
    ...wrap(description, 90).map((line) => `#   ${line}`),
  ];
  if (status === 'org_mismatch')
    lines.push('# NOTE: this test failed its first run - the org did not behave as described.');
  if (status === 'unverified') lines.push('# NOTE: this test failed its first run and needs review.');
  if (notes.length) lines.push('# Review notes:', ...notes.map((n) => `#   - ${n}`));
  return `${lines.join('\n')}\n\n${yaml.trimEnd()}\n`;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
