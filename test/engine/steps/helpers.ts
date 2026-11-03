import { CleanupTracker } from '../../../src/engine/cleanup.js';
import { getStepType } from '../../../src/engine/steps/registry.js';
import type { StepOutput } from '../../../src/engine/steps/step.js';
import { Variables } from '../../../src/engine/variables.js';
import { MockOrg } from '../mock-org.js';

export type Harness = { org: MockOrg; vars: Variables; cleanup: CleanupTracker };

export function harness(): Harness {
  return { org: new MockOrg(), vars: new Variables(() => new Date(2026, 0, 1)), cleanup: new CleanupTracker() };
}

/** Validate raw args against the step's schema, resolve variables, and run it - as the runner does. */
export async function runStep(h: Harness, type: string, raw: Record<string, unknown>): Promise<StepOutput | undefined> {
  const step = getStepType(type);
  if (!step) throw new Error(`no step type ${type}`);
  step.schema.parse(raw);
  const args = h.vars.resolve(raw) as Record<string, unknown>;
  return step.run(args, { client: h.org, vars: h.vars, cleanup: h.cleanup, raw });
}

export async function expectFailure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the step to fail');
}
