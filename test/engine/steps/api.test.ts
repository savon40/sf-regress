import { expect } from 'chai';
import { expectFailure, harness, runStep, type Harness } from './helpers.js';

describe('api steps', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  describe('api.create', () => {
    it('creates the record, returns fields plus Id, and tracks it for cleanup', async () => {
      const out = await runStep(h, 'api.create', { sobject: 'Account', fields: { Name: 'Acme' } });
      const value = out?.value as { Id: string; Name: string };
      expect(value.Name).to.equal('Acme');
      expect(h.org.records.has(value.Id)).to.equal(true);
      expect(h.cleanup.records()).to.deep.equal([{ sobject: 'Account', id: value.Id }]);
      expect(out?.detail).to.equal(`Account ${value.Id}`);
    });

    it('resolves variables and relative dates in fields', async () => {
      h.vars.set('acme', { Id: '001X' });
      await runStep(h, 'api.create', {
        sobject: 'Opportunity',
        fields: { AccountId: '$acme.Id', CloseDate: '+30d', Amount: 60000 },
      });
      expect(h.org.calls[0].fields).to.deep.equal({ AccountId: '001X', CloseDate: '2026-01-31', Amount: 60000 });
    });

    it('fails with the API error and tracks nothing', async () => {
      h.org.failNext = { op: 'create', error: 'REQUIRED_FIELD_MISSING: Required fields are missing: [StageName]' };
      const message = await expectFailure(runStep(h, 'api.create', { sobject: 'Opportunity', fields: {} }));
      expect(message).to.match(/REQUIRED_FIELD_MISSING/);
      expect(h.cleanup.records()).to.have.length(0);
    });

    it('rejects unknown arguments', async () => {
      const message = await expectFailure(runStep(h, 'api.create', { sobject: 'Account', field: {} }));
      expect(message).to.match(/field/);
    });
  });

  describe('api.update', () => {
    it('updates the record', async () => {
      const id = await h.org.create('Account', { Name: 'Old' });
      h.vars.set('acme', { Id: id });
      await runStep(h, 'api.update', { sobject: 'Account', id: '$acme.Id', fields: { Name: 'New' } });
      expect(h.org.records.get(id)?.fields.Name).to.equal('New');
    });

    it('fails when the id resolves to nothing', async () => {
      h.vars.set('acme', {});
      const message = await expectFailure(runStep(h, 'api.update', { sobject: 'Account', id: '$acme.Id', fields: {} }));
      expect(message).to.match(/id must resolve to a non-empty string, got undefined/);
    });
  });

  describe('api.delete', () => {
    it('deletes the record and stops tracking it', async () => {
      const out = await runStep(h, 'api.create', { sobject: 'Account', fields: { Name: 'Acme' } });
      const id = (out?.value as { Id: string }).Id;
      h.vars.set('acme', { Id: id });
      await runStep(h, 'api.delete', { sobject: 'Account', id: '$acme.Id' });
      expect(h.org.records.has(id)).to.equal(false);
      expect(h.cleanup.records()).to.have.length(0);
    });
  });

  describe('api.query', () => {
    it('returns the query result with an interpolated SOQL string', async () => {
      const id = await h.org.create('Opportunity', { StageName: 'Prospecting' });
      h.vars.set('opp', { Id: id });
      const out = await runStep(h, 'api.query', { soql: "SELECT StageName FROM Opportunity WHERE Id = '$opp.Id'" });
      expect(h.org.calls.at(-1)?.soql).to.equal(`SELECT StageName FROM Opportunity WHERE Id = '${id}'`);
      expect((out?.value as { records: Array<{ StageName: string }> }).records[0].StageName).to.equal('Prospecting');
      expect(out?.detail).to.equal('1 record');
    });
  });

  describe('api.track', () => {
    it('tracks every returned record for cleanup using its type', async () => {
      h.org.onQuery = () => ({
        totalSize: 2,
        done: true,
        records: [
          { attributes: { type: 'Case' }, Id: '500A' },
          { attributes: { type: 'Case' }, Id: '500B' },
        ],
      });
      const out = await runStep(h, 'api.track', { soql: 'SELECT Id FROM Case WHERE CreatedDate = TODAY' });
      expect(h.cleanup.records()).to.deep.equal([
        { sobject: 'Case', id: '500A' },
        { sobject: 'Case', id: '500B' },
      ]);
      expect(out?.detail).to.equal('tracking 2 records for cleanup');
    });

    it('fails when the query does not select Id', async () => {
      h.org.onQuery = () => ({ totalSize: 1, done: true, records: [{ attributes: { type: 'Case' }, Subject: 'x' }] });
      const message = await expectFailure(runStep(h, 'api.track', { soql: 'SELECT Subject FROM Case' }));
      expect(message).to.match(/must SELECT Id/);
    });

    it('uses the sobject argument when records have no type', async () => {
      h.org.onQuery = () => ({ totalSize: 1, done: true, records: [{ Id: '500A' }] });
      await runStep(h, 'api.track', { soql: 'SELECT Id FROM Case', sobject: 'Case' });
      expect(h.cleanup.records()).to.deep.equal([{ sobject: 'Case', id: '500A' }]);
    });
  });
});
