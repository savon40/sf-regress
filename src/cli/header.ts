import type { AuthorStatus } from '../engine/author/create.js';

/** Comment block at the top of an AI-written test: where it came from, and what a reviewer should check. */
export function withHeader(
  yaml: string,
  header: { origin: string; description: string; notes: string[]; status: AuthorStatus }
): string {
  const lines = [`# ${header.origin} on ${new Date().toISOString().slice(0, 10)} from:`];
  lines.push(...wrap(header.description, 90).map((line) => `#   ${line}`));
  if (header.status === 'org_mismatch') {
    lines.push('# NOTE: this test failed its first run - the org did not behave as described.');
  }
  if (header.status === 'unverified') lines.push('# NOTE: this test failed its first run and needs review.');
  if (header.notes.length) lines.push('# Review notes:', ...header.notes.map((n) => `#   - ${n}`));
  return `${lines.join('\n')}\n\n${yaml.trimEnd()}\n`;
}

/** Word-wraps text, keeping its line breaks (draft descriptions can span several lines). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.trim().split(/\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}
