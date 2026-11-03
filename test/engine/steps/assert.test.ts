import { expect } from 'chai';
import { looselyEqual } from '../../../src/engine/steps/assert.js';
import { expectFailure, harness, runStep, type Harness } from './helpers.js';

describe('assert steps', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
    h.vars.set('result', { totalSize: 1, records: [{ StageName: 'Prospecting', Amount: 60000, Tags: ['a', 'b'] }] });
  });

  describe('looselyEqual', () => {
    it('compares primitives by string value and nulls as equal', () => {
      expect(looselyEqual(60000, '60000')).to.equal(true);
      expect(looselyEqual(true, 'true')).to.equal(true);
      expect(looselyEqual(null, undefined)).to.equal(true);
      expect(looselyEqual({ a: 1 }, { a: 1 })).to.equal(true);
      expect(looselyEqual(1, 2)).to.equal(false);
      expect(looselyEqual(0, null)).to.equal(false);
    });
  });

  describe('assert.equals', () => {
    it('passes when equal', async () => {
      const out = await runStep(h, 'assert.equals', {
        actual: '$result.records[0].StageName',
        expected: 'Prospecting',
      });
      expect(out?.detail).to.equal('$result.records[0].StageName = "Prospecting"');
    });

    it('fails with the expression, expected and actual values', async () => {
      const message = await expectFailure(
        runStep(h, 'assert.equals', { actual: '$result.records[0].StageName', expected: 'Closed Won' })
      );
      expect(message).to.equal('$result.records[0].StageName: expected "Closed Won", got "Prospecting"');
    });

    it('includes a custom message', async () => {
      const message = await expectFailure(
        runStep(h, 'assert.equals', { actual: '$result.totalSize', expected: 2, message: 'should find both' })
      );
      expect(message).to.equal('should find both ($result.totalSize: expected 2, got 1)');
    });

    it('reports missing values as undefined', async () => {
      const message = await expectFailure(
        runStep(h, 'assert.equals', { actual: '$result.records[3].StageName', expected: 'Prospecting' })
      );
      expect(message).to.match(/got undefined/);
    });
  });

  describe('assert.notEquals', () => {
    it('passes when different and fails when equal', async () => {
      await runStep(h, 'assert.notEquals', { actual: '$result.records[0].StageName', expected: 'Closed Won' });
      const message = await expectFailure(
        runStep(h, 'assert.notEquals', { actual: '$result.records[0].Amount', expected: '60000' })
      );
      expect(message).to.match(/expected anything but "60000"/);
    });
  });

  describe('assert.contains', () => {
    it('checks substrings', async () => {
      await runStep(h, 'assert.contains', { actual: '$result.records[0].StageName', expected: 'Prosp' });
      const message = await expectFailure(
        runStep(h, 'assert.contains', { actual: '$result.records[0].StageName', expected: 'Closed' })
      );
      expect(message).to.match(/expected to contain "Closed"/);
    });

    it('checks list items', async () => {
      await runStep(h, 'assert.contains', { actual: '$result.records[0].Tags', expected: 'b' });
      await expectFailure(runStep(h, 'assert.contains', { actual: '$result.records[0].Tags', expected: 'z' }));
    });

    it('fails on values that are neither strings nor lists', async () => {
      const message = await expectFailure(
        runStep(h, 'assert.contains', { actual: '$result.records[0].Amount', expected: '6' })
      );
      expect(message).to.match(/expected a string or list/);
    });
  });

  describe('assert.exists', () => {
    it('passes for present values and fails for missing or empty ones', async () => {
      await runStep(h, 'assert.exists', { actual: '$result.records[0].StageName' });
      expect(await expectFailure(runStep(h, 'assert.exists', { actual: '$result.records[0].Nope' }))).to.match(
        /expected a value, got undefined/
      );
      h.vars.set('blank', '');
      await expectFailure(runStep(h, 'assert.exists', { actual: '$blank' }));
    });
  });
});
