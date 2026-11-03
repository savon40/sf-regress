import { readFileSync } from 'node:fs';
import { expect } from 'chai';
import { camelCase, cleanLabel, convertRecording, type DraftStep } from '../../../src/engine/record/convert.js';
import type { ClickEvent, RecordedAction, Recording } from '../../../src/engine/record/types.js';
import { toYaml } from '../../../src/engine/record/yaml.js';
import { parseTest } from '../../../src/engine/loader.js';

/** A real recording from a Developer Edition org: create an Account in a console tab, then a Contact from its page. */
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/new-account-and-contact.json', import.meta.url), 'utf8')
) as Recording;
const ACCOUNT_ID = '001fj00002AW4zQAAT';

const created = [
  { sobject: 'Account', id: ACCOUNT_ID, name: 'Regress Fixture Co', createdAt: '2026-11-03T15:11:32.000+0000' },
  { sobject: 'Contact', id: '003fj00001xyzABCDE', name: 'Fixture', createdAt: '2026-11-03T15:11:50.000+0000' },
];

function stepsOf(steps: DraftStep[]): Array<[string, Record<string, unknown>]> {
  return steps.map((s) => [s.type, s.args]);
}

const role = (body: string, name: string): RecordedAction['locator'] => ({ kind: 'role', body, options: { name } });
const click = (body: string, name: string): RecordedAction => ({
  name: 'click',
  selector: `internal:role=${body}[name="${name}"i]`,
  locator: role(body, name),
});
const event = (partial: Partial<ClickEvent>): ClickEvent => ({
  t: 0,
  url: 'https://x.lightning.force.com/lightning/page/home',
  role: '',
  name: '',
  value: null,
  ids: [],
  field: null,
  dialog: null,
  ...partial,
});
const recording = (actions: RecordedAction[], events: ClickEvent[] = []): Recording => ({
  baseUrl: 'https://x.lightning.force.com',
  startedAt: '2026-01-01T00:00:00.000Z',
  actions,
  events,
  navigations: [],
});

describe('convertRecording', () => {
  describe('real Lightning recording', () => {
    const { test, notes } = convertRecording(FIXTURE, { name: 'New account with a contact', created });

    it('turns actions into Salesforce-aware steps', () => {
      expect(stepsOf(test.steps)).to.deep.equal([
        ['browser.goto', { path: '/lightning/o/Account/list' }],
        ['browser.click', { button: 'New' }],
        ['browser.fill', { field: 'Account Name', value: '$accountName' }],
        ['browser.select', { field: 'Industry', value: 'Banking' }],
        ['browser.select', { field: 'Rating', value: 'Hot' }],
        ['browser.fill', { field: 'Phone', value: '$phone' }],
        ['browser.click', { button: 'Save' }],
        ['browser.captureRecord', { as: 'account' }],
        ['browser.click', { button: 'New Contact' }],
        ['browser.fill', { field: 'Last Name', in: 'New Contact', value: '$lastName' }],
        ['browser.fill', { field: 'Email', in: 'New Contact', value: '$email' }],
        ['browser.click', { button: 'Save', in: 'New Contact' }],
        [
          'api.track',
          {
            soql: "SELECT Id FROM Contact WHERE CreatedById = '$run.userId' AND CreatedDate >= $run.startedAt AND Name LIKE '%$lastName%'",
            as: 'contact',
          },
        ],
        ['browser.click', { tab: 'Details' }],
      ]);
      expect(notes).to.deep.equal([]);
    });

    it('repairs brittle picklist option selectors from click events', () => {
      const brittle = FIXTURE.actions.filter((a) => a.selector?.startsWith('[id='));
      expect(brittle).to.have.length(2);
      expect(JSON.stringify(test.steps)).not.to.include('[id=');
    });

    it('makes typed names unique per run and keeps other values as typed', () => {
      expect(test.params).to.deep.equal({
        accountName: 'Regress Fixture Co $run.id',
        phone: '555-0100',
        lastName: 'Fixture $run.id',
        email: 'fixture@example.com',
      });
    });

    it('writes YAML that the loader accepts', () => {
      const yaml = toYaml(test, ['Recorded with sf regress record']);
      expect(yaml).to.match(/^# Recorded with sf regress record/);
      expect(yaml).to.include('- browser.select: { field: Industry, value: Banking }');
      expect(yaml).to.include('- browser.fill: { field: Last Name, value: $lastName, in: New Contact }');
      expect(yaml).to.include('browser.captureRecord: account');
      const parsed = parseTest(yaml, 'recorded.yaml');
      expect(parsed.steps).to.have.length(test.steps.length);
      expect(parsed.params.accountName).to.equal('Regress Fixture Co $run.id');
    });
  });

  it('collapses a lookup (type, then pick a result) into browser.select', () => {
    const { test } = convertRecording(
      recording(
        [
          click('combobox', 'Parent Account'),
          {
            name: 'fill',
            selector: 'internal:role=combobox[name="Parent Account"i]',
            locator: role('combobox', 'Parent Account'),
            text: 'Acme',
          },
          { name: 'click', selector: '[id="99:0"]', locator: { kind: 'default', body: '[id="99:0"]' } },
        ],
        [
          event({ role: 'combobox', name: 'Parent Account' }),
          event({ role: 'option', name: 'Acme Corp • San Francisco', ids: ['99:0'] }),
        ]
      ),
      { name: 'x' }
    );
    // The full name of the record picked, not the partial text typed.
    expect(stepsOf(test.steps)).to.deep.equal([['browser.select', { field: 'Parent Account', value: 'Acme Corp' }]]);
  });

  describe('real Lightning recording with a lookup', () => {
    const lookupRecording = JSON.parse(
      readFileSync(new URL('./fixtures/new-opportunity-with-lookup.json', import.meta.url), 'utf8')
    ) as Recording;
    const oppId = '006fj00000PBzZZAA1';
    const opened = { ...lookupRecording, navigations: [...lookupRecording.navigations] };
    const saveTime = lookupRecording.events.find((e) => e.name === 'Save')?.t ?? 0;
    opened.navigations.push({
      t: saveTime + 2000,
      url: `https://example.lightning.force.com/lightning/r/Opportunity/${oppId}/view`,
    });
    const { test } = convertRecording(opened, {
      name: 'Deal',
      created: [{ sobject: 'Opportunity', id: oppId, name: 'Regress Recorded Deal', createdAt: '' }],
    });

    it('drops empty formatting fills and picks the lookup record by its full name', () => {
      expect(stepsOf(test.steps)).to.deep.equal([
        ['browser.goto', { path: '/lightning/o/Opportunity/list' }],
        ['browser.click', { button: 'New' }],
        ['browser.fill', { field: 'Opportunity Name', value: '$opportunityName' }],
        ['browser.select', { field: 'Account Name', value: 'Regress Lookup Target' }],
        ['browser.fill', { field: 'Close Date', value: '$closeDate' }],
        ['browser.select', { field: 'Stage', value: 'Qualification' }],
        ['browser.fill', { field: 'Amount', value: '$amount' }],
        ['browser.click', { button: 'Save' }],
        ['browser.captureRecord', { as: 'opportunity' }],
        ['browser.click', { tab: 'Details' }],
      ]);
    });
  });

  it('keeps only the last of repeated fills', () => {
    const fill = (text: string): RecordedAction => ({
      name: 'fill',
      selector: 'internal:role=textbox[name="Subject"i]',
      locator: role('textbox', 'Subject'),
      text,
    });
    const { test } = convertRecording(recording([fill('Hel'), fill('Hello world')]), { name: 'x' });
    expect(test.steps).to.have.length(1);
    expect(test.params).to.deep.equal({ subject: 'Hello world $run.id' });
  });

  it('uses dialog scopes from the locator chain', () => {
    const { test } = convertRecording(
      recording([
        {
          name: 'click',
          selector: 'x',
          locator: { kind: 'role', body: 'dialog', options: { name: 'New Case' }, next: role('button', 'Save') },
        },
      ]),
      { name: 'x' }
    );
    expect(stepsOf(test.steps)).to.deep.equal([['browser.click', { button: 'Save', in: 'New Case' }]]);
  });

  it('converts assertions and follows params into them', () => {
    const { test } = convertRecording(
      recording([
        { name: 'fill', selector: 's', locator: role('textbox', 'Account Name'), text: 'Acme' },
        { name: 'assertText', selector: 'h', locator: role('heading', 'Acme'), text: 'Acme', substring: true },
        { name: 'assertVisible', selector: 'b', locator: role('button', 'Edit') },
        { name: 'assertValue', selector: 'p', locator: { kind: 'label', body: '*Phone' }, value: '555' },
        {
          name: 'assertText',
          selector: '[id="5:0"]',
          locator: { kind: 'default', body: '[id="5:0"]' },
          text: 'Saved Acme',
        },
      ]),
      { name: 'x' }
    );
    expect(stepsOf(test.steps).slice(1)).to.deep.equal([
      ['browser.expectText', { heading: 'Acme', contains: '$accountName' }],
      ['browser.expectVisible', { button: 'Edit' }],
      ['browser.expectValue', { field: 'Phone', value: '555' }],
      ['browser.expectVisible', { text: 'Saved $accountName' }],
    ]);
  });

  it('falls back to the raw selector with a review comment when nothing better is known', () => {
    const { test, notes } = convertRecording(
      recording([
        { name: 'click', selector: 'div.x > span:nth-child(3)', locator: { kind: 'default', body: 'div.x' } },
      ]),
      { name: 'x' }
    );
    expect(test.steps[0].args).to.deep.equal({ selector: 'div.x > span:nth-child(3)' });
    expect(test.steps[0].comment).to.match(/^review:/);
    expect(notes).to.have.length(1);
  });

  it('turns record ids in later URLs into variables', () => {
    const rec = recording([
      { name: 'navigate', url: `https://x.lightning.force.com/lightning/r/Account/${ACCOUNT_ID}/view` },
    ]);
    rec.navigations = [{ t: 0, url: `https://x.lightning.force.com/lightning/r/Account/${ACCOUNT_ID}/view` }];
    const { test } = convertRecording(rec, { name: 'x', created: [created[0]] });
    expect(test.steps.map((s) => s.args)).to.deep.include({ path: '/lightning/r/Account/$account.Id/view' });
  });

  it('replaces App Launcher search-and-pick with a visit to the page it opened', () => {
    const search = {
      name: 'fill',
      selector: 'internal:role=combobox[name="Search apps and items..."i]',
      locator: role('combobox', 'Search apps and items...'),
      text: 'Acc',
    } as RecordedAction;
    const rec = recording(
      [click('button', 'App Launcher'), search, click('option', 'Accounts'), click('link', 'Acme')],
      [
        event({ t: 100, role: 'button', name: 'App Launcher' }),
        event({ t: 200, role: 'option', name: 'Accounts' }),
        event({ t: 400, role: 'link', name: 'Acme' }),
      ]
    );
    rec.navigations = [
      { t: 50, url: 'https://x.lightning.force.com/lightning/page/home' },
      { t: 250, url: 'https://x.lightning.force.com/lightning/o/Account/home' },
    ];
    const { test } = convertRecording(rec, { name: 'x' });
    expect(stepsOf(test.steps)).to.deep.equal([
      ['browser.goto', { path: '/lightning/o/Account/home' }],
      ['browser.click', { link: 'Acme' }],
    ]);
  });

  it('cleans labels and builds variable names', () => {
    expect(cleanLabel('Last Name *')).to.equal('Last Name');
    expect(cleanLabel('*Account Name')).to.equal('Account Name');
    expect(camelCase('Account Name')).to.equal('accountName');
    expect(camelCase('Invoice_Total__c')).to.equal('invoiceTotalC');
    expect(camelCase('2nd Address')).to.equal('v2ndAddress');
  });
});
