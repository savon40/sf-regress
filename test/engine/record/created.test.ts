import { expect } from 'chai';
import { candidateObjects, findCreatedRecords } from '../../../src/engine/record/created.js';
import type { Recording } from '../../../src/engine/record/types.js';
import { MockOrg } from '../mock-org.js';

describe('created records', () => {
  const recording: Recording = {
    baseUrl: 'https://x',
    startedAt: '2026-01-01T00:00:00.000Z',
    actions: [{ name: 'navigate', url: 'https://x/lightning/o/Account/list' }],
    navigations: [{ t: 1, url: 'https://x/lightning/r/Opportunity/006000000000001AAA/view' }],
    events: [
      { t: 2, url: '', role: 'button', name: 'Save', value: null, ids: [], field: null, dialog: 'New Contact' },
      {
        t: 3,
        url: '',
        role: 'button',
        name: 'Save',
        value: null,
        ids: [],
        field: null,
        dialog: 'New Opportunity Product',
      },
    ],
  };

  it('finds objects from visited pages and "New ..." dialogs', () => {
    expect(candidateObjects(recording, { 'opportunity product': 'OpportunityLineItem' })).to.have.members([
      'Account',
      'Opportunity',
      'Contact',
      'OpportunityLineItem',
    ]);
  });

  it('queries each object for records the user created since the start, oldest first', async () => {
    const org = new MockOrg();
    org.onQuery = (soql) => {
      if (soql.includes('FROM Case') && soql.includes('Name')) throw new Error('No such column Name');
      const sobject = /FROM (\w+)/.exec(soql)?.[1];
      const records =
        sobject === 'Account'
          ? [{ Id: '001B', Name: 'B', CreatedDate: '2026-01-01T00:02:00.000+0000' }]
          : sobject === 'Case'
          ? [{ Id: '500A', CreatedDate: '2026-01-01T00:01:00.000+0000' }]
          : [];
      return { totalSize: records.length, done: true, records };
    };
    const found = await findCreatedRecords(org, ['Account', 'Case'], new Date('2026-01-01T00:00:00Z'), '005U');
    expect(found).to.deep.equal([
      { sobject: 'Case', id: '500A', name: undefined, createdAt: '2026-01-01T00:01:00.000+0000' },
      { sobject: 'Account', id: '001B', name: 'B', createdAt: '2026-01-01T00:02:00.000+0000' },
    ]);
    expect(org.calls[0].soql).to.equal(
      "SELECT Id, Name, CreatedDate FROM Account WHERE CreatedById = '005U' AND CreatedDate >= 2025-12-31T23:59:30Z ORDER BY CreatedDate"
    );
  });
});
