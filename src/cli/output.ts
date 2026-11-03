import { isAbsolute, relative, resolve } from 'node:path';
import { StandardColors } from '@salesforce/sf-plugins-core';
import type { StepResult, TestResult } from '../engine/index.js';

/** Terminal formatting shared by the regress commands. */

export function formatTestResult(result: TestResult): string[] {
  const mark = result.status === 'passed' ? StandardColors.success('✔') : StandardColors.error('✘');
  const file = result.file ? `  ${result.file}` : '';
  const lines = [`${mark} ${result.name}  (${(result.durationMs / 1000).toFixed(1)}s)${file}`];
  if (result.error) lines.push(`    ${StandardColors.error(result.error)}`);
  for (const step of result.steps) lines.push(`    ${formatStep(step)}`);
  lines.push(`    ${formatCleanup(result)}`, '');
  return lines;
}

export function formatStep(step: StepResult): string {
  const title = `${step.index}. ${step.name ? `${step.name} (${step.type})` : step.type}`;
  if (step.status === 'skipped') return `-  ${title}  skipped`;
  if (step.status === 'failed') {
    const where = step.line ? ` [line ${step.line}]` : '';
    const shot = step.screenshot ? `\n       screenshot: ${step.screenshot}` : '';
    return `${StandardColors.error('✘')}  ${title}${where}\n       ${StandardColors.error(
      step.error ?? 'failed'
    )}${shot}`;
  }
  return `${StandardColors.success('✔')}  ${title}${step.detail ? `  ${step.detail}` : ''}`;
}

export function formatCleanup(result: TestResult): string {
  const { deleted, errors } = result.cleanup;
  if (deleted.length === 0 && errors.length === 0) return 'cleanup: nothing to delete';
  const text = `cleanup: deleted ${deleted.length} record${deleted.length === 1 ? '' : 's'}`;
  if (errors.length === 0) return text;
  const failures = errors.map((e) => `\n       could not delete ${e.sobject} ${e.id}: ${e.error}`).join('');
  return StandardColors.warning(`${text}, ${errors.length} failed${failures}`);
}

/** Show paths relative to the current folder when they're inside it, absolute otherwise. */
export function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : resolve(path);
}
