import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import {
  addUsage,
  findDrafts,
  isDraftFile,
  moveToConverted,
  readDraft,
  splitDraft,
} from '../../../src/engine/author/convert.js';
import type { AuthorModel, DraftCase } from '../../../src/engine/author/model.js';
import { SPLIT_PROMPT } from '../../../src/engine/author/prompt.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const usage = { inputTokens: 5, outputTokens: 2, cacheReadTokens: 1 };

describe('draft documents', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'regress-drafts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('recognises .docx, .md and .txt, skipping hidden and Word lock files', () => {
    expect(['a.docx', 'b.MD', 'c.txt'].every(isDraftFile)).to.equal(true);
    expect(['~$a.docx', '.notes.md', 'd.pdf', 'e.yaml'].some(isDraftFile)).to.equal(false);
  });

  it('finds drafts in the folder but not in converted/', async () => {
    await mkdir(join(dir, 'converted'));
    await writeFile(join(dir, 'converted', 'old.md'), 'x');
    await writeFile(join(dir, 'b.txt'), 'x');
    await writeFile(join(dir, 'a.md'), 'x');
    await writeFile(join(dir, 'notes.pdf'), 'x');
    expect(await findDrafts(dir)).to.deep.equal([join(dir, 'a.md'), join(dir, 'b.txt')]);
    expect(await findDrafts(join(dir, 'missing'))).to.deep.equal([]);
  });

  it('reads Markdown and text as is', async () => {
    await writeFile(join(dir, 't.md'), '\n# Tests\n\n- one\n');
    expect(await readDraft(join(dir, 't.md'))).to.equal('# Tests\n\n- one');
  });

  it('reads the text of a Word document', async () => {
    const text = await readDraft(join(fixtures, 'two-tests.docx'));
    expect(text).to.include('TC-01 Small deal').and.include('Expect forecast category Pipeline.');
  });

  it('moves a converted draft without overwriting an earlier one', async () => {
    await writeFile(join(dir, 'a.md'), 'first');
    expect(await moveToConverted(join(dir, 'a.md'))).to.equal(join(dir, 'converted', 'a.md'));
    await writeFile(join(dir, 'a.md'), 'second');
    expect(await moveToConverted(join(dir, 'a.md'))).to.equal(join(dir, 'converted', 'a-2.md'));
    expect(existsSync(join(dir, 'a.md'))).to.equal(false);
    expect(await readFile(join(dir, 'converted', 'a.md'), 'utf8')).to.equal('first');
  });
});

describe('splitDraft', () => {
  it('sends the document with the split prompt and drops blank tests', async () => {
    let seen: { system: string; document: string } | undefined;
    const tests: DraftCase[] = [
      { name: ' Small deal ', description: ' Create a 10k opportunity. ' },
      { name: '', description: 'no name' },
      { name: 'Empty', description: '  ' },
    ];
    const model: AuthorModel = {
      name: 'm',
      startSession: () => {
        throw new Error('not used');
      },
      splitDraft: async (system, document) => {
        seen = { system, document };
        return { tests, usage };
      },
    };
    const result = await splitDraft(model, 'the doc');
    expect(seen).to.deep.equal({ system: SPLIT_PROMPT, document: 'the doc' });
    expect(result.tests).to.deep.equal([{ name: 'Small deal', description: 'Create a 10k opportunity.' }]);
    expect(result.usage).to.equal(usage);
  });

  it('adds up token usage', () => {
    expect(addUsage(usage, usage)).to.deep.equal({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 });
  });
});
