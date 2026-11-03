import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { ClickEvent, Navigation, Recording, RecordedAction } from '../engine/record/types.js';
import { frontdoorLogin, type FrontdoorOptions } from './session.js';

/**
 * Runs in every page during a recording. Playwright's recorder sometimes picks brittle
 * selectors for Lightning (generated ids like [id="1197:0"]) and doesn't record what the
 * element was. This listener captures that context for every click - looking through
 * shadow DOM via composedPath() - so post-processing can repair those steps.
 */
const CLICK_LISTENER = `(() => {
  if (window.__regressListening) return;
  window.__regressListening = true;
  const INTERACTIVE = new Set(['button','link','option','menuitem','menuitemradio','menuitemcheckbox','tab','checkbox','radio','switch','combobox','textbox','searchbox','spinbutton','treeitem']);
  const roleOf = (el) => {
    const role = el.getAttribute && el.getAttribute('role');
    if (role) return role;
    switch (el.tagName) {
      case 'A': return el.hasAttribute('href') ? 'link' : '';
      case 'BUTTON': return 'button';
      case 'SELECT': return 'combobox';
      case 'TEXTAREA': return 'textbox';
      case 'INPUT': return el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : ['button','submit'].includes(el.type) ? 'button' : 'textbox';
      default: return '';
    }
  };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const nameOf = (el) => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || typeof window.__regressEvent !== 'function') return;
    const path = event.composedPath().filter((n) => n instanceof Element);
    if (!path.length) return;
    const el = path.find((n) => INTERACTIVE.has(roleOf(n))) || path[0];
    const layout = path.find((n) => n.tagName === 'RECORDS-RECORD-LAYOUT-ITEM');
    const dialog = path.find((n) => n.getAttribute('role') === 'dialog');
    const heading = dialog && dialog.querySelector('h1, h2');
    window.__regressEvent({
      t: Date.now(),
      url: location.href,
      role: roleOf(el),
      name: nameOf(el),
      value: el.getAttribute('data-value'),
      ids: path.map((n) => n.id).filter(Boolean).slice(0, 15),
      field: layout ? layout.getAttribute('field-label') : null,
      dialog: dialog ? clean(dialog.getAttribute('aria-label') || (heading && heading.textContent)) : null,
    });
  }, true);
})();`;

/** Attach the listener and navigation tracking to a context. Returns the live event lists. */
export async function instrument(
  context: BrowserContext
): Promise<{ events: ClickEvent[]; navigations: Navigation[] }> {
  const events: ClickEvent[] = [];
  const navigations: Navigation[] = [];
  await context.exposeBinding('__regressEvent', (_source, event: ClickEvent) => {
    events.push(event);
  });
  await context.addInitScript(CLICK_LISTENER);
  const track = (page: Page): void => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations.push({ t: Date.now(), url: frame.url() });
    });
  };
  context.pages().forEach(track);
  context.on('page', track);
  return { events, navigations };
}

/**
 * Start Playwright's recorder in a JSONL mode on a context. This uses Playwright's internal
 * `_showRecorder` (the same call `playwright codegen` makes), so Playwright is pinned to an
 * exact version in package.json.
 */
export async function startRecorder(context: BrowserContext, outputFile: string): Promise<void> {
  /* eslint-disable no-underscore-dangle -- Playwright's internal recorder API */
  const internal = context as unknown as {
    _showRecorder?: (options: Record<string, unknown>) => Promise<void>;
  };
  if (typeof internal._showRecorder !== 'function') {
    throw new Error('This Playwright version has no recorder API; reinstall sf-regress to get the pinned version.');
  }
  await internal._showRecorder({ language: 'jsonl', mode: 'recording', outputFile, handleSIGINT: false });
  /* eslint-enable no-underscore-dangle */
}

export function parseRecorderOutput(text: string): RecordedAction[] {
  return text
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as RecordedAction)
    .filter((entry) => typeof entry.name === 'string');
}

export type RecordOptions = FrontdoorOptions & {
  /** Called once the browser is ready, so the CLI can print instructions. */
  onReady?: () => void;
  /**
   * Drive the browser from code instead of waiting for a person to close it. The recording
   * ends when this resolves. Used for automated checks of the recording pipeline.
   */
  drive?: (page: Page) => Promise<void>;
};

/**
 * Open a visible browser logged in to the org, with Playwright's recorder toolbar, and
 * wait until the user closes the browser. Returns everything post-processing needs.
 */
export async function recordSession(options: RecordOptions): Promise<Recording> {
  const dir = await mkdtemp(join(tmpdir(), 'sf-regress-record-'));
  const outputFile = join(dir, 'recording.jsonl');
  const browser = await chromium.launch({ headless: options.headless ?? false });
  try {
    const context = await browser.newContext({ viewport: null });
    const loginPage = await context.newPage();
    const baseUrl = await frontdoorLogin(loginPage, options);
    await loginPage.close();

    const startedAt = new Date();
    const { events, navigations } = await instrument(context);
    await startRecorder(context, outputFile);
    const page = await context.newPage();
    await page.goto(new URL(options.startPath ?? '/lightning/page/home', baseUrl).toString());
    options.onReady?.();

    if (options.drive) {
      await options.drive(page);
      await page.waitForTimeout(1000); // let the recorder flush the last action
      await context.close();
    }

    // Done when the user closes the last page (or the whole browser).
    await new Promise<void>((resolve) => {
      if (options.drive) resolve();
      browser.on('disconnected', () => resolve());
      context.on('close', () => resolve());
      const check = (): void => {
        if (context.pages().length === 0) resolve();
      };
      context.on('page', (p) => p.on('close', check));
      page.on('close', check);
    });
    await browser.close().catch(() => {});

    const actions = parseRecorderOutput(await readFile(outputFile, 'utf8').catch(() => ''));
    return { baseUrl, startedAt: startedAt.toISOString(), actions, events, navigations };
  } finally {
    await browser.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
