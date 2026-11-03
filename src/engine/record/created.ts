import type { OrgClient } from '../types.js';
import type { CreatedRecord, Recording } from './types.js';

/** Allowance for clock differences between this machine and Salesforce. */
const CLOCK_SKEW_MS = 30_000;

/**
 * Objects the user may have created records of while recording: any object whose pages
 * they visited (/lightning/o/Account/..., /lightning/r/Contact/...) and any "New <Object>"
 * dialog they clicked in.
 */
export function candidateObjects(recording: Recording, labelToName: Record<string, string> = {}): string[] {
  const objects = new Set<string>();
  const urls = [...recording.navigations.map((n) => n.url), ...recording.actions.map((a) => a.url ?? '')];
  for (const url of urls) {
    const match = /\/lightning\/[or]\/(\w+)\//.exec(url);
    if (match) objects.add(match[1]);
  }
  for (const event of recording.events) {
    const label = /^New\s+(.+)$/i.exec(event.dialog ?? '')?.[1]?.trim();
    if (!label) continue;
    const name = labelToName[label.toLowerCase()] ?? (/^\w+$/.test(label) ? label : undefined);
    if (name) objects.add(name);
  }
  return [...objects];
}

/** Records of these objects created by the user since the recording started, oldest first. */
export async function findCreatedRecords(
  client: OrgClient,
  objects: string[],
  since: Date,
  userId: string
): Promise<CreatedRecord[]> {
  const after = new Date(since.getTime() - CLOCK_SKEW_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const found: CreatedRecord[] = [];
  for (const sobject of objects) {
    const where = `WHERE CreatedById = '${userId}' AND CreatedDate >= ${after} ORDER BY CreatedDate`;
    // eslint-disable-next-line no-await-in-loop
    const result = await client
      .query(`SELECT Id, Name, CreatedDate FROM ${sobject} ${where}`)
      // Some objects have no Name field (Case, Task...).
      .catch(() => client.query(`SELECT Id, CreatedDate FROM ${sobject} ${where}`))
      .catch(() => undefined);
    for (const record of result?.records ?? []) {
      found.push({
        sobject,
        id: String(record.Id),
        name: typeof record.Name === 'string' ? record.Name : undefined,
        createdAt: String(record.CreatedDate),
      });
    }
  }
  return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
