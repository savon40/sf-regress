import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { CleanupTracker } from './cleanup.js';
import { getStepType } from './steps/registry.js';
import type { StepContext } from './steps/step.js';
import type {
  BrowserSession,
  OrgClient,
  OrgInfo,
  RunSummary,
  StepResult,
  TestDefinition,
  TestResult,
} from './types.js';
import { Variables } from './variables.js';

export type RunEvent =
  | { type: 'test:start'; test: TestDefinition }
  | { type: 'step:end'; test: TestDefinition; step: StepResult }
  | { type: 'test:end'; test: TestDefinition; result: TestResult };

export type RunOptions = {
  /** Allow running against a production org (`--allow-production`). */
  allowProduction?: boolean;
  /** Called as tests and steps finish, so a CLI can print progress. */
  onEvent?: (event: RunEvent) => void;
  /**
   * Opens a logged-in browser. Called once, on the first browser step of the run.
   * Without it, browser steps fail with a clear message.
   */
  browser?: () => Promise<BrowserSession>;
  /** Folder for screenshots of failed steps. No screenshots when unset. */
  resultsDir?: string;
  /** Overridable for tests. */
  now?: () => Date;
  runId?: string;
};

/** Opens the browser session on first use and shares it across tests in a run. */
class SessionHolder {
  private session?: Promise<BrowserSession>;

  public constructor(private readonly factory?: () => Promise<BrowserSession>) {}

  public get(): Promise<BrowserSession> {
    if (!this.factory) {
      return Promise.reject(new Error('Browser steps need a browser, but this run was started without one'));
    }
    this.session ??= this.factory();
    return this.session;
  }

  public async close(): Promise<void> {
    if (this.session) await (await this.session.catch(() => undefined))?.close();
    this.session = undefined;
  }
}

/**
 * Production = not a sandbox, not a Developer Edition (which includes scratch orgs),
 * and not a trial. When in doubt, treat it as production.
 */
export function isProduction(org: OrgInfo): boolean {
  return !org.isSandbox && org.organizationType !== 'Developer Edition' && !org.trialExpirationDate;
}

/** Short unique id for this run, used as $run.id to keep record names unique across runs. */
export function newRunId(): string {
  return randomBytes(4).toString('hex');
}

export async function runTests(
  tests: TestDefinition[],
  client: OrgClient,
  options: RunOptions = {}
): Promise<RunSummary> {
  const started = Date.now();
  const org = await client.getOrgInfo();
  const runId = options.runId ?? newRunId();
  const results: TestResult[] = [];
  const sessions = new SessionHolder(options.browser);

  try {
    for (const test of tests) {
      // Sequential: tests share one org and may depend on its state.
      // eslint-disable-next-line no-await-in-loop
      results.push(await runTest(test, client, org, { ...options, runId }, sessions));
    }
  } finally {
    await sessions.close();
  }

  return {
    org,
    runId,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    durationMs: Date.now() - started,
    tests: results,
  };
}

export async function runTest(
  test: TestDefinition,
  client: OrgClient,
  org: OrgInfo,
  options: RunOptions = {},
  sessions: SessionHolder = new SessionHolder(options.browser)
): Promise<TestResult> {
  const started = Date.now();
  const emit = options.onEvent ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const runId = options.runId ?? newRunId();
  const vars = new Variables(now);
  const cleanup = new CleanupTracker();
  const steps: StepResult[] = [];

  // The test's browser page, opened on the first browser step.
  let page: Promise<{ page: Page; baseUrl: string }> | undefined;
  const browser = (): Promise<{ page: Page; baseUrl: string }> => {
    page ??= sessions.get().then(async (session) => ({ page: await session.newPage(), baseUrl: session.baseUrl }));
    return page;
  };
  const ctx: Omit<StepContext, 'raw'> = { client, vars, cleanup, org, startedAt: new Date(started), browser };

  emit({ type: 'test:start', test });

  let error = prepare(test, org, options, vars, { id: runId, date: now(), startedAt: new Date(started) });

  try {
    let failed = error !== undefined;
    for (const [index, step] of test.steps.entries()) {
      const base = { index: index + 1, type: step.type, name: step.name, line: step.line };
      if (failed) {
        steps.push({ ...base, status: 'skipped', durationMs: 0 });
        continue;
      }
      // Steps run in order; each may depend on variables set by the previous one.
      // eslint-disable-next-line no-await-in-loop
      const result = await runStep(step, base, ctx);
      if (result.status === 'failed' && page && options.resultsDir) {
        // eslint-disable-next-line no-await-in-loop
        result.screenshot = await screenshot(page, options.resultsDir, `${slug(test.name)}-step${base.index}.png`);
      }
      steps.push(result);
      emit({ type: 'step:end', test, step: result });
      failed = result.status === 'failed';
    }
  } catch (e) {
    // runStep catches step errors; this guards against anything unexpected so cleanup still runs.
    error = `Unexpected error: ${message(e)}`;
  }

  if (page) await (await page.catch(() => undefined))?.page.close().catch(() => {});
  const cleanupResult = await cleanup.run(client);
  const status = error === undefined && steps.every((s) => s.status === 'passed') ? 'passed' : 'failed';
  const result: TestResult = {
    name: test.name,
    file: test.file,
    status,
    durationMs: Date.now() - started,
    steps,
    cleanup: cleanupResult,
    ...(error ? { error } : {}),
  };
  emit({ type: 'test:end', test, result });
  return result;
}

/** Production check and built-in/param variables. Returns an error message if the test can't start. */
function prepare(
  test: TestDefinition,
  org: OrgInfo,
  options: RunOptions,
  vars: Variables,
  run: { id: string; date: Date; startedAt: Date }
): string | undefined {
  if (isProduction(org) && !options.allowProduction && !test.allowProduction) {
    return `Refusing to run against production org ${org.name} (${org.orgId}). Use --allow-production or set "allowProduction: true" in the test.`;
  }
  try {
    vars.set('run', {
      id: run.id,
      date: run.date.toISOString().slice(0, 10),
      // SOQL datetime literal format, e.g. 2026-11-03T15:11:14Z
      startedAt: run.startedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      userId: org.userId ?? '',
    });
    for (const [name, value] of Object.entries(test.params)) vars.set(name, vars.resolve(value));
    return undefined;
  } catch (e) {
    return `params: ${message(e)}`;
  }
}

async function runStep(
  step: TestDefinition['steps'][number],
  base: Omit<StepResult, 'status' | 'durationMs'>,
  ctx: Omit<StepContext, 'raw'>
): Promise<StepResult> {
  const started = Date.now();
  const stepType = getStepType(step.type);
  try {
    if (!stepType) throw new Error(`Unknown step type ${step.type}`);
    const { as, ...raw } = step.args;
    const args = ctx.vars.resolve(raw) as Record<string, unknown>;
    const output = await stepType.run(args, { ...ctx, raw });
    if (typeof as === 'string') ctx.vars.set(as, output?.value);
    const detail = [output?.detail, typeof as === 'string' ? `-> $${as}` : undefined].filter(Boolean).join(' ');
    return { ...base, status: 'passed', durationMs: Date.now() - started, ...(detail ? { detail } : {}) };
  } catch (e) {
    return { ...base, status: 'failed', durationMs: Date.now() - started, error: message(e) };
  }
}

/** Save a screenshot of the test's page; returns the path, or undefined if it couldn't be taken. */
async function screenshot(page: Promise<{ page: Page }>, dir: string, file: string): Promise<string | undefined> {
  try {
    const path = join(dir, file);
    await mkdir(dir, { recursive: true });
    await (await page).page.screenshot({ path, timeout: 10_000 });
    return path;
  } catch {
    return undefined;
  }
}

/** "Large opp routes to Finance" -> "large-opp-routes-to-finance" */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)
      .replace(/^-+|-+$/g, '') || 'test'
  );
}

/**
 * Error text for results: no ANSI colours, and Playwright's long call log reduced to
 * its last distinct reason (e.g. "element is not visible").
 */
export function message(error: unknown): string {
  // eslint-disable-next-line no-control-regex
  const text = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, '');
  const [head, log] = text.split(/\n\s*Call log:\s*\n/);
  if (!log) return text.trim();
  const reasons = log
    .split('\n')
    .map((line) => line.replace(/^[\s\d×-]+/, '').trim())
    .filter((line) => /^element |^locator resolved to/.test(line));
  const reason = reasons.at(-1)?.slice(0, 160);
  return reason ? `${head.trim()} (${reason})` : head.trim();
}
