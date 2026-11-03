import type { Page } from 'playwright';
import { CleanupTracker } from '../../../src/engine/cleanup.js';
import { getStepType } from '../../../src/engine/steps/registry.js';
import type { StepOutput } from '../../../src/engine/steps/step.js';
import { Variables } from '../../../src/engine/variables.js';
import { DEV_ORG, MockOrg } from '../mock-org.js';

export type Harness = {
  org: MockOrg;
  vars: Variables;
  cleanup: CleanupTracker;
  startedAt: Date;
  page?: Page;
  baseUrl?: string;
};

export function harness(page?: Page, baseUrl = 'http://localhost'): Harness {
  return {
    org: new MockOrg(),
    vars: new Variables(() => new Date(2026, 0, 1)),
    cleanup: new CleanupTracker(),
    startedAt: new Date(),
    page,
    baseUrl,
  };
}

/** Validate raw args against the step's schema, resolve variables, and run it - as the runner does. */
export async function runStep(
  h: Harness,
  type: string,
  input: Record<string, unknown>
): Promise<StepOutput | undefined> {
  const step = getStepType(type);
  if (!step) throw new Error(`no step type ${type}`);
  step.schema.parse(input);
  const { as, ...raw } = input;
  const args = h.vars.resolve(raw) as Record<string, unknown>;
  const output = await step.run(args, {
    client: h.org,
    vars: h.vars,
    cleanup: h.cleanup,
    raw,
    org: { ...DEV_ORG, userId: '005USER' },
    startedAt: h.startedAt,
    browser: async () => {
      if (!h.page) throw new Error('no browser in this harness');
      return { page: h.page, baseUrl: h.baseUrl ?? 'http://localhost' };
    },
  });
  if (typeof as === 'string') h.vars.set(as, output?.value);
  return output;
}

export async function expectFailure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the step to fail');
}
