import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import mammoth from 'mammoth';
import type { AuthorModel, DraftCase, TokenUsage } from './model.js';
import { SPLIT_PROMPT } from './prompt.js';

/**
 * Draft documents (.docx, .md, .txt) -> separate plain-English test descriptions.
 * Each description then goes through authorTest, like `sf regress create`.
 */

export const DRAFT_EXTENSIONS = ['.docx', '.md', '.txt'];

export function isDraftFile(path: string): boolean {
  const name = basename(path);
  // Skip hidden files and Word's "~$name.docx" lock files.
  return !name.startsWith('.') && !name.startsWith('~$') && DRAFT_EXTENSIONS.includes(extname(name).toLowerCase());
}

/** Draft files directly in `dir` (not in sub-folders such as converted/), sorted by name. */
export async function findDrafts(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && isDraftFile(e.name))
    .map((e) => join(dir, e.name))
    .sort();
}

/** The text of a draft. Word documents are read as plain text (headings, lists and tables become lines). */
export async function readDraft(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path });
    return value.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (ext === '.md' || ext === '.txt') return (await readFile(path, 'utf8')).trim();
  throw new Error(`Unsupported draft file type "${ext}" (use ${DRAFT_EXTENSIONS.join(', ')})`);
}

/** Asks the AI to split a document into separate tests. Blank entries are dropped. */
export async function splitDraft(model: AuthorModel, text: string): Promise<{ tests: DraftCase[]; usage: TokenUsage }> {
  const { tests, usage } = await model.splitDraft(SPLIT_PROMPT, text);
  return {
    tests: tests
      .map((t) => ({ name: t.name.trim(), description: t.description.trim() }))
      .filter((t) => t.name && t.description),
    usage,
  };
}

/** Moves a converted draft into a `converted/` folder next to it, without overwriting. Returns the new path. */
export async function moveToConverted(path: string): Promise<string> {
  const dir = join(dirname(path), 'converted');
  await mkdir(dir, { recursive: true });
  const ext = extname(path);
  const stem = basename(path, ext);
  let target = join(dir, basename(path));
  for (let n = 2; existsSync(target); n++) target = join(dir, `${stem}-${n}${ext}`);
  await rename(path, target);
  return target;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}
