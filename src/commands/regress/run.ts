import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  connectionClient,
  findTestFiles,
  isProduction,
  loadTestFile,
  runTests,
  TestFileError,
  type RunEvent,
  type RunSummary,
  type StepResult,
  type TestDefinition,
  type TestResult,
} from '../../engine/index.js';

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
  };

  public async run(): Promise<RegressRunResult> {
    const { flags } = await this.parse(RegressRun);

    const tests = await this.loadTests(flags.test, flags['tests-dir'], flags.suite);
    const client = connectionClient(flags['target-org'].getConnection(flags['api-version']));

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
      onEvent: (event) => this.print(event),
    });

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
    if (event.type !== 'test:end') return;
    const { result } = event;
    const mark = result.status === 'passed' ? StandardColors.success('✔') : StandardColors.error('✘');
    const file = result.file ? `  ${result.file}` : '';
    this.log(`${mark} ${result.name}  (${(result.durationMs / 1000).toFixed(1)}s)${file}`);
    if (result.error) this.log(`    ${StandardColors.error(result.error)}`);
    for (const step of result.steps) this.log(`    ${formatStep(step)}`);
    this.log(`    ${formatCleanup(result)}`);
    this.log('');
  }
}

/** Show paths relative to the current folder when they're inside it, absolute otherwise. */
function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : resolve(path);
}

function formatStep(step: StepResult): string {
  const title = `${step.index}. ${step.name ? `${step.name} (${step.type})` : step.type}`;
  if (step.status === 'skipped') return `-  ${title}  skipped`;
  if (step.status === 'failed') {
    const where = step.line ? ` [line ${step.line}]` : '';
    return `${StandardColors.error('✘')}  ${title}${where}\n       ${StandardColors.error(step.error ?? 'failed')}`;
  }
  return `${StandardColors.success('✔')}  ${title}${step.detail ? `  ${step.detail}` : ''}`;
}

function formatCleanup(result: TestResult): string {
  const { deleted, errors } = result.cleanup;
  if (deleted.length === 0 && errors.length === 0) return 'cleanup: nothing to delete';
  const text = `cleanup: deleted ${deleted.length} record${deleted.length === 1 ? '' : 's'}`;
  if (errors.length === 0) return text;
  const failures = errors.map((e) => `\n       could not delete ${e.sobject} ${e.id}: ${e.error}`).join('');
  return StandardColors.warning(`${text}, ${errors.length} failed${failures}`);
}
