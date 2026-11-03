import { expect } from 'chai';
import { parseTest, TestFileError } from '../../src/engine/loader.js';

function issues(yaml: string): string[] {
  try {
    parseTest(yaml, 'bad.yaml');
  } catch (error) {
    expect(error).to.be.instanceOf(TestFileError);
    return (error as TestFileError).issues;
  }
  throw new Error('expected parseTest to fail');
}

describe('loader', () => {
  it('parses the documented example format', () => {
    const test = parseTest(`
name: Large opp
tags: [opportunity]
params:
  accountName: "Regress Acme $run.id"
steps:
  - api.create:
      sobject: Account
      as: acme
      fields: { Name: $accountName }
  - name: Check the stage
    api.query: "SELECT StageName FROM Opportunity"
  - assert.equals: { actual: $acme.Name, expected: x }
`);
    expect(test.name).to.equal('Large opp');
    expect(test.tags).to.deep.equal(['opportunity']);
    expect(test.allowProduction).to.equal(false);
    expect(test.params).to.deep.equal({ accountName: 'Regress Acme $run.id' });
    expect(test.steps.map((s) => s.type)).to.deep.equal(['api.create', 'api.query', 'assert.equals']);
    expect(test.steps[0].args).to.deep.equal({ sobject: 'Account', as: 'acme', fields: { Name: '$accountName' } });
    expect(test.steps[0].line).to.equal(7);
    expect(test.steps[1]).to.include({ name: 'Check the stage', line: 11 });
    expect(test.steps[1].args).to.deep.equal({ soql: 'SELECT StageName FROM Opportunity' });
  });

  it('reports YAML syntax errors with a line number', () => {
    expect(issues('name: x\nsteps:\n  - api.create: {sobject: A\n')[0]).to.match(/^line \d+:/);
  });

  it('reports one error per line and suggests quoting for [ ] inside { }', () => {
    const found = issues('name: x\nsteps:\n  - assert.equals: { actual: $r.records[0].Name, expected: A }\n');
    expect(found).to.have.length(2);
    expect(found[0]).to.match(/^line 3:/);
    expect(found[1]).to.match(/tip: .*\$x.records.0.Name/);
  });

  it('accepts [0] in quoted values and block style', () => {
    const test = parseTest(`
name: x
steps:
  - assert.equals: { actual: "$r.records[0].Name", expected: A }
  - assert.equals:
      actual: $r.records[0].Name
      expected: A
`);
    expect(test.steps[0].args.actual).to.equal('$r.records[0].Name');
    expect(test.steps[1].args.actual).to.equal('$r.records[0].Name');
  });

  it('reports missing and unknown top-level keys', () => {
    const found = issues('nme: x\nsteps: []');
    expect(found.join('\n')).to.match(/name/);
    expect(found.join('\n')).to.match(/nme/);
  });

  it('requires at least one step', () => {
    expect(issues('name: x\nsteps: []').join()).to.match(/at least one step/);
  });

  it('reports unknown step types with the list of known ones', () => {
    expect(issues('name: x\nsteps:\n  - api.craete: {}')[0]).to.match(
      /steps\[1\] \(line 3\): unknown step type "api.craete". Known types: api.create/
    );
  });

  it('reports bad step arguments and keeps going', () => {
    const found = issues(`
name: x
steps:
  - api.create: { sobject: Account }
  - api.query: { soql: "SELECT Id FROM Account", as: "my result" }
`);
    expect(found).to.have.length(2);
    expect(found[0]).to.match(/steps\[1\].*api.create: fields/);
    expect(found[1]).to.match(/steps\[2\].*as: must be a simple name/);
  });

  it('rejects two step types in one step', () => {
    expect(issues('name: x\nsteps:\n  - api.query: "SELECT Id FROM A"\n    assert.exists: $x')[0]).to.match(
      /one step type per step/
    );
  });

  it('rejects "as" on steps that do not produce a result', () => {
    expect(issues('name: x\nsteps:\n  - assert.equals: { actual: 1, expected: 1, as: r }')[0]).to.match(/as/);
  });

  it('rejects reserved variable names', () => {
    expect(issues('name: x\nparams: { run: 1 }\nsteps:\n  - assert.exists: 1').join()).to.match(/reserved/);
    expect(issues('name: x\nsteps:\n  - api.query: { soql: "SELECT Id FROM A", as: run }').join()).to.match(/reserved/);
  });
});
