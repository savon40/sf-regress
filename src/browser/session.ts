import { chromium, type LaunchOptions } from 'playwright';
import type { BrowserSession } from '../engine/types.js';
import { DEFAULT_TIMEOUT } from '../engine/steps/browser.js';

export type FrontdoorOptions = {
  /** e.g. https://mydomain.my.salesforce.com */
  instanceUrl: string;
  /** A current access token for the org. Never logged. */
  accessToken: string;
  /** Page to land on after login. */
  startPath?: string;
  headless?: boolean;
  slowMo?: number;
};

/**
 * Launch Chromium and log in through /secur/frontdoor.jsp with an existing access token,
 * so no password is ever handled. The session's baseUrl is the Lightning origin the
 * login landed on (e.g. https://mydomain.lightning.force.com).
 */
export async function launchFrontdoorSession(options: FrontdoorOptions): Promise<BrowserSession> {
  const launch: LaunchOptions = { headless: options.headless ?? true, slowMo: options.slowMo };
  const browser = await chromium.launch(launch);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(DEFAULT_TIMEOUT);
    const page = await context.newPage();
    const baseUrl = await frontdoorLogin(page, options);
    await page.close();

    return {
      baseUrl,
      newPage: () => context.newPage(),
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Log a page in via frontdoor. Returns the origin it landed on. Errors never contain the token. */
export async function frontdoorLogin(
  page: import('playwright').Page,
  options: Pick<FrontdoorOptions, 'instanceUrl' | 'accessToken' | 'startPath'>
): Promise<string> {
  const startPath = options.startPath ?? '/lightning/page/home';
  const url = `${options.instanceUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(
    options.accessToken
  )}&retURL=${encodeURIComponent(startPath)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForURL((u) => !u.pathname.startsWith('/secur/'), { timeout: 60_000 });
  } catch (error) {
    // No `cause`: the original error contains the frontdoor URL, and with it the access token.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Browser login failed: ${redact(String((error as Error).message), options.accessToken)}`);
  }
  if ((await page.locator('input#username').count()) > 0) {
    throw new Error('Browser login failed: Salesforce showed the login page. Try "sf org login web" again.');
  }
  return new URL(page.url()).origin;
}

export function redact(text: string, secret: string): string {
  return secret ? text.split(secret).join('***').split(encodeURIComponent(secret)).join('***') : text;
}
