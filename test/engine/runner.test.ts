import { expect } from 'chai';
import { parseTest } from '../../src/engine/loader.js';
import { isProduction, runTests, type RunEvent } from '../../src/engine/runner.js';
import { DEV_ORG, MockOrg, PROD_ORG } from './mock-org.js';

const EXAMPLE = `
name: Large opp
params:
  accountName: "Regress Acme $run.id"
steps:
  - api.create:
      sobject: Account
      as: acme
      fields: { Name: $accountName }
  - api.create:
      sobject: Opportunity
      as: opp
      fields: { Name: "Regress Big Opp", AccountId: $acme.Id, Amount: 60000, StageName: Prospecting, CloseDate: "+30d" }
  - api.query:
      soql: "SELECT StageName FROM Opportunity WHERE Id = '$opp.Id'"
      as: result
  - assert.equals: { actual: $result.records.0.StageName, expected: Prospecting }
`;

const options = { runId: 'abc123', now: () => new Date(2026, 0, 1) };

describe('runner', () => {
  it('runs the example test end to end and cleans up in reverse order', async () => {
    const org = new MockOrg();
    const summary = await runTests([parseTest(EXAMPLE)], org, options);

    expect(summary.passed).to.equal(1);
    expect(summary.failed).to.equal(0);
    const [test] = summary.tests;
    expect(test.status).to.equal('passed');
    expect(test.steps.map((s) => s.status)).to.deep.equal(['passed', 'passed', 'passed', 'passed']);
    expect(test.steps[0].detail).to.match(/^Account ACC\d+ -> \$acme$/);

    const creates = org.calls.filter((c) => c.op === 'create');
    expect(creates[0].fields).to.deep.equal({ Name: 'Regress Acme abc123' });
    expect(creates[1].fields).to.include({ CloseDate: '2026-01-31' });

    expect(org.deletes()).to.deep.equal([...test.cleanup.deleted].map((d) => d.id));
    expect(test.cleanup.deleted.map((d) => d.sobject)).to.deep.equal(['Opportunity', 'Account']);
    expect(org.records.size).to.equal(0);
  });

  it('skips the remaining steps after a failure and still cleans up', async () => {
    const org = new MockOrg();
    const test = parseTest(EXAMPLE.replace('expected: Prospecting', 'expected: Closed Won') + '  - assert.exists: 1\n');
    const summary = await runTests([test], org, options);

    const [result] = summary.tests;
    expect(summary.failed).to.equal(1);
    expect(result.status).to.equal('failed');
    expect(result.steps.map((s) => s.status)).to.deep.equal(['passed', 'passed', 'passed', 'failed', 'skipped']);
    expect(result.steps[3].error).to.match(/expected "Closed Won", got "Prospecting"/);
    expect(result.cleanup.deleted).to.have.length(2);
    expect(org.records.size).to.equal(0);
  });

  it('cleans up records from earlier steps when a create fails', async () => {
    const org = new MockOrg();
    org.failNext = { op: 'create', sobject: 'Opportunity', error: 'FIELD_CUSTOM_VALIDATION_EXCEPTION: Amount too big' };
    const summary = await runTests([parseTest(EXAMPLE)], org, options);
    const [result] = summary.tests;
    expect(result.steps[1].error).to.match(/Amount too big/);
    expect(result.cleanup.deleted.map((d) => d.sobject)).to.deep.equal(['Account']);
    expect(org.records.size).to.equal(0);
  });

  it('fails a step that uses an unknown variable', async () => {
    const test = parseTest('name: x\nsteps:\n  - assert.equals: { actual: $nope.Id, expected: 1 }');
    const summary = await runTests([test], new MockOrg(), options);
    expect(summary.tests[0].steps[0].error).to.match(/Unknown variable \$nope/);
  });

  it('exposes $run.id and params to steps', async () => {
    const test = parseTest(`
name: x
params: { greeting: "hi $run.id" }
steps:
  - assert.equals: { actual: $greeting, expected: hi abc123 }
`);
    const summary = await runTests([test], new MockOrg(), options);
    expect(summary.passed).to.equal(1);
  });

  it('runs tests in order and isolates their variables', async () => {
    const first = parseTest('name: one\nsteps:\n  - api.query: { soql: "SELECT Id FROM A", as: r }');
    const second = parseTest('name: two\nsteps:\n  - assert.exists: $r');
    const summary = await runTests([first, second], new MockOrg(), options);
    expect(summary.tests.map((t) => t.status)).to.deep.equal(['passed', 'failed']);
  });

  it('emits progress events', async () => {
    const events: Array<RunEvent['type']> = [];
    await runTests([parseTest(EXAMPLE)], new MockOrg(), { ...options, onEvent: (e) => events.push(e.type) });
    expect(events).to.deep.equal(['test:start', 'step:end', 'step:end', 'step:end', 'step:end', 'test:end']);
  });

  describe('production safety', () => {
    it('classifies orgs', () => {
      expect(isProduction(DEV_ORG)).to.equal(false);
      expect(isProduction({ ...PROD_ORG, isSandbox: true })).to.equal(false);
      expect(isProduction({ ...PROD_ORG, trialExpirationDate: '2026-12-01' })).to.equal(false);
      expect(isProduction(PROD_ORG)).to.equal(true);
    });

    it('refuses to run against production and touches nothing', async () => {
      const org = new MockOrg();
      org.orgInfo = PROD_ORG;
      const summary = await runTests([parseTest(EXAMPLE)], org, options);
      const [result] = summary.tests;
      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/Refusing to run against production/);
      expect(result.steps.every((s) => s.status === 'skipped')).to.equal(true);
      expect(org.calls).to.have.length(0);
    });

    it('runs against production with --allow-production', async () => {
      const org = new MockOrg();
      org.orgInfo = PROD_ORG;
      const summary = await runTests([parseTest(EXAMPLE)], org, { ...options, allowProduction: true });
      expect(summary.passed).to.equal(1);
    });

    it('runs against production when the test sets allowProduction', async () => {
      const org = new MockOrg();
      org.orgInfo = PROD_ORG;
      const summary = await runTests([parseTest('allowProduction: true\n' + EXAMPLE)], org, options);
      expect(summary.passed).to.equal(1);
    });
  });
});
