import type { Page } from 'playwright';
import type { z } from 'zod';
import type { CleanupTracker } from '../cleanup.js';
import type { OrgClient, OrgInfo } from '../types.js';
import type { Variables } from '../variables.js';

export type StepContext = {
  client: OrgClient;
  vars: Variables;
  cleanup: CleanupTracker;
  /** The step's arguments before variable resolution, for readable error messages. */
  raw: Record<string, unknown>;
  org: OrgInfo;
  /** When the test started; used to tell records the test created from existing ones. */
  startedAt: Date;
  /** The test's browser page, opened (and logged in) on first use. */
  browser(): Promise<{ page: Page; baseUrl: string }>;
};

export type StepOutput = {
  /** Stored in the variable named by `as:`, when the step has one. */
  value?: unknown;
  /** Short summary shown in the terminal, e.g. "Account 001xx..." */
  detail?: string;
};

/**
 * One step type, e.g. "api.create". Each lives in its own module and is listed in registry.ts.
 *
 * `schema` validates the raw YAML arguments at load time. `run` receives the same
 * arguments after $variables are resolved. `as` is handled by the runner and never resolved.
 */
export type StepType<Args extends Record<string, unknown> = Record<string, unknown>> = {
  type: string;
  schema: z.ZodType<Args>;
  /** Steps whose result can be stored with `as:`. */
  storesResult?: boolean;
  /**
   * Shorthand form: lets `- api.query: "SELECT ..."` stand for `- api.query: { soql: "SELECT ..." }`.
   * Names the argument a bare string value maps to.
   */
  shorthand?: string;
  run(args: Args, ctx: StepContext): Promise<StepOutput | undefined>;
};

export class StepFailure extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StepFailure';
  }
}

/** Format a value for messages: strings quoted, objects as JSON. */
export function show(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value) ?? typeof value;
}

/** A value as plain text for typing into the UI: null/undefined become "". */
export function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return (value as number).toString();
}

/** Label for the left side of an assertion: the original $expression if there was one. */
export function label(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.includes('$') ? raw : fallback;
}

export function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StepFailure(`${what} must resolve to a non-empty string, got ${show(value)}`);
  }
  return value;
}
