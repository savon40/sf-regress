import type { Target } from '../steps/locate.js';
import type { ClickEvent, CreatedRecord, RecordedAction, RecordedLocator, Recording } from './types.js';

/**
 * Turns a raw Playwright recording of Lightning into a readable, replayable test.
 *
 * - Selectors become Salesforce-aware targets ({ field: Industry }, { button: Save, in: New Contact }).
 * - Brittle selectors (generated ids like [id="1194:0"]) are repaired from sf-regress's own click events.
 * - Lightning picklist and lookup interactions (click field, click option) become browser.select.
 * - Typed text becomes params; names/subjects get a $run.id suffix so reruns don't collide.
 * - Records created while recording become variables and are cleaned up after each run:
 * browser.captureRecord when the page navigated to the record, api.track otherwise.
 */

export type DraftStep = {
  type: string;
  args: Record<string, unknown>;
  name?: string;
  /** Shown as a YAML comment above the step, e.g. a review note. */
  comment?: string;
  /** Time of the click this step came from (internal, not written to YAML). */
  t?: number;
};

export type DraftTest = {
  name: string;
  tags: string[];
  params: Record<string, string>;
  steps: DraftStep[];
};

export type ConvertOptions = {
  name: string;
  /** Records the user created while recording, found by querying the org afterwards. */
  created?: CreatedRecord[];
  /** sobject API name -> label, to recognise "New Contact" dialogs. */
  labels?: Record<string, string>;
};

export type ConvertResult = { test: DraftTest; notes: string[] };

const FIELD_ROLES = new Set(['textbox', 'combobox', 'spinbutton', 'searchbox']);
const TARGET_ROLES = new Set(['button', 'link', 'tab', 'option', 'menuitem', 'checkbox', 'heading']);
const SCOPE_ROLES = new Set(['dialog', 'tabpanel']);
/** Typed values for these fields get a unique suffix per run. */
const UNIQUE_FIELD = /name|subject|title/i;

export function convertRecording(recording: Recording, options: ConvertOptions): ConvertResult {
  const notes: string[] = [];
  const actions = recording.actions.filter((a) => a.name !== 'openPage' && a.name !== 'closePage');
  const events = align(actions, recording.events);

  let steps = shortcutAppLauncher(toSteps(actions, events, recording.baseUrl, notes), recording);
  const params = parameterize(steps);
  steps = addCreatedRecords(steps, recording, options, params, notes);

  return { test: { name: options.name, tags: ['recorded'], params: params.values, steps }, notes };
}

// ---------------------------------------------------------------------------
// 1. Match recorder clicks to our click events (same order, matched by role/name or id).

const LOOKAHEAD = 6;

function align(actions: RecordedAction[], events: ClickEvent[]): Array<ClickEvent | undefined> {
  let next = 0;
  return actions.map((action) => {
    if (action.name !== 'click') return undefined;
    for (let i = next; i < Math.min(events.length, next + LOOKAHEAD); i++) {
      if (matches(action, events[i])) {
        next = i + 1;
        return events[i];
      }
    }
    return undefined;
  });
}

function matches(action: RecordedAction, event: ClickEvent): boolean {
  const id = idOf(action.selector);
  if (id) return event.ids.includes(id);
  const loc = innermost(action.locator);
  if (loc?.kind === 'role') {
    if (event.role !== String(loc.body)) return false;
    const name = cleanLabel(loc.options?.name);
    return !name || !event.name || sameText(name, event.name);
  }
  return true;
}

function idOf(selector?: string): string | undefined {
  const match = /^\[id="([^"]+)"\]$|^#([\w-]+)$/.exec(selector ?? '');
  return match ? match[1] ?? match[2] : undefined;
}

// ---------------------------------------------------------------------------
// 2. Recorder actions -> draft steps.

type Mapped = { target?: Target; brittle: boolean };

/** What a converter sees: the action, its click event, and what comes next. */
type Context = {
  action: RecordedAction;
  event?: ClickEvent;
  next?: RecordedAction;
  nextEvent?: ClickEvent;
  /** All actions after this one. */
  later: RecordedAction[];
  mapped: Mapped;
  baseUrl: string;
  notes: string[];
};

/** Steps produced for one action, and how many following actions it consumed. */
type Converted = { steps: DraftStep[]; consumed?: number };

function toSteps(
  actions: RecordedAction[],
  events: Array<ClickEvent | undefined>,
  baseUrl: string,
  notes: string[]
): DraftStep[] {
  const steps: DraftStep[] = [];
  const lastEventFor = new Map<string, ClickEvent>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const own = events[i];
    if (own && action.selector) lastEventFor.set(action.selector, own);
    // Fills have no click event of their own; use the click that focused the field.
    const event = own ?? (action.selector ? lastEventFor.get(action.selector) : undefined);
    const ctx: Context = {
      action,
      event,
      next: actions[i + 1],
      nextEvent: events[i + 1],
      later: actions.slice(i + 1),
      mapped: mapTarget(action, event),
      baseUrl,
      notes,
    };
    const converted = convertAction(ctx);
    steps.push(...converted.steps);
    i += converted.consumed ?? 0;
  }
  return steps;
}

function convertAction(ctx: Context): Converted {
  const { action, mapped } = ctx;
  switch (action.name) {
    case 'navigate':
      return { steps: [{ type: 'browser.goto', args: { path: relativePath(action.url ?? '/', ctx.baseUrl) } }] };
    case 'click':
      return convertClick(ctx);
    case 'fill':
      return convertFill(ctx);
    case 'select':
      return { steps: [{ type: 'browser.select', args: { ...mapped.target, value: action.options?.[0] ?? '' } }] };
    case 'check':
    case 'uncheck':
      return { steps: [withNote({ type: 'browser.click', args: { ...mapped.target }, t: ctx.event?.t }, ctx)] };
    case 'press':
      return { steps: [{ type: 'browser.press', args: { key: action.key ?? 'Enter' } }] };
    default:
      return action.name.startsWith('assert') ? convertAssert(ctx) : skip(ctx);
  }
}

function skip(ctx: Context): Converted {
  ctx.notes.push(`Skipped an unsupported recorded action: ${ctx.action.name}`);
  return { steps: [] };
}

function convertClick(ctx: Context): Converted {
  const { action, next, nextEvent, mapped, event } = ctx;
  // A click into a field right before typing in it is noise.
  if (next?.name === 'fill' && next.selector === action.selector) return { steps: [] };
  // Lightning picklist: click the field, then click an option.
  const option = next?.name === 'click' ? optionName(next, nextEvent) : undefined;
  if (mapped.target?.field && option) {
    return {
      steps: [{ type: 'browser.select', args: { ...mapped.target, value: option }, t: nextEvent?.t ?? event?.t }],
      consumed: 1,
    };
  }
  return { steps: [withNote({ type: 'browser.click', args: { ...mapped.target }, t: event?.t }, ctx)] };
}

function convertFill(ctx: Context): Converted {
  const { action, next, nextEvent, mapped } = ctx;
  // Typing again into the same field: keep only the last value.
  if (next?.name === 'fill' && next.selector === action.selector) return { steps: [] };
  // Lightning sometimes reports an empty fill when a formatted field (currency, date) gets focus.
  if (!action.text && ctx.later.some((a) => a.name === 'fill' && a.selector === action.selector)) return { steps: [] };
  // Lookup: type, then pick a result.
  const option = next?.name === 'click' ? optionName(next, nextEvent) : undefined;
  if (option && innermost(action.locator)?.body === 'combobox') {
    return {
      // Use the full name of the record picked, not the partial text typed to find it.
      steps: [{ type: 'browser.select', args: { ...mapped.target, value: option }, t: nextEvent?.t }],
      consumed: 1,
    };
  }
  return { steps: [withNote({ type: 'browser.fill', args: { ...mapped.target, value: action.text ?? '' } }, ctx)] };
}

function convertAssert(ctx: Context): Converted {
  const { action, mapped } = ctx;
  switch (action.name) {
    case 'assertVisible':
      return { steps: [withNote({ type: 'browser.expectVisible', args: { ...mapped.target } }, ctx)] };
    case 'assertText':
      // A brittle element with known text is better checked as "this text is visible".
      if (mapped.brittle && action.text) {
        return { steps: [{ type: 'browser.expectVisible', args: { text: action.text } }] };
      }
      return {
        steps: [withNote({ type: 'browser.expectText', args: { ...mapped.target, contains: action.text ?? '' } }, ctx)],
      };
    case 'assertValue':
      return {
        steps: [withNote({ type: 'browser.expectValue', args: { ...mapped.target, value: action.value ?? '' } }, ctx)],
      };
    default:
      ctx.notes.push(
        `${action.name} was recorded as browser.expectVisible; checked state and snapshots aren't supported yet.`
      );
      return { steps: [withNote({ type: 'browser.expectVisible', args: { ...mapped.target } }, ctx)] };
  }
}

function withNote(step: DraftStep, { action, mapped, notes }: Context): DraftStep {
  if (!mapped.target) {
    const comment = `review: could not tell what this element is; using the raw selector ${action.selector ?? '?'}`;
    notes.push(comment);
    return { ...step, args: { selector: action.selector ?? 'body', ...omitTargetKinds(step.args) }, comment };
  }
  return step;
}

function omitTargetKinds(args: Record<string, unknown>): Record<string, unknown> {
  const { value, contains } = args;
  return { ...(value !== undefined ? { value } : {}), ...(contains !== undefined ? { contains } : {}) };
}

/** The option text if this action clicked a picklist/lookup option. */
function optionName(action: RecordedAction, event: ClickEvent | undefined): string | undefined {
  if (event?.role === 'option') {
    const label = event.name.split(' • ')[0];
    return label ? label : event.value ?? undefined;
  }
  const loc = innermost(action.locator);
  if (loc?.kind === 'role' && loc.body === 'option') return cleanLabel(loc.options?.name);
  return undefined;
}

/** Recorder locator (+ our click event) -> Salesforce-aware target. */
function mapTarget(action: RecordedAction, event: ClickEvent | undefined): Mapped {
  const loc = action.locator;
  let scope: string | undefined;
  for (let l = loc; l?.next; l = l.next) {
    if (l.kind === 'role' && SCOPE_ROLES.has(String(l.body)) && l.options?.name) scope = l.options.name;
  }
  const inner = innermost(loc);
  let target = fromLocator(inner, action.selector);
  const brittle = !target;
  if (!target && event) target = fromEvent(event);
  if (!target) return { brittle: true };

  const dialog = scope ?? event?.dialog ?? undefined;
  if (dialog && !target.selector) target.in = dialog;
  return { target, brittle };
}

function fromLocator(loc: RecordedLocator | undefined, selector?: string): Target | undefined {
  if (!loc) return undefined;
  const body = String(loc.body);
  switch (loc.kind) {
    case 'role': {
      const name = cleanLabel(loc.options?.name);
      if (!name) return undefined;
      if (FIELD_ROLES.has(body)) return { field: name };
      if (TARGET_ROLES.has(body)) return { [body]: name };
      return { text: name };
    }
    case 'label':
      return { field: cleanLabel(body) };
    case 'text':
      return { text: body };
    case 'placeholder':
    case 'alt':
    case 'title':
    case 'test-id':
      return selector ? { selector } : undefined;
    default:
      return undefined;
  }
}

function fromEvent(event: ClickEvent): Target | undefined {
  if (event.role === 'option' && event.name) return { option: event.name.split(' • ')[0] };
  if (TARGET_ROLES.has(event.role) && event.name) return { [event.role]: event.name };
  const field = event.field ?? event.name;
  if (FIELD_ROLES.has(event.role) && field) return { field };
  if (event.name && event.name.length <= 60) return { text: event.name };
  return undefined;
}

function innermost(loc?: RecordedLocator): RecordedLocator | undefined {
  let l = loc;
  while (l?.next) l = l.next;
  return l;
}

/** "Last Name *" / "*Account Name" -> "Account Name" */
export function cleanLabel(label?: string): string {
  return (label ?? '').replace(/^\s*\*\s*|\s*\*\s*$/g, '').trim();
}

function sameText(a: string, b: string): boolean {
  return cleanLabel(a).toLowerCase() === cleanLabel(b).toLowerCase();
}

function relativePath(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(baseUrl).origin ? parsed.pathname + parsed.search : url;
  } catch {
    return url;
  }
}

/**
 * App Launcher -> search -> pick an item is slow and fragile to replay (the menu is a popover
 * whose items aren't a normal listbox). Where the pick opened a page, go straight to that page.
 */
function shortcutAppLauncher(steps: DraftStep[], recording: Recording): DraftStep[] {
  const result = [...steps];
  for (let i = 0; i < result.length; i++) {
    const button = result[i].args.button;
    if (result[i].type !== 'browser.click' || typeof button !== 'string' || !sameText(button, 'App Launcher')) continue;
    // The pick: a select in the launcher's search box, or a click on an item, within the next few steps.
    let pick = -1;
    for (let j = i + 1; j < Math.min(result.length, i + 4); j++) {
      const step = result[j];
      if (step.type === 'browser.select' || (step.type === 'browser.click' && step.t !== undefined)) {
        pick = j;
        break;
      }
      if (step.type !== 'browser.fill') break;
    }
    const pickedAt = pick >= 0 ? result[pick].t : undefined;
    if (pickedAt === undefined) continue;
    const until = result.slice(pick + 1).find((s) => s.t !== undefined)?.t ?? Infinity;
    const navigation = recording.navigations.find(
      (n) => n.t >= pickedAt && n.t <= until && /\/lightning\/(?!page\/home)/.test(n.url)
    );
    if (!navigation) continue;
    const step: DraftStep = { type: 'browser.goto', args: { path: relativePath(navigation.url, recording.baseUrl) } };
    result.splice(i, pick - i + 1, step);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Typed values -> params.

type Params = { values: Record<string, string>; byValue: Map<string, string> };

function parameterize(steps: DraftStep[]): Params {
  const params: Params = { values: {}, byValue: new Map() };
  for (const step of steps) {
    if (step.type !== 'browser.fill') continue;
    const value = step.args.value;
    const field = step.args.field;
    if (typeof value !== 'string' || !value.trim() || typeof field !== 'string') continue;

    let name = params.byValue.get(value);
    if (!name) {
      name = uniqueName(camelCase(field) || 'value', params.values);
      params.values[name] = UNIQUE_FIELD.test(field) && /[a-z]/i.test(value) ? `${value} $run.id` : value;
      params.byValue.set(value, name);
    }
    step.args.value = `$${name}`;
  }

  // Assertions that repeat a typed value should follow the parameter.
  const replace = (text: string): string => {
    let result = text;
    for (const [value, name] of params.byValue) {
      if (value.length >= 3 && result.includes(value)) result = result.split(value).join(`$${name}`);
    }
    return result;
  };
  for (const step of steps) {
    if (!step.type.startsWith('browser.expect')) continue;
    for (const key of ['text', 'contains', 'value']) {
      const value = step.args[key];
      if (typeof value === 'string') step.args[key] = replace(value);
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// 4. Records created while recording -> variables + cleanup.

function addCreatedRecords(
  steps: DraftStep[],
  recording: Recording,
  options: ConvertOptions,
  params: Params,
  notes: string[]
): DraftStep[] {
  const result = [...steps];
  const taken: Record<string, unknown> = { ...params.values, run: true };

  for (const record of options.created ?? []) {
    const variable = uniqueName(camelCase(record.sobject.replace(/__c$/i, '')) || 'record', taken);
    taken[variable] = true;
    const label = options.labels?.[record.sobject] ?? record.sobject;

    const navigation = recording.navigations.find((n) => n.url.includes(record.id));
    let insertAt: number;
    let step: DraftStep;
    if (navigation) {
      // The page went to the new record (e.g. after Save): read it from the URL.
      insertAt = lastIndexBefore(result, navigation.t) + 1;
      step = {
        type: 'browser.captureRecord',
        args: { as: variable },
        name: `Remember the new ${label} (deleted after the test)`,
      };
    } else {
      // Created without opening it (e.g. a quick action): find it by query.
      const saveInDialog = result.findIndex(
        (s) =>
          s.type === 'browser.click' &&
          typeof s.args.in === 'string' &&
          isNewDialogFor(s.args.in, record.sobject, label)
      );
      insertAt = saveInDialog >= 0 ? lastSaveIn(result, result[saveInDialog].args.in as string) + 1 : result.length;
      step = {
        type: 'api.track',
        args: { soql: trackQuery(record, params), as: variable },
        name: `Find the new ${label} (deleted after the test)`,
      };
      if (saveInDialog < 0)
        notes.push(`Couldn't tell when the ${label} was created; tracking it at the end of the test.`);
    }
    result.splice(insertAt, 0, step);
    replaceId(result, record.id, `$${variable}.Id`);
  }
  return result;
}

function lastIndexBefore(steps: DraftStep[], t: number): number {
  let index = -1;
  steps.forEach((step, i) => {
    if (step.t !== undefined && step.t <= t) index = i;
  });
  return index >= 0 ? index : steps.length - 1;
}

function lastSaveIn(steps: DraftStep[], dialog: string): number {
  let index = -1;
  steps.forEach((step, i) => {
    if (step.type === 'browser.click' && step.args.in === dialog) index = i;
  });
  return index;
}

function isNewDialogFor(dialog: string, sobject: string, label: string): boolean {
  const name = dialog
    .replace(/^new\s+/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return [sobject.replace(/__c$/i, ''), label].some((n) => n.replace(/[\s_]+/g, '').toLowerCase() === name);
}

function trackQuery(record: CreatedRecord, params: Params): string {
  let soql = `SELECT Id FROM ${record.sobject} WHERE CreatedById = '$run.userId' AND CreatedDate >= $run.startedAt`;
  if (record.name) {
    const match = [...params.byValue].find(([value]) => record.name?.includes(value));
    if (match) soql += ` AND Name LIKE '%$${match[1]}%'`;
  }
  return soql;
}

function replaceId(steps: DraftStep[], id: string, reference: string): void {
  const short = id.slice(0, 15);
  const swap = (text: string): string => text.split(id).join(reference).split(short).join(reference);
  for (const step of steps) {
    for (const [key, value] of Object.entries(step.args)) {
      if (typeof value === 'string' && value.includes(short)) step.args[key] = swap(value);
    }
  }
}

// ---------------------------------------------------------------------------

/** "Account Name" -> "accountName", "Close Date" -> "closeDate" */
export function camelCase(text: string): string {
  const words = text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  return /^[A-Za-z_]/.test(name) ? name : name ? `v${name}` : '';
}

function uniqueName(base: string, taken: Record<string, unknown>): string {
  if (!(base in taken)) return base;
  for (let i = 2; ; i++) if (!(`${base}${i}` in taken)) return `${base}${i}`;
}
