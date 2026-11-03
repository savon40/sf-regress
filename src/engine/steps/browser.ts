import type { Locator, Page } from 'playwright';
import { z } from 'zod';
import { looselyEqual } from './assert.js';
import { variableName } from './api.js';
import { describeTarget, locate, locateAll, locateForRead, optionsNamed, targetSchema, type Target } from './locate.js';
import { asText, show, StepFailure, type StepType } from './step.js';

/** Default wait for elements and conditions. Lightning pages can be slow to render. */
export const DEFAULT_TIMEOUT = 30_000;

const timeoutOf = (args: { timeout?: number }): number => args.timeout ?? DEFAULT_TIMEOUT;

/** Poll until check() returns true or the timeout passes. Returns the last check result. */
async function waitUntil(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitVisible(locator: Locator, target: Target, timeout: number): Promise<void> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
  } catch {
    const message = `Could not find a visible ${describeTarget(target)} within ${timeout / 1000}s`;
    throw new StepFailure(message + (await tabHint(locator.page())));
  }
}

/** Fields often live on a tab that isn't open (e.g. Details). Name the unselected tabs to help. */
async function tabHint(page: Page): Promise<string> {
  try {
    const tabs = page.getByRole('tab', { selected: false }).filter({ visible: true });
    const names = (await tabs.allInnerTexts()).map((t) => t.trim()).filter((t) => t && t.length < 40);
    const unique = [...new Set(names)].slice(0, 6);
    return unique.length ? `. Is it on another tab? Not selected: ${unique.join(', ')}` : '';
  } catch {
    return '';
  }
}

type ElementLike = { tagName: string; getAttribute(name: string): string | null };

async function tagOf(locator: Locator): Promise<string> {
  return locator.evaluate((node) => (node as unknown as ElementLike).tagName.toLowerCase());
}

/**
 * The current value of an element, as text lines: an input's value, a picklist's selected
 * value, or a record page field's displayed value (without its label). Uses Playwright
 * locators throughout because Lightning fields live inside shadow DOM.
 */
async function readValue(locator: Locator, label?: string): Promise<string[]> {
  const tag = await tagOf(locator);
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return [await locator.inputValue()];
  const dataValue = await locator.getAttribute('data-value');
  if (dataValue !== null) return [dataValue];

  const output = locator.locator('[slot="outputField"]');
  const text = await visibleText((await output.count()) > 0 ? output.first() : locator);
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // Highlights-panel fields render "Close Date\n12/31/2026": drop the label line.
  if (label && lines.length > 1 && lines[0].replace(/^\*/, '').toLowerCase() === label.toLowerCase()) lines.shift();
  return lines;
}

/**
 * Rendered text of an element. innerText covers Lightning's synthetic shadow DOM; for native
 * shadow roots (where innerText is empty) walk the composed tree, following slots.
 */
async function visibleText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const inner = (element as HTMLElement).innerText?.trim();
    if (inner) return inner;
    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (node instanceof HTMLSlotElement) return node.assignedNodes({ flatten: true }).map(walk).join('');
      if (node instanceof Element && getComputedStyle(node).display === 'none') return '';
      const children = node instanceof Element && node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
      const block = node instanceof Element && /^(DIV|P|BR|LI|TR|H\d)$/.test(node.tagName) ? '\n' : '';
      return block + [...children].map(walk).join('') + block;
    };
    return walk(element).trim();
  });
}

/** Wait until the target shows a value that passes the check. Returns what was last seen. */
async function waitForValue(
  page: Page,
  args: Target,
  check: (full: string, firstLine: string) => boolean
): Promise<{ ok: boolean; actual: string }> {
  const { any } = locateForRead(page, args);
  await waitVisible(any, args, timeoutOf(args));
  let actual = '';
  const ok = await waitUntil(async () => {
    const lines = await readValue(any, args.field);
    actual = lines.length > 1 ? lines.join('\n') : lines[0] ?? '';
    return check(lines.join('\n'), lines[0] ?? '');
  }, timeoutOf(args));
  return { ok, actual };
}

// ---------------------------------------------------------------------------

const gotoArgs = z.strictObject({ path: z.string().min(1) });

/** browser.goto - open a page. Paths like /lightning/o/Account/home are relative to the org. */
export const browserGoto: StepType<z.infer<typeof gotoArgs>> = {
  type: 'browser.goto',
  schema: gotoArgs,
  shorthand: 'path',
  async run(args, ctx) {
    const { page, baseUrl } = await ctx.browser();
    const url = /^https?:\/\//.test(args.path) ? args.path : new URL(args.path, baseUrl).toString();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (/\/secur\/|login\.salesforce\.com|\/\?startURL=/i.test(page.url())) {
      throw new StepFailure('Ended up on a login page - the browser session is not logged in');
    }
    return { detail: args.path };
  },
};

const clickArgs = targetSchema({});

/** browser.click - click an element. */
export const browserClick: StepType<z.infer<typeof clickArgs>> = {
  type: 'browser.click',
  schema: clickArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const target = locate(page, args);
    await waitVisible(target, args, timeoutOf(args));
    await target.click({ timeout: timeoutOf(args) });
    return { detail: describeTarget(args) };
  },
};

const fillArgs = targetSchema({ value: z.unknown() });

/** browser.fill - type a value into a field (replaces what's there). */
export const browserFill: StepType<z.infer<typeof fillArgs>> = {
  type: 'browser.fill',
  schema: fillArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const target = locate(page, args);
    await waitVisible(target, args, timeoutOf(args));
    const value = asText(args.value);
    await target.fill(value, { timeout: timeoutOf(args) });
    return { detail: `${describeTarget(args)} = ${show(value)}` };
  },
};

const selectArgs = targetSchema({ value: z.unknown() });

/**
 * browser.select - choose a value in a picklist or lookup: { field: Industry, value: Banking }.
 * Works with native <select>, Lightning picklists (click, then pick the option) and
 * lookups (type the text, then pick the first matching result).
 */
export const browserSelect: StepType<z.infer<typeof selectArgs>> = {
  type: 'browser.select',
  schema: selectArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const timeout = timeoutOf(args);
    const option = asText(args.value);
    const field = locate(page, args);
    await waitVisible(field, args, timeout);

    const tag = await tagOf(field);
    if (tag === 'select') {
      await field.selectOption({ label: option }, { timeout });
    } else {
      await pickOption(page, field, option, tag === 'input', timeout);
    }
    return { detail: `${describeTarget(args)} = ${show(option)}` };
  },
};

const PICK_ATTEMPTS = 3;

/**
 * Open a Lightning picklist (or type into a lookup) and click the option. Lightning closes
 * dropdowns when the page scrolls or re-renders, so the open-and-click sequence is retried,
 * and options are looked up inside the field's own dropdown (aria-controls) when possible.
 */
async function pickOption(
  page: Page,
  field: Locator,
  option: string,
  isLookup: boolean,
  timeout: number
): Promise<void> {
  const deadline = Date.now() + timeout;
  for (let attempt = 1; ; attempt++) {
    const last = attempt === PICK_ATTEMPTS || Date.now() >= deadline;
    const wait = last ? Math.max(deadline - Date.now(), 1000) : 5000;
    try {
      // eslint-disable-next-line no-await-in-loop
      await openDropdown(field, option, isLookup, wait);
      // eslint-disable-next-line no-await-in-loop
      const listId = await field.getAttribute('aria-controls');
      const root = listId ? page.locator(`[id=${JSON.stringify(listId)}]`) : page;
      // Lookups list "Acme Corp • San Francisco": match on the start of the name.
      const choice = optionsNamed(root, option, isLookup ? 'startsWith' : 'exact').first();
      // eslint-disable-next-line no-await-in-loop
      await choice.click({ timeout: wait });
      return;
    } catch (error) {
      if (last)
        throw new StepFailure(`Could not pick "${option}" in ${isLookup ? 'lookup' : 'picklist'}: ${short(error)}`);
    }
  }
}

async function openDropdown(field: Locator, option: string, isLookup: boolean, timeout: number): Promise<void> {
  await field.scrollIntoViewIfNeeded({ timeout });
  if (isLookup) {
    // Lightning lookups search on keystrokes, so type rather than set the value.
    await field.fill('', { timeout });
    await field.pressSequentially(option, { delay: 40, timeout });
  } else if ((await field.getAttribute('aria-expanded')) !== 'true') {
    await field.click({ timeout });
  }
}

/** First line of an error, without Playwright's call log. */
function short(error: unknown): string {
  return String(error instanceof Error ? error.message : error).split('\n')[0];
}

const pressArgs = z.strictObject({ key: z.string().min(1) });

/** browser.press - press a key in the focused element, e.g. Enter or Tab. */
export const browserPress: StepType<z.infer<typeof pressArgs>> = {
  type: 'browser.press',
  schema: pressArgs,
  shorthand: 'key',
  async run(args, ctx) {
    const { page } = await ctx.browser();
    await page.keyboard.press(args.key);
    return { detail: args.key };
  },
};

const expectArgs = targetSchema({});

/** browser.expectVisible - the element is (or becomes) visible. */
export const browserExpectVisible: StepType<z.infer<typeof expectArgs>> = {
  type: 'browser.expectVisible',
  schema: expectArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    await waitVisible(locate(page, args), args, timeoutOf(args));
    return { detail: describeTarget(args) };
  },
};

/** browser.expectHidden - no visible element matches (waits for it to disappear). */
export const browserExpectHidden: StepType<z.infer<typeof expectArgs>> = {
  type: 'browser.expectHidden',
  schema: expectArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const all = locateAll(page, args);
    if (!(await waitUntil(async () => (await all.count()) === 0, timeoutOf(args)))) {
      throw new StepFailure(`Expected no visible ${describeTarget(args)}, but it is still shown`);
    }
    return { detail: describeTarget(args) };
  },
};

const valueArgs = targetSchema({ value: z.unknown() });

/** browser.expectValue - a field's value equals the expected value (inputs, picklists, record page fields). */
export const browserExpectValue: StepType<z.infer<typeof valueArgs>> = {
  type: 'browser.expectValue',
  schema: valueArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const expected = args.value ?? '';
    // Multi-line displays (lookups with hover text, addresses) match on the whole text or the first line.
    const { ok, actual } = await waitForValue(
      page,
      args,
      (full, first) => looselyEqual(full, expected) || looselyEqual(first, expected)
    );
    if (!ok) throw new StepFailure(`${describeTarget(args)}: expected ${show(args.value)}, got ${show(actual)}`);
    return { detail: `${describeTarget(args)} = ${show(actual)}` };
  },
};

const textArgs = targetSchema({ contains: z.unknown() });

/** browser.expectText - an element's text (or a field's value) contains the expected text. Case-insensitive. */
export const browserExpectText: StepType<z.infer<typeof textArgs>> = {
  type: 'browser.expectText',
  schema: textArgs,
  async run(args, ctx) {
    const { page } = await ctx.browser();
    const expected = asText(args.contains);
    const { ok, actual } = await waitForValue(page, args, (full) =>
      full.toLowerCase().includes(expected.toLowerCase())
    );
    if (!ok)
      throw new StepFailure(`${describeTarget(args)}: expected to contain ${show(expected)}, got ${show(actual)}`);
    return { detail: `${describeTarget(args)} contains ${show(expected)}` };
  },
};

const RECORD_URL = /\/lightning\/r\/(\w+)\/([a-zA-Z0-9]{15,18})(?:\/|$)/;
/** Allowance for clock differences between this machine and Salesforce. */
const CLOCK_SKEW_MS = 2 * 60_000;

const captureArgs = z.strictObject({ as: variableName, timeout: z.number().int().positive().optional() });

/**
 * browser.captureRecord - read the record the browser is showing (from the URL) into a variable:
 * { Id, sobject, url }. If this test's user created it during the test, it is also deleted at
 * cleanup. Use it right after saving a new record in the UI.
 */
export const browserCaptureRecord: StepType<z.infer<typeof captureArgs>> = {
  type: 'browser.captureRecord',
  schema: captureArgs,
  storesResult: true,
  shorthand: 'as',
  async run(args, ctx) {
    const { page } = await ctx.browser();
    try {
      await page.waitForURL(RECORD_URL, { timeout: timeoutOf(args) });
    } catch {
      throw new StepFailure(`The browser is not on a record page (URL: ${new URL(page.url()).pathname})`);
    }
    const [, sobject, id] = RECORD_URL.exec(page.url()) as RegExpExecArray;

    const result = await ctx.client.query(`SELECT Id, CreatedById, CreatedDate FROM ${sobject} WHERE Id = '${id}'`);
    const record = result.records[0];
    if (!record) throw new StepFailure(`${sobject} ${id} from the URL was not found`);

    const createdAt = new Date(asText(record.CreatedDate)).getTime();
    const createdByTest = record.CreatedById === ctx.org.userId && createdAt >= ctx.startedAt.getTime() - CLOCK_SKEW_MS;
    if (createdByTest) ctx.cleanup.track(sobject, asText(record.Id));

    return {
      value: { Id: record.Id, sobject, url: page.url() },
      detail: `${sobject} ${asText(record.Id)}${createdByTest ? '' : ' (existing record, not cleaned up)'}`,
    };
  },
};
