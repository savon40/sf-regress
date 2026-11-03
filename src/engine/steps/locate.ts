import type { Locator, Page } from 'playwright';
import { z } from 'zod';

/**
 * Salesforce-aware element targets for browser steps.
 *
 * A target names an element the way a person would describe it:
 * - { button: Save } - a button by its label
 * - { field: Account Name } - an input, picklist or lookup by its label or API name (a required "*" is ignored); on a record page, the field's read-only value
 * - { tab: Details }, { link: Acme }, { menuitem: Delete }, { option: Banking }, { checkbox: Active }, { heading: Acme }
 * - { text: Account saved } - any element containing the text
 * - { selector: "css=..." } - a raw Playwright selector, as a last resort
 *
 * Modifiers:
 * - in: New Account - only look inside the dialog (modal) with this title
 * - exact: false - match labels by substring instead of the whole label
 *
 * Lightning keeps hidden copies of previously visited pages in the DOM, so a target
 * always resolves to the first *visible* match.
 */

export const TARGET_KINDS = [
  'button',
  'link',
  'tab',
  'field',
  'text',
  'option',
  'menuitem',
  'checkbox',
  'heading',
  'selector',
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

const targetShape = {
  ...Object.fromEntries(TARGET_KINDS.map((kind) => [kind, z.string().min(1).optional()])),
  in: z.string().min(1).optional(),
  exact: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
} as { [K in TargetKind]: z.ZodOptional<z.ZodString> } & {
  in: z.ZodOptional<z.ZodString>;
  exact: z.ZodOptional<z.ZodBoolean>;
  timeout: z.ZodOptional<z.ZodNumber>;
};

export type Target = Partial<Record<TargetKind, string>> & { in?: string; exact?: boolean; timeout?: number };

/** Exactly one target kind must be set. */
export function checkOneKind(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const kinds = TARGET_KINDS.filter((kind) => value[kind] !== undefined);
  if (kinds.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message:
        kinds.length === 0
          ? `say what to target with one of: ${TARGET_KINDS.join(', ')}`
          : `use only one of ${kinds.join(', ')}`,
    });
  }
}

/** Zod schema for a target plus extra step arguments. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function targetSchema<Extra extends z.ZodRawShape>(extra: Extra) {
  return z.strictObject({ ...targetShape, ...extra }).superRefine(checkOneKind);
}

export function targetKind(target: Target): TargetKind {
  const kind = TARGET_KINDS.find((k) => target[k] !== undefined);
  if (!kind) throw new Error('no target given');
  return kind;
}

/** Human-readable description, e.g. 'button "Save" in "New Account"'. */
export function describeTarget(target: Target): string {
  const kind = targetKind(target);
  return `${kind} "${String(target[kind])}"${target.in ? ` in "${target.in}"` : ''}`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Name matcher: whole label (default) or substring, case-insensitive, whitespace-tolerant. */
function nameMatcher(name: string, exact = true): RegExp {
  const body = escapeRegex(name.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(exact ? `^\\s*${body}\\s*$` : body, 'i');
}

/** Field labels may carry a required marker: "*Account Name" or "Last Name *". */
function labelMatcher(label: string, exact = true): RegExp {
  const body = escapeRegex(label.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(exact ? `^\\s*\\*?\\s*${body}\\s*\\*?\\s*$` : body, 'i');
}

function cssString(text: string): string {
  return JSON.stringify(text);
}

/**
 * Where to look: the whole page, or - with `in:` - a modal dialog with that title, or a
 * console workspace tab whose heading is that title (Lightning console apps open
 * "New Account" as a tab, not a modal).
 */
function scope(page: Page, target: Target): Page | Locator {
  if (!target.in) return page;
  const name = nameMatcher(target.in, target.exact);
  return page
    .getByRole('dialog', { name })
    .or(page.getByRole('tabpanel').filter({ has: page.getByRole('heading', { name }) }))
    .filter({ visible: true })
    .last();
}

/** Editable fields (inputs, picklists, lookups, checkboxes) by label. */
function fieldInputs(root: Page | Locator, label: string, exact?: boolean): Locator {
  return root.getByLabel(labelMatcher(label, exact));
}

/**
 * Read-only fields on a record page: the Details layout item, a highlights-panel item
 * (label and value in one block), or any element tagged with the field's API name.
 */
function fieldOutputs(page: Page, root: Page | Locator, field: string): Locator {
  return root
    .locator(`records-record-layout-item[field-label=${cssString(field)}]`)
    .or(root.locator('records-highlights-details-item').filter({ has: page.getByText(field, { exact: true }) }))
    .or(root.locator(`[data-target-selection-name$=${cssString('.' + field)}]`));
}

/**
 * Visible options in a picklist/lookup dropdown (or anywhere under root).
 * Picklists match the whole label. Lookups match options that *start with* the name, so the
 * "Show more results for ..." and "New Account" entries Lightning adds are never picked.
 */
export function optionsNamed(root: Page | Locator, name: string, match: 'exact' | 'startsWith' = 'exact'): Locator {
  const body = escapeRegex(name.trim()).replace(/\s+/g, '\\s+');
  const pattern = match === 'exact' ? nameMatcher(name, true) : new RegExp(`^\\s*${body}`, 'i');
  return root.getByRole('option', { name: pattern }).filter({ visible: true });
}

/** All visible elements matching the target. Fields resolve to editable inputs only. */
export function locateAll(page: Page, target: Target): Locator {
  const root = scope(page, target);
  const kind = targetKind(target);
  const value = target[kind] as string;
  const exact = target.exact;

  let locator: Locator;
  if (kind === 'field') {
    locator = fieldInputs(root, value, exact);
  } else if (kind === 'text') {
    locator = root.getByText(value, { exact: exact ?? false });
  } else if (kind === 'selector') {
    locator = root.locator(value);
  } else {
    locator = root.getByRole(kind, { name: nameMatcher(value, exact) });
  }
  return locator.filter({ visible: true });
}

/** The first visible element matching the target. */
export function locate(page: Page, target: Target): Locator {
  return locateAll(page, target).first();
}

/**
 * For reading values: a field target matches its input (in a form) or its read-only
 * display (on a record page). Other targets behave like locate().
 */
export function locateForRead(page: Page, target: Target): { input: Locator; any: Locator } {
  const input = locate(page, target);
  if (targetKind(target) !== 'field') return { input, any: input };
  const output = fieldOutputs(page, scope(page, target), target.field as string).filter({ visible: true });
  return { input, any: input.or(output).first() };
}
