import { expect } from 'chai';
import { formatDate, isRelativeDate, resolveRelativeDate } from '../../src/engine/dates.js';

describe('relative dates', () => {
  const now = new Date(2026, 0, 31); // 31 Jan 2026, local time

  it('resolves today', () => {
    expect(resolveRelativeDate('today', now)).to.equal('2026-01-31');
  });

  it('adds and subtracts days and weeks', () => {
    expect(resolveRelativeDate('+30d', now)).to.equal('2026-03-02');
    expect(resolveRelativeDate('-1d', now)).to.equal('2026-01-30');
    expect(resolveRelativeDate('+2w', now)).to.equal('2026-02-14');
  });

  it('adds months and years', () => {
    expect(resolveRelativeDate('+1y', now)).to.equal('2027-01-31');
    expect(resolveRelativeDate('-12m', now)).to.equal('2025-01-31');
  });

  it('leaves other strings alone', () => {
    for (const value of ['30d', '+30', 'tomorrow', '+30d ', 'Today']) {
      expect(isRelativeDate(value), value).to.equal(false);
      expect(resolveRelativeDate(value, now), value).to.equal(undefined);
    }
  });

  it('formats dates as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 4, 7))).to.equal('2026-05-07');
  });
});
