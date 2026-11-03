import { expect } from 'chai';
import { CleanupTracker } from '../../src/engine/cleanup.js';
import { MockOrg } from './mock-org.js';

describe('cleanup', () => {
  it('deletes tracked records newest first', async () => {
    const org = new MockOrg();
    const tracker = new CleanupTracker();
    const account = await org.create('Account', {});
    const opp = await org.create('Opportunity', {});
    tracker.track('Account', account);
    tracker.track('Opportunity', opp);

    const result = await tracker.run(org);
    expect(org.deletes()).to.deep.equal([opp, account]);
    expect(result.deleted).to.have.length(2);
    expect(result.errors).to.have.length(0);
    expect(tracker.records()).to.have.length(0);
  });

  it('ignores duplicates and untracked records', async () => {
    const org = new MockOrg();
    const tracker = new CleanupTracker();
    const a = await org.create('Account', {});
    const b = await org.create('Account', {});
    tracker.track('Account', a);
    tracker.track('Account', a);
    tracker.track('Account', b);
    tracker.untrack(b);
    await tracker.run(org);
    expect(org.deletes()).to.deep.equal([a]);
  });

  it('treats an already-deleted record as cleaned up', async () => {
    const org = new MockOrg();
    const tracker = new CleanupTracker();
    tracker.track('Account', 'ACC-gone');
    const result = await tracker.run(org);
    expect(result.deleted).to.have.length(1);
    expect(result.errors).to.have.length(0);
  });

  it('keeps going and reports when a delete fails', async () => {
    const org = new MockOrg();
    const tracker = new CleanupTracker();
    const a = await org.create('Account', {});
    const c = await org.create('Contact', {});
    tracker.track('Account', a);
    tracker.track('Contact', c);
    org.failNext = { op: 'delete', sobject: 'Contact', error: 'INSUFFICIENT_ACCESS: nope' };

    const result = await tracker.run(org);
    expect(result.errors).to.deep.equal([{ sobject: 'Contact', id: c, error: 'INSUFFICIENT_ACCESS: nope' }]);
    expect(result.deleted).to.deep.equal([{ sobject: 'Account', id: a }]);
  });
});
