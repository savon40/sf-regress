import type { Connection, Org } from '@salesforce/core';
import { launchFrontdoorSession } from '../browser/session.js';
import type { BrowserSession } from '../engine/index.js';

/** A fresh access token for frontdoor login, from the sf CLI's stored auth. Never logged. */
export async function freshToken(org: Org, conn: Connection): Promise<{ instanceUrl: string; accessToken: string }> {
  await org.refreshAuth();
  return { instanceUrl: conn.instanceUrl, accessToken: conn.accessToken ?? '' };
}

/** Browser factory for the engine: logs in with the CLI's existing session when first needed. */
export function browserFor(org: Org, conn: Connection, headless: boolean): () => Promise<BrowserSession> {
  return async () => launchFrontdoorSession({ ...(await freshToken(org, conn)), headless });
}
