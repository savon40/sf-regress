import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Folders under the tests directory that never hold runnable tests. */
const SKIP_DIRS = new Set(['drafts', 'node_modules']);

/** Find every .yaml / .yml test file under a folder, sorted for stable run order. */
export async function findTestFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      if (!SKIP_DIRS.has(entry.name)) files.push(...(await findTestFiles(path)));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}
