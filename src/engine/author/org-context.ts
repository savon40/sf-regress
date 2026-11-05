import type { QueryResult } from '../types.js';

/**
 * Org metadata for AI test authoring (create / convert).
 *
 * The AI needs real API names - fields, picklist values, record types, buttons,
 * approval processes - so it doesn't guess. Only metadata is read here, never
 * record data, and the result is formatted as compact text for a prompt.
 */

/** Raw Salesforce calls this module needs. Implemented by `connectionMetadata` in salesforce.ts. */
export type MetadataSource = {
  describeGlobal(): Promise<GlobalObject[]>;
  describeObject(sobject: string): Promise<RawDescribe>;
  describeLayouts(sobject: string): Promise<RawLayouts>;
  query(soql: string): Promise<QueryResult>;
};

export type GlobalObject = {
  name: string;
  label: string;
  labelPlural?: string;
  custom?: boolean;
  createable?: boolean;
  queryable?: boolean;
  layoutable?: boolean;
  deprecatedAndHidden?: boolean;
};

/** The parts of an sObject describe we use. */
export type RawDescribe = {
  name: string;
  label: string;
  fields: RawField[];
  recordTypeInfos?: RawRecordType[];
};

export type RawField = {
  name: string;
  label: string;
  type: string;
  length?: number;
  nillable?: boolean;
  createable?: boolean;
  updateable?: boolean;
  defaultedOnCreate?: boolean;
  calculated?: boolean;
  deprecatedAndHidden?: boolean;
  referenceTo?: string[];
  picklistValues?: Array<{ value: string; label?: string; active?: boolean }>;
  dependentPicklist?: boolean;
  controllerName?: string | null;
};

export type RawRecordType = {
  name: string;
  developerName: string;
  recordTypeId: string;
  available?: boolean;
  master?: boolean;
};

export type RawLayouts = {
  layouts?: Array<{
    buttonLayoutSection?: { detailButtons?: Array<{ label: string; name: string }> } | null;
    quickActionList?: {
      quickActionListItems?: Array<{ label: string; quickActionName?: string; type?: string }>;
    } | null;
  }>;
};

export type FieldContext = {
  name: string;
  label: string;
  type: string;
  /** Must be set when creating a record. */
  required: boolean;
  /** Can't be set (formula, roll-up, system field). */
  readOnly: boolean;
  length?: number;
  referenceTo?: string[];
  picklistValues?: string[];
  controllerName?: string;
};

export type ObjectContext = {
  name: string;
  label: string;
  fields: FieldContext[];
  recordTypes: Array<{ name: string; developerName: string }>;
  buttons: string[];
  quickActions: Array<{ label: string; name: string }>;
  approvalProcesses: Array<{ name: string; developerName: string; active: boolean }>;
};

export type ObjectSummary = { name: string; label: string; labelPlural?: string; custom: boolean };

/** Picklists with more values than this are cut short in the prompt. */
export const MAX_PICKLIST_VALUES = 50;

/** Types that can't be used in tests directly (compound fields are set through their parts). */
const SKIPPED_FIELD_TYPES = new Set(['address', 'location', 'base64', 'anyType', 'complexvalue']);

/** System fields no test needs. */
const SKIPPED_FIELDS = new Set([
  'IsDeleted',
  'SystemModstamp',
  'LastViewedDate',
  'LastReferencedDate',
  'MasterRecordId',
]);

/** Object name suffixes for system objects nobody writes tests against. */
const SYSTEM_SUFFIXES = ['History', 'Share', 'Feed', 'ChangeEvent', 'Tag', '__hd', '__mdt', '__e', '__x', '__b'];

/** Objects a test could plausibly use: createable or queryable, has a page, not a system object. */
export async function listObjects(source: MetadataSource): Promise<ObjectSummary[]> {
  const objects = await source.describeGlobal();
  return objects
    .filter(
      (o) =>
        !o.deprecatedAndHidden &&
        o.queryable !== false &&
        o.layoutable !== false &&
        !SYSTEM_SUFFIXES.some((suffix) => o.name.endsWith(suffix))
    )
    .map((o) => ({ name: o.name, label: o.label, labelPlural: o.labelPlural, custom: Boolean(o.custom) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Objects whose name, label or plural label appears as a whole word in the text,
 * e.g. "create an opportunity" -> Opportunity. A starting point; the AI can ask for more.
 */
export function findMentionedObjects(text: string, objects: ObjectSummary[]): string[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9_]+/g, ' ')} `;
  const found = new Set<string>();
  for (const object of objects) {
    const words = [object.name.replace(/__c$/, '').replace(/_/g, ' '), object.name, object.label, object.labelPlural];
    for (const word of words) {
      if (!word) continue;
      const needle = ` ${word
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, ' ')
        .trim()} `;
      if (needle.trim() && haystack.includes(needle)) {
        found.add(object.name);
        break;
      }
    }
  }
  return [...found].sort();
}

/** Fields, record types, buttons, quick actions and approval processes for one object. */
export async function loadObjectContext(source: MetadataSource, sobject: string): Promise<ObjectContext> {
  const [describe, layouts, approvals] = await Promise.all([
    source.describeObject(sobject),
    // Not every object has page layouts; buttons are a nice-to-have.
    source.describeLayouts(sobject).catch((): RawLayouts => ({})),
    loadApprovalProcesses(source, sobject).catch((): ObjectContext['approvalProcesses'] => []),
  ]);
  return {
    name: describe.name,
    label: describe.label,
    fields: describe.fields
      .filter((f) => !f.deprecatedAndHidden && !SKIPPED_FIELD_TYPES.has(f.type) && !SKIPPED_FIELDS.has(f.name))
      .map(toField),
    recordTypes: (describe.recordTypeInfos ?? [])
      .filter((rt) => !rt.master && rt.available !== false)
      .map((rt) => ({ name: rt.name, developerName: rt.developerName })),
    ...layoutActions(layouts),
    approvalProcesses: approvals,
  };
}

export async function loadOrgContext(source: MetadataSource, sobjects: string[]): Promise<ObjectContext[]> {
  return Promise.all([...new Set(sobjects)].map((sobject) => loadObjectContext(source, sobject)));
}

/** Compact, readable text for a prompt. */
export function formatObjectContext(object: ObjectContext): string {
  const lines = [`## ${object.name} ("${object.label}")`];
  lines.push(
    `Record types: ${
      object.recordTypes.length ? object.recordTypes.map((rt) => `${rt.name} (${rt.developerName})`).join(', ') : 'none'
    }`
  );
  lines.push('Fields (* = required on create):');
  for (const field of object.fields) lines.push(`  ${formatField(field)}`);
  lines.push(`Buttons: ${object.buttons.length ? object.buttons.join(', ') : 'none'}`);
  lines.push(
    `Quick actions: ${
      object.quickActions.length ? object.quickActions.map((a) => `${a.label} (${a.name})`).join(', ') : 'none'
    }`
  );
  lines.push(
    `Approval processes: ${
      object.approvalProcesses.length
        ? object.approvalProcesses
            .map((p) => `${p.name} (${p.developerName}${p.active ? '' : ', inactive'})`)
            .join(', ')
        : 'none'
    }`
  );
  return lines.join('\n');
}

export function formatOrgContext(objects: ObjectContext[]): string {
  return objects.map(formatObjectContext).join('\n\n');
}

function toField(field: RawField): FieldContext {
  const readOnly = Boolean(field.calculated) || (!field.createable && !field.updateable);
  const required =
    Boolean(field.createable) && field.nillable === false && !field.defaultedOnCreate && field.type !== 'boolean';
  const result: FieldContext = { name: field.name, label: field.label, type: field.type, required, readOnly };
  if (field.type === 'string' || field.type === 'textarea') result.length = field.length;
  if (field.referenceTo?.length) result.referenceTo = field.referenceTo;
  if (field.picklistValues?.length) {
    result.picklistValues = field.picklistValues.filter((v) => v.active !== false).map((v) => v.value);
  }
  if (field.dependentPicklist && field.controllerName) result.controllerName = field.controllerName;
  return result;
}

function formatField(field: FieldContext): string {
  let type = field.type;
  if (field.length) type += `(${field.length})`;
  if (field.referenceTo) type = `lookup -> ${field.referenceTo.join(' | ')}`;
  const parts = [`${field.name}${field.required ? '*' : ''} "${field.label}" ${type}`];
  if (field.readOnly) parts.push('read-only');
  if (field.controllerName) parts.push(`depends on ${field.controllerName}`);
  if (field.picklistValues?.length) {
    const values = field.picklistValues.slice(0, MAX_PICKLIST_VALUES);
    const more = field.picklistValues.length - values.length;
    parts.push(`values: ${values.join(' | ')}${more > 0 ? ` (+${more} more)` : ''}`);
  }
  return parts.join(', ');
}

function layoutActions(layouts: RawLayouts): Pick<ObjectContext, 'buttons' | 'quickActions'> {
  const buttons = new Set<string>();
  const quickActions = new Map<string, { label: string; name: string }>();
  for (const layout of layouts.layouts ?? []) {
    for (const button of layout.buttonLayoutSection?.detailButtons ?? []) buttons.add(button.label);
    for (const item of layout.quickActionList?.quickActionListItems ?? []) {
      // Chatter publisher actions (Post, Poll, ...) aren't useful in tests.
      if (item.type === 'Post' || !item.quickActionName) continue;
      quickActions.set(item.quickActionName, { label: item.label, name: item.quickActionName });
    }
  }
  return { buttons: [...buttons], quickActions: [...quickActions.values()] };
}

async function loadApprovalProcesses(
  source: MetadataSource,
  sobject: string
): Promise<ObjectContext['approvalProcesses']> {
  if (!/^\w+$/.test(sobject)) return [];
  const result = await source.query(
    `SELECT Name, DeveloperName, State FROM ProcessDefinition WHERE Type = 'Approval' AND TableEnumOrId = '${sobject}' ORDER BY Name`
  );
  return result.records.map((r) => ({
    name: String(r.Name),
    developerName: String(r.DeveloperName),
    active: r.State === 'Active',
  }));
}
