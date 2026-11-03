import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  connectionClient,
  findTestFiles,
  isProduction,
  loadTestFile,
  runTests,
  TestFileError,
  toJUnitXml,
  type RunEvent,
  type RunSummary,
  type TestDefinition,
} from '../../engine/index.js';
import { browserFor } from '../../cli/org-browser.js';
import { displayPath, formatTestResult } from '../../cli/output.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-regress', 'regress.run');

export type RegressRunResult = RunSummary;

export default class RegressRun extends SfCommand<RegressRunResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    test: Flags.file({
      char: 't',
      summary: messages.getMessage('flags.test.summary'),
      multiple: true,
      exists: true,
    }),
    suite: Flags.string({
      char: 's',
      summary: messages.getMessage('flags.suite.summary'),
    }),
    'tests-dir': Flags.directory({
      char: 'd',
      summary: messages.getMessage('flags.tests-dir.summary'),
      default: 'tests',
    }),
    'allow-production': Flags.boolean({
      summary: messages.getMessage('flags.allow-production.summary'),
      default: false,
    }),
    headed: Flags.boolean({
      summary: messages.getMessage('flags.headed.summary'),
      default: false,
    }),
    'results-dir': Flags.directory({
      summary: messages.getMessage('flags.results-dir.summary'),
      default: 'regress-results',
    }),
    junit: Flags.file({
      summary: messages.getMessage('flags.junit.summary'),
    }),
  };

  public async run(): Promise<RegressRunResult> {
    const { flags } = await this.parse(RegressRun);

    const tests = await this.loadTests(flags.test, flags['tests-dir'], flags.suite);
    const targetOrg = flags['target-org'];
    const conn = targetOrg.getConnection(flags['api-version']);
    const client = connectionClient(conn);

    const org = await client.getOrgInfo();
    this.log(
      `Running ${tests.length} test${tests.length === 1 ? '' : 's'} against ${org.username ?? org.name} (${
        org.organizationType
      }${org.isSandbox ? ', sandbox' : ''})`
    );
    if (isProduction(org)) {
      this.warn(
        flags['allow-production']
          ? 'This is a PRODUCTION org. Running because --allow-production was passed.'
          : 'This is a PRODUCTION org. Only tests with "allowProduction: true" will run.'
      );
    }
    this.log('');

    const summary = await runTests(tests, client, {
      allowProduction: flags['allow-production'],
      resultsDir: flags['results-dir'],
      onEvent: (event) => this.print(event),
      // Opened only if a test has browser steps. Logs in with the CLI's existing session.
      browser: browserFor(targetOrg, conn, !flags.headed),
    });

    if (flags.junit) {
      await mkdir(dirname(flags.junit), { recursive: true });
      await writeFile(flags.junit, toJUnitXml(summary));
      this.log(`JUnit report: ${flags.junit}`);
    }

    const seconds = (summary.durationMs / 1000).toFixed(1);
    const parts = [StandardColors.success(`${summary.passed} passed`)];
    if (summary.failed) parts.push(StandardColors.error(`${summary.failed} failed`));
    this.log(`${parts.join(', ')} (${seconds}s)`);

    if (summary.failed > 0) process.exitCode = 1;
    return summary;
  }

  private async loadTests(
    files: string[] | undefined,
    testsDir: string,
    suite: string | undefined
  ): Promise<TestDefinition[]> {
    let paths = files;
    if (!paths?.length) {
      if (!existsSync(testsDir)) throw new SfError(messages.getMessage('error.noTestsDir', [testsDir]), 'NoTestsDir');
      paths = await findTestFiles(testsDir);
    }

    const tests: TestDefinition[] = [];
    const invalid: TestFileError[] = [];
    for (const path of paths) {
      try {
        // eslint-disable-next-line no-await-in-loop
        tests.push(await loadTestFile(displayPath(path)));
      } catch (error) {
        if (error instanceof TestFileError) invalid.push(error);
        else throw error;
      }
    }

    if (invalid.length > 0) {
      for (const error of invalid) this.log(StandardColors.error(error.message));
      throw new SfError(messages.getMessage('error.invalidTests', [invalid.length]), 'InvalidTests');
    }

    const selected = suite ? tests.filter((t) => t.tags.includes(suite)) : tests;
    if (selected.length === 0) {
      throw new SfError(messages.getMessage('error.noTests', [suite ? ` with tag "${suite}"` : '']), 'NoTests');
    }
    return selected;
  }

  private print(event: RunEvent): void {
    if (event.type === 'test:end') formatTestResult(event.result).forEach((line) => this.log(line));
  }
}
