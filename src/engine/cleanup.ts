import type { CleanupResult, OrgClient } from './types.js';

type TrackedRecord = { sobject: string; id: string };

/** Errors that mean the record is already gone (e.g. removed by a cascade delete). */
const ALREADY_DELETED = /ENTITY_IS_DELETED|NOT_FOUND|INVALID_CROSS_REFERENCE_KEY/;

/**
 * Tracks records created during a test and deletes them afterwards, newest first,
 * so children are removed before their parents.
 *
 * Anything can register a record: api.create does it automatically, api.track does it
 * for records created another way (e.g. through the UI in recorded tests).
 */
export class CleanupTracker {
  private readonly tracked: TrackedRecord[] = [];

  public track(sobject: string, id: string): void {
    if (!this.tracked.some((r) => r.id === id)) this.tracked.push({ sobject, id });
  }

  /** Stop tracking a record, e.g. because the test deleted it itself. */
  public untrack(id: string): void {
    const index = this.tracked.findIndex((r) => r.id === id);
    if (index >= 0) this.tracked.splice(index, 1);
  }

  public records(): TrackedRecord[] {
    return [...this.tracked];
  }

  public async run(client: OrgClient): Promise<CleanupResult> {
    const result: CleanupResult = { deleted: [], errors: [] };
    const toDelete = [...this.tracked].reverse();
    this.tracked.length = 0;

    for (const record of toDelete) {
      try {
        // Sequential on purpose: order matters for parent/child records.
        // eslint-disable-next-line no-await-in-loop
        await client.delete(record.sobject, record.id);
        result.deleted.push(record);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ALREADY_DELETED.test(message)) {
          result.deleted.push(record);
        } else {
          result.errors.push({ ...record, error: message });
        }
      }
    }
    return result;
  }
}
