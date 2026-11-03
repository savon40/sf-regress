import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { label, show, StepFailure, type StepType } from './step.js';

/**
 * Equality used by assertions. Values from YAML and from Salesforce often differ only
 * in type (60000 vs "60000", true vs "true"), so primitives are compared as strings
 * when strict equality fails. null and undefined (missing field) are treated as equal.
 */
export function looselyEqual(actual: unknown, expected: unknown): boolean {
  if (isDeepStrictEqual(actual, expected)) return true;
  if (actual == null && expected == null) return true;
  const primitive = (v: unknown): boolean => ['string', 'number', 'boolean'].includes(typeof v);
  return primitive(actual) && primitive(expected) && String(actual) === String(expected);
}

const message = z.string().optional();
const compareArgs = z.strictObject({ actual: z.unknown(), expected: z.unknown(), message });

function fail(custom: string | undefined, text: string): never {
  throw new StepFailure(custom ? `${custom} (${text})` : text);
}

/** assert.equals - actual must equal expected. */
export const assertEquals: StepType<z.infer<typeof compareArgs>> = {
  type: 'assert.equals',
  schema: compareArgs,
  async run(args, ctx) {
    const what = label(ctx.raw.actual, 'actual');
    if (!looselyEqual(args.actual, args.expected)) {
      fail(args.message, `${what}: expected ${show(args.expected)}, got ${show(args.actual)}`);
    }
    return Promise.resolve({ detail: `${what} = ${show(args.actual)}` });
  },
};

/** assert.notEquals - actual must not equal expected. */
export const assertNotEquals: StepType<z.infer<typeof compareArgs>> = {
  type: 'assert.notEquals',
  schema: compareArgs,
  async run(args, ctx) {
    const what = label(ctx.raw.actual, 'actual');
    if (looselyEqual(args.actual, args.expected)) {
      fail(args.message, `${what}: expected anything but ${show(args.expected)}`);
    }
    return Promise.resolve({ detail: `${what} = ${show(args.actual)}` });
  },
};

/** assert.contains - a string contains a substring, or a list contains an item. */
export const assertContains: StepType<z.infer<typeof compareArgs>> = {
  type: 'assert.contains',
  schema: compareArgs,
  async run(args, ctx) {
    const what = label(ctx.raw.actual, 'actual');
    const { actual, expected } = args;
    let found: boolean;
    if (typeof actual === 'string') {
      found = actual.includes(String(expected));
    } else if (Array.isArray(actual)) {
      found = actual.some((item) => looselyEqual(item, expected));
    } else {
      fail(args.message, `${what}: expected a string or list, got ${show(actual)}`);
    }
    if (!found) fail(args.message, `${what}: expected to contain ${show(expected)}, got ${show(actual)}`);
    return Promise.resolve({ detail: `${what} contains ${show(expected)}` });
  },
};

const existsArgs = z.strictObject({ actual: z.unknown(), message });

/** assert.exists - value is present (not null, undefined or empty string). */
export const assertExists: StepType<z.infer<typeof existsArgs>> = {
  type: 'assert.exists',
  schema: existsArgs,
  shorthand: 'actual',
  async run(args, ctx) {
    const what = label(ctx.raw.actual, 'actual');
    if (args.actual === undefined || args.actual === null || args.actual === '') {
      fail(args.message, `${what}: expected a value, got ${show(args.actual)}`);
    }
    return Promise.resolve({ detail: `${what} = ${show(args.actual)}` });
  },
};
