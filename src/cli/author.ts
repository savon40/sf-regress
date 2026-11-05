import { createInterface } from 'node:readline/promises';
import { StandardColors, type SfCommand } from '@salesforce/sf-plugins-core';
import { Connection, Messages, Org, SfError } from '@salesforce/core';
import {
  AuthorApiError,
  connectionClient,
  isProduction,
  type AuthorOptions,
  type TokenUsage,
} from '../engine/index.js';
import { MissingApiKeyError, resolveApiKey } from './api-key.js';
import { browserFor } from './org-browser.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-regress', 'regress.author');

/** What `sf regress create` and `sf regress convert` share: API key, production check, questions, usage. */
export class AuthorCli {
  public constructor(private readonly cmd: SfCommand<unknown>) {}

  public apiKey(flag: string | undefined): string {
    try {
      const found = resolveApiKey(flag);
      if (found.warning) this.cmd.warn(found.warning);
      return found.key;
    } catch (error) {
      if (error instanceof MissingApiKeyError) throw new SfError(error.message, 'MissingApiKey');
      throw error;
    }
  }

  /**
   * The verification setup for authorTest, or undefined with --no-verify.
   * Refuses production orgs unless allowed, because the check creates real records.
   */
  // eslint-disable-next-line class-methods-use-this
  public async verification(
    targetOrg: Org,
    conn: Connection,
    flags: { verify: boolean; 'allow-production': boolean }
  ): Promise<AuthorOptions['verify']> {
    if (!flags.verify) return undefined;
    const client = connectionClient(conn);
    const org = await client.getOrgInfo();
    if (isProduction(org) && !flags['allow-production']) {
      throw new SfError(messages.getMessage('error.production', [org.name]), 'ProductionOrg');
    }
    return {
      client,
      options: {
        allowProduction: flags['allow-production'],
        browser: browserFor(targetOrg, conn, true),
        resultsDir: 'regress-results',
      },
    };
  }

  /** A question asker when we can talk to the person in the terminal, otherwise undefined. */
  public asker(prompt: boolean): AuthorOptions['ask'] {
    const interactive = prompt && !this.cmd.jsonEnabled() && Boolean(process.stdin.isTTY);
    return interactive ? (questions): Promise<string[]> => this.ask(questions) : undefined;
  }

  /** Turns Anthropic API errors into sf errors. */
  // eslint-disable-next-line class-methods-use-this
  public async withApiErrors<R>(work: () => Promise<R>): Promise<R> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AuthorApiError) throw new SfError(error.message, 'AnthropicApiError');
      throw error;
    }
  }

  public logQuestions(questions: string[]): void {
    this.cmd.log('\nThe AI needs more detail before it can write this test:\n');
    questions.forEach((q, i) => this.cmd.log(`  ${i + 1}. ${q}`));
    this.cmd.log('');
  }

  public logUsage(model: string, usage: TokenUsage): void {
    const total = usage.inputTokens + usage.cacheReadTokens;
    this.cmd.log(
      StandardColors.info(
        `${model}: ${total.toLocaleString()} input tokens (${usage.cacheReadTokens.toLocaleString()} cached), ${usage.outputTokens.toLocaleString()} output tokens`
      )
    );
  }

  private async ask(questions: string[]): Promise<string[]> {
    const status = this.cmd.spinner.status;
    this.cmd.spinner.stop();
    this.cmd.log('\nThe AI has some questions (press Enter to skip one):\n');
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
    this.cmd.log('');
    this.cmd.spinner.start(status ?? 'Continuing');
    return answers;
  }
}
