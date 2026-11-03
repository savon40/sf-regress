import { randomBytes } from 'node:crypto';
import { CleanupTracker } from './cleanup.js';
import { getStepType } from './steps/registry.js';
import type { OrgClient, OrgInfo, RunSummary, StepResult, TestDefinition, TestResult } from './types.js';
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
  /** Overridable for tests. */
  now?: () => Date;
  runId?: string;
};

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

  for (const test of tests) {
    // Sequential: tests share one org and may depend on its state.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runTest(test, client, org, { ...options, runId }));
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
  options: RunOptions = {}
): Promise<TestResult> {
  const started = Date.now();
  const emit = options.onEvent ?? ((): void => {});
  const now = options.now ?? ((): Date => new Date());
  const runId = options.runId ?? newRunId();
  const vars = new Variables(now);
  const cleanup = new CleanupTracker();
  const steps: StepResult[] = [];
  let error: string | undefined;

  emit({ type: 'test:start', test });

  if (isProduction(org) && !options.allowProduction && !test.allowProduction) {
    error = `Refusing to run against production org ${org.name} (${org.orgId}). Use --allow-production or set "allowProduction: true" in the test.`;
  } else {
    try {
      vars.set('run', {
        id: runId,
        date: now().toISOString().slice(0, 10),
        startedAt: new Date(started).toISOString(),
      });
      for (const [name, value] of Object.entries(test.params)) vars.set(name, vars.resolve(value));
    } catch (e) {
      error = `params: ${message(e)}`;
    }
  }

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
      const result = await runStep(step, base, { client, vars, cleanup });
      steps.push(result);
      emit({ type: 'step:end', test, step: result });
      failed = result.status === 'failed';
    }
  } catch (e) {
    // runStep catches step errors; this guards against anything unexpected so cleanup still runs.
    error = `Unexpected error: ${message(e)}`;
  }

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

async function runStep(
  step: TestDefinition['steps'][number],
  base: Omit<StepResult, 'status' | 'durationMs'>,
  ctx: { client: OrgClient; vars: Variables; cleanup: CleanupTracker }
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
