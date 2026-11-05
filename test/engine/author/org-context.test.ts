import { expect } from 'chai';
import {
  findMentionedObjects,
  formatObjectContext,
  listObjects,
  loadObjectContext,
  MAX_PICKLIST_VALUES,
  type MetadataSource,
  type RawDescribe,
  type RawLayouts,
} from '../../../src/engine/author/org-context.js';
import type { QueryResult } from '../../../src/engine/types.js';

const OPPORTUNITY: RawDescribe = {
  name: 'Opportunity',
  label: 'Opportunity',
  fields: [
    { name: 'Id', label: 'Opportunity ID', type: 'id', nillable: false, createable: false, updateable: false },
    {
      name: 'Name',
      label: 'Opportunity Name',
      type: 'string',
      length: 120,
      nillable: false,
      createable: true,
      updateable: true,
    },
    {
      name: 'StageName',
      label: 'Stage',
      type: 'picklist',
      nillable: false,
      createable: true,
      updateable: true,
      picklistValues: [
        { value: 'Prospecting', active: true },
        { value: 'Old Stage', active: false },
        { value: 'Closed Won', active: true },
      ],
    },
    {
      name: 'AccountId',
      label: 'Account ID',
      type: 'reference',
      nillable: true,
      createable: true,
      updateable: true,
      referenceTo: ['Account'],
    },
    {
      name: 'IsPrivate',
      label: 'Private',
      type: 'boolean',
      nillable: false,
      createable: true,
      updateable: true,
      defaultedOnCreate: true,
    },
    {
      name: 'OwnerId',
      label: 'Owner ID',
      type: 'reference',
      nillable: false,
      createable: true,
      updateable: true,
      defaultedOnCreate: true,
      referenceTo: ['User'],
    },
    {
      name: 'Score__c',
      label: 'Score',
      type: 'double',
      nillable: true,
      createable: false,
      updateable: false,
      calculated: true,
    },
    {
      name: 'Region__c',
      label: 'Region',
      type: 'picklist',
      nillable: true,
      createable: true,
      updateable: true,
      dependentPicklist: true,
      controllerName: 'Country__c',
      picklistValues: [{ value: 'EMEA' }],
    },
    { name: 'ShippingAddress', label: 'Shipping Address', type: 'address', createable: false, updateable: false },
    { name: 'SystemModstamp', label: 'System Modstamp', type: 'datetime', createable: false, updateable: false },
    { name: 'Legacy__c', label: 'Legacy', type: 'string', deprecatedAndHidden: true },
  ],
  recordTypeInfos: [
    { name: 'Master', developerName: 'Master', recordTypeId: '012000000000000AAA', master: true, available: true },
    { name: 'New Business', developerName: 'New_Business', recordTypeId: '012A', available: true },
    { name: 'Hidden', developerName: 'Hidden', recordTypeId: '012B', available: false },
  ],
};

const LAYOUTS: RawLayouts = {
  layouts: [
    {
      buttonLayoutSection: {
        detailButtons: [
          { label: 'Edit', name: 'Edit' },
          { label: 'Clone', name: 'Clone' },
        ],
      },
      quickActionList: {
        quickActionListItems: [
          { label: 'Post', quickActionName: 'FeedItem.TextPost', type: 'Post' },
          { label: 'New Task', quickActionName: 'NewTask', type: 'Create' },
        ],
      },
    },
    {
      buttonLayoutSection: {
        detailButtons: [
          { label: 'Edit', name: 'Edit' },
          { label: 'Submit for Approval', name: 'Submit' },
        ],
      },
      quickActionList: { quickActionListItems: [{ label: 'New Task', quickActionName: 'NewTask', type: 'Create' }] },
    },
  ],
};

function source(overrides: Partial<MetadataSource> = {}): MetadataSource & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    describeGlobal: async () => [],
    describeObject: async () => OPPORTUNITY,
    describeLayouts: async () => LAYOUTS,
    query: async (soql): Promise<QueryResult> => {
      queries.push(soql);
      return {
        totalSize: 2,
        done: true,
        records: [
          { Name: 'Large Deal Approval', DeveloperName: 'Large_Deal', State: 'Active' },
          { Name: 'Old Approval', DeveloperName: 'Old_Approval', State: 'Inactive' },
        ],
      };
    },
    ...overrides,
  };
}

describe('loadObjectContext', () => {
  it('keeps usable fields and marks required and read-only ones', async () => {
    const ctx = await loadObjectContext(source(), 'Opportunity');
    const byName = Object.fromEntries(ctx.fields.map((f) => [f.name, f]));

    expect(Object.keys(byName)).to.not.include.members(['ShippingAddress', 'Legacy__c', 'SystemModstamp']);
    expect(byName.Name).to.include({ required: true, readOnly: false, length: 120 });
    expect(byName.StageName.required).to.equal(true);
    expect(byName.StageName.picklistValues).to.deep.equal(['Prospecting', 'Closed Won']);
    expect(byName.AccountId).to.include({ required: false });
    expect(byName.AccountId.referenceTo).to.deep.equal(['Account']);
    expect(byName.IsPrivate.required, 'booleans are never required').to.equal(false);
    expect(byName.OwnerId.required, 'defaulted fields are not required').to.equal(false);
    expect(byName.Score__c.readOnly).to.equal(true);
    expect(byName.Id.readOnly).to.equal(true);
    expect(byName.Region__c.controllerName).to.equal('Country__c');
  });

  it('lists available record types, skipping Master', async () => {
    const ctx = await loadObjectContext(source(), 'Opportunity');
    expect(ctx.recordTypes).to.deep.equal([{ name: 'New Business', developerName: 'New_Business' }]);
  });

  it('merges buttons and quick actions across layouts, skipping Chatter posts', async () => {
    const ctx = await loadObjectContext(source(), 'Opportunity');
    expect(ctx.buttons).to.deep.equal(['Edit', 'Clone', 'Submit for Approval']);
    expect(ctx.quickActions).to.deep.equal([{ label: 'New Task', name: 'NewTask' }]);
  });

  it('loads approval processes for the object', async () => {
    const src = source();
    const ctx = await loadObjectContext(src, 'Opportunity');
    expect(src.queries[0]).to.include("TableEnumOrId = 'Opportunity'").and.include("Type = 'Approval'");
    expect(ctx.approvalProcesses).to.deep.equal([
      { name: 'Large Deal Approval', developerName: 'Large_Deal', active: true },
      { name: 'Old Approval', developerName: 'Old_Approval', active: false },
    ]);
  });

  it('still works when layouts or approval processes are unavailable', async () => {
    const ctx = await loadObjectContext(
      source({
        describeLayouts: async () => Promise.reject(new Error('NOT_FOUND')),
        query: async () => Promise.reject(new Error('INVALID_TYPE')),
      }),
      'Opportunity'
    );
    expect(ctx.buttons).to.deep.equal([]);
    expect(ctx.approvalProcesses).to.deep.equal([]);
    expect(ctx.fields.length).to.be.greaterThan(0);
  });

  it('fails when the object does not exist', async () => {
    const src = source({
      describeObject: async () => Promise.reject(new Error('NOT_FOUND: The requested resource does not exist')),
    });
    let error: Error | undefined;
    await loadObjectContext(src, 'Nope__c').catch((e: Error) => (error = e));
    expect(error?.message).to.include('NOT_FOUND');
  });
});

describe('formatObjectContext', () => {
  it('formats compact readable text', async () => {
    const text = formatObjectContext(await loadObjectContext(source(), 'Opportunity'));
    expect(text).to.include('## Opportunity ("Opportunity")');
    expect(text).to.include('Record types: New Business (New_Business)');
    expect(text).to.include('  Name* "Opportunity Name" string(120)');
    expect(text).to.include('  StageName* "Stage" picklist, values: Prospecting | Closed Won');
    expect(text).to.include('  AccountId "Account ID" lookup -> Account');
    expect(text).to.include('  Score__c "Score" double, read-only');
    expect(text).to.include('depends on Country__c');
    expect(text).to.include('Buttons: Edit, Clone, Submit for Approval');
    expect(text).to.include('Quick actions: New Task (NewTask)');
    expect(text).to.include(
      'Approval processes: Large Deal Approval (Large_Deal), Old Approval (Old_Approval, inactive)'
    );
  });

  it('cuts long picklists short', async () => {
    const values = Array.from({ length: MAX_PICKLIST_VALUES + 5 }, (_, i) => ({ value: `V${i}` }));
    const describe: RawDescribe = {
      name: 'X__c',
      label: 'X',
      fields: [
        { name: 'P__c', label: 'P', type: 'picklist', nillable: true, createable: true, picklistValues: values },
      ],
    };
    const text = formatObjectContext(await loadObjectContext(source({ describeObject: async () => describe }), 'X__c'));
    expect(text).to.include('(+5 more)');
    expect(text).to.include('Record types: none').and.include('Approval processes: Large Deal Approval');
  });
});

describe('listObjects', () => {
  it('drops system and hidden objects', async () => {
    const objects = await listObjects(
      source({
        describeGlobal: async () => [
          {
            name: 'Opportunity',
            label: 'Opportunity',
            labelPlural: 'Opportunities',
            queryable: true,
            layoutable: true,
          },
          { name: 'Invoice__c', label: 'Invoice', custom: true, queryable: true, layoutable: true },
          { name: 'AccountHistory', label: 'Account History', queryable: true, layoutable: true },
          { name: 'OpportunityShare', label: 'Opportunity Share', queryable: true, layoutable: true },
          { name: 'Setting__mdt', label: 'Setting', queryable: true, layoutable: true },
          { name: 'Apex', label: 'Apex', queryable: true, layoutable: false },
          { name: 'Old', label: 'Old', deprecatedAndHidden: true },
        ],
      })
    );
    expect(objects.map((o) => o.name)).to.deep.equal(['Invoice__c', 'Opportunity']);
    expect(objects[0].custom).to.equal(true);
  });
});

describe('findMentionedObjects', () => {
  const objects = [
    { name: 'Account', label: 'Account', labelPlural: 'Accounts', custom: false },
    { name: 'Opportunity', label: 'Opportunity', labelPlural: 'Opportunities', custom: false },
    { name: 'Invoice_Line__c', label: 'Invoice Line', labelPlural: 'Invoice Lines', custom: true },
    { name: 'Case', label: 'Case', labelPlural: 'Cases', custom: false },
  ];

  it('matches labels, plurals and API names as whole words', () => {
    const text = 'Create an Account with two Opportunities, then add an invoice line. Check Invoice_Line__c.';
    expect(findMentionedObjects(text, objects)).to.deep.equal(['Account', 'Invoice_Line__c', 'Opportunity']);
  });

  it('does not match inside other words', () => {
    expect(findMentionedObjects('Showcase the accountant view', objects)).to.deep.equal([]);
  });
});
