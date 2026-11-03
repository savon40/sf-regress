import type { RunSummary, TestResult } from './types.js';

/** JUnit XML for CI systems: one <testsuite> per run, one <testcase> per test. */
export function toJUnitXml(summary: RunSummary, suiteName = 'sf-regress'): string {
  const seconds = (ms: number): string => (ms / 1000).toFixed(3);
  const cases = summary.tests.map((test) => testCase(test, seconds)).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(suiteName)}" tests="${summary.tests.length}" failures="${summary.failed}" time="${seconds(
      summary.durationMs
    )}">`,
    `  <testsuite name="${xml(suiteName)}" tests="${summary.tests.length}" failures="${
      summary.failed
    }" errors="0" skipped="0" time="${seconds(summary.durationMs)}" hostname="${xml(
      summary.org.instanceUrl ?? summary.org.name
    )}">`,
    cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

function testCase(test: TestResult, seconds: (ms: number) => string): string {
  const open = `    <testcase name="${xml(test.name)}" classname="${xml(test.file ?? 'sf-regress')}" time="${seconds(
    test.durationMs
  )}"`;
  const steps = test.steps
    .map(
      (s) =>
        `${s.status.toUpperCase().padEnd(7)} ${s.index}. ${s.name ? `${s.name} (${s.type})` : s.type}${
          s.detail ? ` - ${s.detail}` : ''
        }`
    )
    .join('\n');
  const cleanup = `cleanup: deleted ${test.cleanup.deleted.length}, failed ${test.cleanup.errors.length}`;
  const out = `      <system-out>${xml(`${steps}\n${cleanup}`)}</system-out>`;
  if (test.status === 'passed') return `${open}>\n${out}\n    </testcase>`;

  const failed = test.steps.find((s) => s.status === 'failed');
  const message =
    test.error ?? (failed ? `Step ${failed.index} (${failed.type}): ${failed.error ?? 'failed'}` : 'failed');
  const details = [
    message,
    failed?.line ? `at ${test.file ?? ''}:${failed.line}` : '',
    failed?.screenshot ? `screenshot: ${failed.screenshot}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${open}>\n      <failure message="${xml(message)}" type="AssertionError">${xml(
    details
  )}</failure>\n${out}\n    </testcase>`;
}

function xml(text: string): string {
  return (
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}
