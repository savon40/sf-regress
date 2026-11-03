import { z } from 'zod';
import type { QueryResult } from '../types.js';
import { requireString, StepFailure, type StepType } from './step.js';

/** Variable names for `as:` - plain identifiers, so `$name.path` can read them. */
export const variableName = z
  .string()
  .regex(/^[A-Za-z_]\w*$/, 'must be a simple name (letters, digits, underscore), e.g. "acme"');

const fields = z.record(z.string(), z.unknown());

function asFields(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StepFailure(`fields must resolve to an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

const createArgs = z.strictObject({ sobject: z.string().min(1), fields, as: variableName.optional() });

/** api.create - insert a record and track it for cleanup. Result: the fields plus Id. */
export const apiCreate: StepType<z.infer<typeof createArgs>> = {
  type: 'api.create',
  schema: createArgs,
  storesResult: true,
  async run(args, ctx) {
    const sobject = requireString(args.sobject, 'sobject');
    const values = asFields(args.fields);
    const id = await ctx.client.create(sobject, values);
    ctx.cleanup.track(sobject, id);
    return { value: { ...values, Id: id }, detail: `${sobject} ${id}` };
  },
};

const updateArgs = z.strictObject({ sobject: z.string().min(1), id: z.string().min(1), fields });

/** api.update - update fields on an existing record. */
export const apiUpdate: StepType<z.infer<typeof updateArgs>> = {
  type: 'api.update',
  schema: updateArgs,
  async run(args, ctx) {
    const sobject = requireString(args.sobject, 'sobject');
    const id = requireString(args.id, 'id');
    await ctx.client.update(sobject, id, asFields(args.fields));
    return { detail: `${sobject} ${id}` };
  },
};

const deleteArgs = z.strictObject({ sobject: z.string().min(1), id: z.string().min(1) });

/** api.delete - delete a record (and stop tracking it for cleanup). */
export const apiDelete: StepType<z.infer<typeof deleteArgs>> = {
  type: 'api.delete',
  schema: deleteArgs,
  async run(args, ctx) {
    const sobject = requireString(args.sobject, 'sobject');
    const id = requireString(args.id, 'id');
    await ctx.client.delete(sobject, id);
    ctx.cleanup.untrack(id);
    return { detail: `${sobject} ${id}` };
  },
};

const queryArgs = z.strictObject({ soql: z.string().min(1), as: variableName.optional() });

/** api.query - run SOQL. Result: { totalSize, done, records }. */
export const apiQuery: StepType<z.infer<typeof queryArgs>> = {
  type: 'api.query',
  schema: queryArgs,
  storesResult: true,
  shorthand: 'soql',
  async run(args, ctx) {
    const result = await ctx.client.query(requireString(args.soql, 'soql'));
    return { value: result, detail: plural(result.totalSize, 'record') };
  },
};

const trackArgs = z.strictObject({
  soql: z.string().min(1),
  sobject: z.string().min(1).optional(),
  as: variableName.optional(),
});

/**
 * api.track - find records created outside api.create (e.g. through the UI) and
 * register them for cleanup. The query must select Id.
 */
export const apiTrack: StepType<z.infer<typeof trackArgs>> = {
  type: 'api.track',
  schema: trackArgs,
  storesResult: true,
  shorthand: 'soql',
  async run(args, ctx) {
    const result: QueryResult = await ctx.client.query(requireString(args.soql, 'soql'));
    for (const record of result.records) {
      const sobject = args.sobject ?? record.attributes?.type;
      const id = record.Id ?? record.id;
      if (typeof id !== 'string') throw new StepFailure('api.track query must SELECT Id');
      if (!sobject) throw new StepFailure(`Cannot tell the object type of ${id}; add "sobject:" to the step`);
      ctx.cleanup.track(sobject, id);
    }
    return { value: result, detail: `tracking ${plural(result.totalSize, 'record')} for cleanup` };
  },
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
