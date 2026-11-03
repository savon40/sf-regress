import { readFile } from 'node:fs/promises';
import { isMap, isSeq, LineCounter, parseDocument, type Node as YamlNode } from 'yaml';
import { z } from 'zod';
import { getStepType, stepTypeNames } from './steps/registry.js';
import type { StepDefinition, TestDefinition } from './types.js';

/** Variable names the engine sets itself. */
export const RESERVED_VARIABLES = ['run'];

export class TestFileError extends Error {
  public constructor(public readonly file: string, public readonly issues: string[]) {
    super(`${file} is not a valid test:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'TestFileError';
  }
}

const identifier = z.string().regex(/^[A-Za-z_]\w*$/, 'must be a simple name (letters, digits, underscore)');

const testSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  allowProduction: z.boolean().default(false),
  params: z.record(identifier, z.unknown()).default({}),
  steps: z.array(z.unknown()).min(1, 'a test needs at least one step'),
});

export async function loadTestFile(file: string): Promise<TestDefinition> {
  return parseTest(await readFile(file, 'utf8'), file);
}

/** Parse and validate one YAML test. Throws TestFileError listing every problem found. */
export function parseTest(text: string, file = '<inline>'): TestDefinition {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  if (doc.errors.length > 0) {
    // One problem often produces a cascade of parser errors; report the first per line.
    const byLine = new Map<number, string>();
    for (const e of doc.errors) {
      const line = lineCounter.linePos(e.pos[0]).line;
      if (!byLine.has(line)) byLine.set(line, `line ${line}: ${e.message.split('\n')[0]}`);
    }
    const issues = [...byLine.values()];
    if (/[{,]\s*\w+:\s*[^"'\s][^,}]*\[/.test(text)) {
      issues.push(
        'tip: inside { ... } the characters [ ] { } , must be quoted. Write $x.records.0.Name instead of $x.records[0].Name, or quote the value.'
      );
    }
    throw new TestFileError(file, issues);
  }

  const parsed = testSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new TestFileError(file, parsed.error.issues.map(formatIssue));
  }

  const issues: string[] = [];
  for (const name of Object.keys(parsed.data.params)) {
    if (RESERVED_VARIABLES.includes(name)) issues.push(`params.${name}: "${name}" is reserved`);
  }

  const stepNodes = doc.get('steps', true);
  const steps = parsed.data.steps.map((raw, index) => {
    const node = isSeq(stepNodes) ? (stepNodes.items[index] as YamlNode | undefined) : undefined;
    const line = node?.range ? lineCounter.linePos(node.range[0]).line : undefined;
    const where = `steps[${index + 1}]${line ? ` (line ${line})` : ''}`;
    try {
      return parseStep(raw, isMap(node) ? line : undefined);
    } catch (error) {
      issues.push(`${where}: ${(error as Error).message}`);
      return undefined;
    }
  });

  if (issues.length > 0) throw new TestFileError(file, issues);

  return {
    name: parsed.data.name,
    description: parsed.data.description,
    tags: parsed.data.tags,
    allowProduction: parsed.data.allowProduction,
    params: parsed.data.params,
    steps: steps as StepDefinition[],
    file,
  };
}

function parseStep(raw: unknown, line: number | undefined): StepDefinition {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('each step must be a mapping like "- api.create: {...}"');
  }
  const { name, ...rest } = raw as Record<string, unknown>;
  if (name !== undefined && typeof name !== 'string') throw new Error('step "name" must be text');

  const keys = Object.keys(rest);
  if (keys.length !== 1) {
    throw new Error(
      keys.length === 0
        ? 'missing step type'
        : `expected one step type per step, found ${keys.join(', ')} (did you miss a "-"?)`
    );
  }

  const type = keys[0];
  const stepType = getStepType(type);
  if (!stepType) {
    throw new Error(`unknown step type "${type}". Known types: ${stepTypeNames().join(', ')}`);
  }

  let value = rest[type];
  if (stepType.shorthand && value !== null && typeof value !== 'object') value = { [stepType.shorthand]: value };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${type} needs a mapping of arguments`);
  }

  const result = stepType.schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${type}: ${result.error.issues.map(formatIssue).join('; ')}`);
  }
  const args = value as Record<string, unknown>;
  if (typeof args.as === 'string' && RESERVED_VARIABLES.includes(args.as)) {
    throw new Error(`${type}: "as: ${args.as}" is reserved`);
  }

  return { type, args, name, line };
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : String(p))).join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
