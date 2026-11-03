/**
 * Shared types for the regression engine.
 * The engine talks to Salesforce only through OrgClient, so it can be driven by
 * the sf CLI, by ForceClaw, or by a mock in unit tests.
 */

import type { Page } from 'playwright';

export type SfRecord = Record<string, unknown> & {
  attributes?: { type: string; url?: string };
};

export type QueryResult = {
  totalSize: number;
  done: boolean;
  records: SfRecord[];
};

export type OrgInfo = {
  orgId: string;
  name: string;
  organizationType: string;
  isSandbox: boolean;
  trialExpirationDate: string | null;
  username?: string;
  /** Id of the running user; used to tell which records a test created. */
  userId?: string;
  instanceUrl?: string;
};

/**
 * A logged-in browser for browser.* steps. The engine only uses Playwright pages;
 * how the session logs in (frontdoor, saved state, ...) is up to the caller.
 */
export type BrowserSession = {
  /** Origin that relative paths like /lightning/o/Account/home resolve against. */
  baseUrl: string;
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

export type OrgClient = {
  /** Create a record and return its Id. */
  create(sobject: string, fields: Record<string, unknown>): Promise<string>;
  update(sobject: string, id: string, fields: Record<string, unknown>): Promise<void>;
  delete(sobject: string, id: string): Promise<void>;
  query(soql: string): Promise<QueryResult>;
  getOrgInfo(): Promise<OrgInfo>;
  /** Object API names and labels (optional; used when post-processing recordings). */
  describeObjects?(): Promise<Array<{ name: string; label: string }>>;
};

/** A test after YAML parsing and validation, before any variables are resolved. */
export type TestDefinition = {
  name: string;
  description?: string;
  tags: string[];
  allowProduction: boolean;
  params: Record<string, unknown>;
  steps: StepDefinition[];
  /** Path of the YAML file the test came from, if any. */
  file?: string;
};

export type StepDefinition = {
  /** Step type, e.g. "api.create". */
  type: string;
  /** Raw, unresolved arguments (still contains $variables). */
  args: Record<string, unknown>;
  /** Optional human-readable name for the step. */
  name?: string;
  /** Line number in the YAML file, when known. */
  line?: number;
};

export type StepStatus = 'passed' | 'failed' | 'skipped';

export type StepResult = {
  index: number;
  type: string;
  name?: string;
  line?: number;
  status: StepStatus;
  durationMs: number;
  /** Short summary of what the step did, e.g. "Account 001xx... -> $acme". */
  detail?: string;
  error?: string;
  /** Screenshot saved when the step failed with a browser open. */
  screenshot?: string;
};

export type CleanupResult = {
  deleted: Array<{ sobject: string; id: string }>;
  errors: Array<{ sobject: string; id: string; error: string }>;
};

export type TestStatus = 'passed' | 'failed';

export type TestResult = {
  name: string;
  file?: string;
  status: TestStatus;
  durationMs: number;
  steps: StepResult[];
  cleanup: CleanupResult;
  /** Set when the test failed before or outside a step (e.g. blocked on production). */
  error?: string;
};

export type RunSummary = {
  org: OrgInfo;
  runId: string;
  passed: number;
  failed: number;
  durationMs: number;
  tests: TestResult[];
};
