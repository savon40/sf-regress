import { expect } from 'chai';
import { withHeader, wrap } from '../../src/cli/header.js';

describe('withHeader', () => {
  it('records where the test came from and the review notes', () => {
    const text = withHeader('name: t\nsteps: []\n\n', {
      origin: 'Converted with "sf regress convert" from tests/drafts/a.md',
      description: 'Line one\nLine two',
      notes: ['Assumed the Sales record type'],
      status: 'unverified',
    });
    const lines = text.split('\n');
    expect(lines[0]).to.match(
      /^# Converted with "sf regress convert" from tests\/drafts\/a\.md on \d{4}-\d{2}-\d{2} from:$/
    );
    expect(lines.slice(1, 3)).to.deep.equal(['#   Line one', '#   Line two']);
    expect(text).to.include('# NOTE: this test failed its first run and needs review.');
    expect(text).to.include('#   - Assumed the Sales record type');
    expect(text.endsWith('\n\nname: t\nsteps: []\n')).to.equal(true);
  });
});

describe('wrap', () => {
  it('wraps long lines and keeps line breaks', () => {
    expect(wrap('aaa bbb ccc\nddd', 7)).to.deep.equal(['aaa bbb', 'ccc', 'ddd']);
  });
});
