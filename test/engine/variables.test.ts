import { expect } from 'chai';
import { Variables, VariableError } from '../../src/engine/variables.js';

describe('variables', () => {
  let vars: Variables;

  beforeEach(() => {
    vars = new Variables(() => new Date(2026, 0, 1));
    vars.set('acme', { Id: '001ABC', Name: 'Acme', Amount: 60000 });
    vars.set('result', { totalSize: 1, records: [{ StageName: 'Prospecting', Account: { Name: 'Acme' } }] });
  });

  it('returns the raw value for a whole-value reference', () => {
    expect(vars.resolve('$acme.Amount')).to.equal(60000);
    expect(vars.resolve('$acme')).to.deep.equal({ Id: '001ABC', Name: 'Acme', Amount: 60000 });
  });

  it('interpolates references inside strings', () => {
    expect(vars.resolve("SELECT Id FROM Account WHERE Id = '$acme.Id'")).to.equal(
      "SELECT Id FROM Account WHERE Id = '001ABC'"
    );
    expect(vars.resolve('/lightning/r/Account/$acme.Id/view')).to.equal('/lightning/r/Account/001ABC/view');
  });

  it('reads array indexes and nested paths', () => {
    expect(vars.resolve('$result.records[0].StageName')).to.equal('Prospecting');
    expect(vars.resolve('$result.records[0].Account.Name')).to.equal('Acme');
  });

  it('accepts .0 as an index, so paths work unquoted inside YAML flow mappings', () => {
    expect(vars.resolve('$result.records.0.StageName')).to.equal('Prospecting');
    expect(vars.resolve("Stage is '$result.records.0.StageName'")).to.equal("Stage is 'Prospecting'");
  });

  it('matches field names case-insensitively', () => {
    expect(vars.resolve('$result.records[0].stagename')).to.equal('Prospecting');
  });

  it('returns undefined for a missing path on a known variable', () => {
    expect(vars.resolve('$result.records[5].StageName')).to.equal(undefined);
  });

  it('throws on an unknown variable, listing the known ones', () => {
    expect(() => vars.resolve('$acmee.Id')).to.throw(VariableError, /Unknown variable \$acmee.*\$acme/);
  });

  it('throws when interpolating a missing value', () => {
    expect(() => vars.resolve("Id = '$acme.Missing'")).to.throw(VariableError, /has no value/);
  });

  it('treats $$ as a literal dollar sign', () => {
    expect(vars.resolve('Costs $$100')).to.equal('Costs $100');
    expect(vars.resolve('$$')).to.equal('$');
  });

  it('ignores $ not followed by a name, and a trailing period', () => {
    expect(vars.resolve('Price $5')).to.equal('Price $5');
    expect(vars.resolve('Hello $acme.Name.')).to.equal('Hello Acme.');
  });

  it('resolves relative dates', () => {
    expect(vars.resolve('+30d')).to.equal('2026-01-31');
  });

  it('resolves deeply inside objects and arrays', () => {
    expect(vars.resolve({ AccountId: '$acme.Id', CloseDate: 'today', tags: ['$acme.Name', 5] })).to.deep.equal({
      AccountId: '001ABC',
      CloseDate: '2026-01-01',
      tags: ['Acme', 5],
    });
  });
});
