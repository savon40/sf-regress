import type { Connection } from '@salesforce/core';
import type { OrgClient, OrgInfo, QueryResult, SfRecord } from './types.js';

type SaveResult = {
  success: boolean;
  id?: string;
  errors?: Array<{ statusCode?: string; message?: string; fields?: string[] }>;
};
type SaveResultLike = SaveResult | SaveResult[];

/**
 * OrgClient backed by a @salesforce/core Connection (the same auth the sf CLI uses).
 * This is the only file in the engine that knows about jsforce.
 */
export function connectionClient(conn: Connection): OrgClient {
  return {
    async create(sobject, fields): Promise<string> {
      const result = await call(() => conn.sobject(sobject).create(fields) as Promise<SaveResultLike>);
      return checkSave(result, `create ${sobject}`);
    },
    async update(sobject, id, fields): Promise<void> {
      const result = await call(() => conn.sobject(sobject).update({ ...fields, Id: id }) as Promise<SaveResultLike>);
      checkSave(result, `update ${sobject} ${id}`);
    },
    async delete(sobject, id): Promise<void> {
      const result = await call(() => conn.sobject(sobject).destroy(id) as Promise<SaveResultLike>);
      checkSave(result, `delete ${sobject} ${id}`);
    },
    async query(soql): Promise<QueryResult> {
      const result = await call(async () => conn.query(soql, { autoFetch: true, maxFetch: 10_000 }));
      return {
        totalSize: result.totalSize,
        done: result.done,
        records: result.records as SfRecord[],
      } satisfies QueryResult;
    },
    async getOrgInfo(): Promise<OrgInfo> {
      const result = await conn.query<{
        Id: string;
        Name: string;
        OrganizationType: string;
        IsSandbox: boolean;
        TrialExpirationDate: string | null;
      }>('SELECT Id, Name, OrganizationType, IsSandbox, TrialExpirationDate FROM Organization LIMIT 1');
      const org = result.records[0];
      return {
        orgId: org.Id,
        name: org.Name,
        organizationType: org.OrganizationType,
        isSandbox: org.IsSandbox,
        trialExpirationDate: org.TrialExpirationDate,
        username: conn.getUsername(),
        instanceUrl: conn.instanceUrl,
      };
    },
  };
}

/** Run a jsforce call and make its errors readable: "REQUIRED_FIELD_MISSING: Required fields are missing: [StageName]". */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const e = error as { errorCode?: string; name?: string; message?: string };
    const code = e.errorCode ?? (e.name && e.name !== 'Error' ? e.name : undefined);
    const text = e.message ?? String(error);
    throw new Error(code && !text.startsWith(code) ? `${code}: ${text}` : text, { cause: error });
  }
}

function checkSave(result: SaveResultLike, action: string): string {
  const save = Array.isArray(result) ? result[0] : result;
  if (!save?.success) {
    const errors = (save?.errors ?? [])
      .map(
        (e) => `${e.statusCode ?? 'ERROR'}: ${e.message ?? ''}${e.fields?.length ? ` [${e.fields.join(', ')}]` : ''}`
      )
      .join('; ');
    throw new Error(`Could not ${action}: ${errors || 'unknown error'}`);
  }
  return save.id as string;
}
