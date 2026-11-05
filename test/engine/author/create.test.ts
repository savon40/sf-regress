import { expect } from 'chai';
import { authorTest, formatFailure, type AuthorOptions } from '../../../src/engine/author/create.js';
import type { AuthorModel, AuthorReply } from '../../../src/engine/author/model.js';
import type { MetadataSource, RawDescribe } from '../../../src/engine/author/org-context.js';
import type { TestResult } from '../../../src/engine/types.js';
import { MockOrg } from '../mock-org.js';

const GOOD_YAML = `name: New account
tags: [account]
steps:
  - api.create:
      sobject: Account
      as: acme
      fields: { Name: "Regress Acme $run.id" }
  - api.query:
      soql: "SELECT Name FROM Account WHERE Id = '$acme.Id'"
      as: result
  - assert.exists: $result.records.0.Name
`;

/** Fails verification: the query finds nothing because it asks for the wrong Id. */
const FAILING_YAML = GOOD_YAML.replace("'$acme.Id'", "'001000000000000'");

function reply(partial: Partial<AuthorReply>): AuthorReply {
  return { kind: 'test', yaml: '', questions: [], objects: [], notes: [], ...partial };
}

/** A model that returns scripted replies and records what it was sent. */
function scriptedModel(replies: AuthorReply[]): AuthorModel & { sent: string[]; system?: string } {
  const sent: string[] = [];
  const model = {
    name: 'test-model',
    sent,
    system: undefined as string | undefined,
    startSession(system: string) {
      model.system = system;
      return {
        send: async (message: string): Promise<AuthorReply> => {
          sent.push(message);
          const next = replies.shift();
          if (!next) throw new Error(`no scripted reply left for: ${message.slice(0, 80)}`);
          return next;
        },
        usage: () => ({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 }),
      };
    },
    splitDraft: async () => ({ tests: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } }),
  };
  return model;
}

function rawDescribe(name: string): RawDescribe {
  return {
    name,
    label: name,
    fields: [{ name: 'Name', label: `${name} Name`, type: 'string', length: 80, nillable: false, createable: true }],
  };
}

function metadata(): MetadataSource & { described: string[] } {
  const described: string[] = [];
  return {
    described,
    describeGlobal: async () => [
      { name: 'Account', label: 'Account', labelPlural: 'Accounts', queryable: true, layoutable: true },
      {
        name: 'Invoice__c',
        label: 'Invoice',
        labelPlural: 'Invoices',
        queryable: true,
        layoutable: true,
        custom: true,
      },
    ],
    describeObject: async (name) => {
      described.push(name);
      return rawDescribe(name);
    },
    describeLayouts: async () => ({}),
    query: async () => ({ totalSize: 0, done: true, records: [] }),
  };
}

function options(model: AuthorModel, extra: Partial<AuthorOptions> = {}): AuthorOptions {
  return { request: 'Create an account and check it has a name', model, metadata: metadata(), ...extra };
}

describe('authorTest', () => {
  it('sends the description with metadata for the objects it mentions', async () => {
    const model = scriptedModel([reply({ yaml: GOOD_YAML })]);
    const opts = options(model);
    const result = await authorTest(opts);

    expect(result.status).to.equal('created');
    expect(result.test?.name).to.equal('New account');
    expect(model.system).to.include('sf-regress YAML format');
    expect(model.sent[0]).to.include('Create an account and check it has a name');
    expect(model.sent[0]).to.include('## Account ("Account")');
    expect(model.sent[0], 'other objects are listed by name only').to.include('Invoice: Invoice__c');
    expect((opts.metadata as ReturnType<typeof metadata>).described).to.deep.equal(['Account']);
    expect(result.usage.outputTokens).to.equal(50);
  });

  it('loads more metadata when the AI asks for it', async () => {
    const model = scriptedModel([
      reply({ kind: 'need_objects', objects: ['invoice__c', 'Nope__c'] }),
      reply({ yaml: GOOD_YAML }),
    ]);
    const opts = options(model);
    const result = await authorTest(opts);

    expect(result.status).to.equal('created');
    expect(model.sent[1]).to.include('## Invoice__c');
    expect((opts.metadata as ReturnType<typeof metadata>).described).to.deep.equal(['Account', 'Invoice__c']);
  });

  it('returns the questions when it cannot ask them', async () => {
    const model = scriptedModel([reply({ kind: 'questions', questions: ['1. Which approval process?', ' '] })]);
    const result = await authorTest(options(model));
    expect(result.status).to.equal('questions');
    expect(result.questions).to.deep.equal(['Which approval process?']);
    expect(result.yaml).to.equal(undefined);
  });

  it('asks the questions and sends the answers back', async () => {
    const model = scriptedModel([
      reply({ kind: 'questions', questions: ['Which approval process?', 'What amount is large?'] }),
      reply({ yaml: GOOD_YAML }),
    ]);
    let asked: string[] = [];
    const result = await authorTest(
      options(model, {
        ask: async (questions) => {
          asked = questions;
          return ['Large Deals', ''];
        },
      })
    );
    expect(result.status).to.equal('created');
    expect(asked).to.have.length(2);
    expect(model.sent[1]).to.include('Q: Which approval process?\nA: Large Deals');
    expect(model.sent[1]).to.include('(no answer');
  });

  it('stops when every question is skipped', async () => {
    const model = scriptedModel([reply({ kind: 'questions', questions: ['Which one?'] })]);
    const result = await authorTest(options(model, { ask: async () => [''] }));
    expect(result.status).to.equal('questions');
  });

  it('sends YAML errors back for a fix', async () => {
    const model = scriptedModel([reply({ yaml: 'name: x\nsteps:\n  - api.nope: {}\n' }), reply({ yaml: GOOD_YAML })]);
    const result = await authorTest(options(model));
    expect(result.status).to.equal('created');
    expect(model.sent[1]).to.include('not a valid test').and.include('api.nope');
  });

  it('verifies against the org and sends the failed step back', async () => {
    const org = new MockOrg();
    const model = scriptedModel([reply({ yaml: FAILING_YAML }), reply({ yaml: GOOD_YAML })]);
    const result = await authorTest(options(model, { verify: { client: org } }));

    expect(result.status).to.equal('created');
    expect(result.verification?.status).to.equal('passed');
    expect(model.sent[1]).to.include('FAILED 3. assert.exists').and.include('org_mismatch');
    expect(org.records.size, 'verification records are cleaned up').to.equal(0);
  });

  it('gives up after the allowed fixes and returns the last draft', async () => {
    const org = new MockOrg();
    const model = scriptedModel([reply({ yaml: FAILING_YAML }), reply({ yaml: FAILING_YAML })]);
    const result = await authorTest(options(model, { verify: { client: org }, maxFixes: 1 }));
    expect(result.status).to.equal('unverified');
    expect(result.yaml).to.equal(FAILING_YAML);
    expect(result.verification?.status).to.equal('failed');
  });

  it('keeps the test when the AI says the org behaves differently', async () => {
    const org = new MockOrg();
    const model = scriptedModel([
      reply({ yaml: FAILING_YAML }),
      reply({ kind: 'org_mismatch', yaml: FAILING_YAML, notes: ['Stage stayed Prospecting'] }),
    ]);
    const result = await authorTest(options(model, { verify: { client: org } }));
    expect(result.status).to.equal('org_mismatch');
    expect(result.yaml).to.equal(FAILING_YAML);
    expect(result.notes).to.deep.equal(['Stage stayed Prospecting']);
  });
});

describe('formatFailure', () => {
  it('lists each step with the failure and its line', () => {
    const result: TestResult = {
      name: 't',
      status: 'failed',
      durationMs: 1,
      steps: [
        { index: 1, type: 'api.create', status: 'passed', durationMs: 1, detail: 'Account 001' },
        {
          index: 2,
          type: 'browser.click',
          name: 'Open it',
          line: 9,
          status: 'failed',
          durationMs: 1,
          error: 'not found',
        },
        { index: 3, type: 'assert.equals', status: 'skipped', durationMs: 0 },
      ],
      cleanup: { deleted: [], errors: [{ sobject: 'Account', id: '001', error: 'locked' }] },
    };
    const text = formatFailure(result);
    expect(text).to.include('passed 1. api.create - Account 001');
    expect(text).to.include('FAILED 2. browser.click "Open it" (line 9): not found');
    expect(text).to.include('skipped 3. assert.equals');
    expect(text).to.include('Cleanup could not delete Account: locked');
  });
});
