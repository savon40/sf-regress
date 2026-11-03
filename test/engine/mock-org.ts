import type { OrgClient, OrgInfo, QueryResult, SfRecord } from '../../src/engine/types.js';

export const DEV_ORG: OrgInfo = {
  orgId: '00D000000000001',
  name: 'Dev Org',
  organizationType: 'Developer Edition',
  isSandbox: false,
  trialExpirationDate: null,
};

export const PROD_ORG: OrgInfo = { ...DEV_ORG, name: 'Prod Org', organizationType: 'Enterprise Edition' };

type Call = {
  op: 'create' | 'update' | 'delete' | 'query';
  sobject?: string;
  id?: string;
  fields?: Record<string, unknown>;
  soql?: string;
};

/**
 * In-memory OrgClient. Stores created records, answers simple
 * "SELECT ... FROM X WHERE Id = '...'" queries from them, and records every call.
 */
export class MockOrg implements OrgClient {
  public calls: Call[] = [];
  public records = new Map<string, { sobject: string; fields: Record<string, unknown> }>();
  public orgInfo: OrgInfo = DEV_ORG;
  /** Override to answer queries yourself. */
  public onQuery?: (soql: string) => QueryResult;
  /** Make the next matching operation throw. */
  public failNext?: { op: Call['op']; sobject?: string; error: string };
  private counter = 0;

  public async create(sobject: string, fields: Record<string, unknown>): Promise<string> {
    this.calls.push({ op: 'create', sobject, fields });
    this.maybeFail('create', sobject);
    this.counter += 1;
    const id = `${sobject.slice(0, 3).toUpperCase()}${String(this.counter).padStart(12, '0')}`;
    this.records.set(id, { sobject, fields: { ...fields } });
    return id;
  }

  public async update(sobject: string, id: string, fields: Record<string, unknown>): Promise<void> {
    this.calls.push({ op: 'update', sobject, id, fields });
    this.maybeFail('update', sobject);
    const record = this.records.get(id);
    if (!record) throw new Error('ENTITY_IS_DELETED: entity is deleted');
    Object.assign(record.fields, fields);
  }

  public async delete(sobject: string, id: string): Promise<void> {
    this.calls.push({ op: 'delete', sobject, id });
    this.maybeFail('delete', sobject);
    if (!this.records.delete(id)) throw new Error('ENTITY_IS_DELETED: entity is deleted');
  }

  public async query(soql: string): Promise<QueryResult> {
    this.calls.push({ op: 'query', soql });
    this.maybeFail('query');
    if (this.onQuery) return this.onQuery(soql);
    const match = /FROM\s+(\w+)\s+WHERE\s+Id\s*=\s*'([^']+)'/i.exec(soql);
    const record = match ? this.records.get(match[2]) : undefined;
    const records: SfRecord[] = record
      ? [{ attributes: { type: record.sobject }, Id: match![2], ...record.fields }]
      : [];
    return { totalSize: records.length, done: true, records };
  }

  public async getOrgInfo(): Promise<OrgInfo> {
    return this.orgInfo;
  }

  public deletes(): string[] {
    return this.calls.filter((c) => c.op === 'delete').map((c) => c.id as string);
  }

  private maybeFail(op: Call['op'], sobject?: string): void {
    const fail = this.failNext;
    if (fail?.op === op && (!fail.sobject || fail.sobject === sobject)) {
      this.failNext = undefined;
      throw new Error(fail.error);
    }
  }
}
