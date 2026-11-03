import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'chai';
import { chromium, type Browser, type Page } from 'playwright';
import { expectFailure, harness, runStep, type Harness } from './helpers.js';
import { CONSOLE_NEW_ACCOUNT, NEW_ACCOUNT_MODAL, RECORD_PAGE } from './lightning-fixture.js';

const RECORD_ID = '001000000000001AAA';

describe('browser steps', function () {
  this.timeout(30_000);
  let browser: Browser;
  let server: Server;
  let baseUrl: string;
  let page: Page;
  let h: Harness;

  before(async () => {
    server = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.url?.startsWith('/lightning/r/')) res.end(RECORD_PAGE);
      else if (req.url === '/secur/login') res.end('<html>login</html>');
      else if (req.url === '/console') res.end(CONSOLE_NEW_ACCOUNT);
      else res.end(NEW_ACCOUNT_MODAL);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    h = harness(page, baseUrl);
    await page.goto(`${baseUrl}/new`);
  });

  afterEach(async () => {
    await page.close();
  });

  const short = { timeout: 1000 };

  describe('browser.goto', () => {
    it('opens a path relative to the org', async () => {
      h.vars.set('acct', { Id: RECORD_ID });
      const out = await runStep(h, 'browser.goto', { path: '/lightning/r/Account/$acct.Id/view' });
      expect(page.url()).to.equal(`${baseUrl}/lightning/r/Account/${RECORD_ID}/view`);
      expect(out?.detail).to.equal(`/lightning/r/Account/${RECORD_ID}/view`);
    });

    it('fails when it lands on a login page', async () => {
      const message = await expectFailure(runStep(h, 'browser.goto', { path: '/secur/login' }));
      expect(message).to.match(/login page/);
    });
  });

  describe('browser.click', () => {
    it('clicks the visible button with exactly that label', async () => {
      await runStep(h, 'browser.click', { button: 'New' });
      expect(await page.locator('#modal').isVisible()).to.equal(true);
    });

    it('ignores hidden copies and partial matches ("Save" is not "Save & New")', async () => {
      await runStep(h, 'browser.click', { button: 'New' });
      await runStep(h, 'browser.fill', { field: 'Account Name', value: 'Acme' });
      await runStep(h, 'browser.click', { button: 'Save', in: 'New Account' });
      expect(await page.locator('#toast').textContent()).to.equal('Account "Acme" was created.');
    });

    it('scopes "in" to a console workspace tab by its heading', async () => {
      await page.goto(`${baseUrl}/console`);
      await runStep(h, 'browser.fill', { field: 'Account Name', value: 'Acme', in: 'New Account' });
      await runStep(h, 'browser.click', { button: 'Save', in: 'New Account' });
      expect(await page.locator('#result').textContent()).to.equal('saved Acme');
    });

    it('fails clearly when nothing visible matches', async () => {
      const message = await expectFailure(runStep(h, 'browser.click', { button: 'Delete', ...short }));
      expect(message).to.equal('Could not find a visible button "Delete" within 1s');
    });

    it('rejects a target with no kind or two kinds', async () => {
      expect(await expectFailure(runStep(h, 'browser.click', {}))).to.match(/one of: button, link/);
      expect(await expectFailure(runStep(h, 'browser.click', { button: 'A', link: 'B' }))).to.match(
        /only one of button, link/
      );
    });
  });

  describe('browser.fill', () => {
    it('fills a required field by its label without the asterisk', async () => {
      await runStep(h, 'browser.click', { button: 'New' });
      h.vars.set('run', { id: 'abc' });
      await runStep(h, 'browser.fill', { field: 'Account Name', value: 'Acme $run.id' });
      expect(await page.locator('#name').inputValue()).to.equal('Acme abc');
    });
  });

  describe('browser.select', () => {
    beforeEach(async () => {
      await runStep(h, 'browser.click', { button: 'New' });
    });

    it('picks an option in a Lightning picklist', async () => {
      await runStep(h, 'browser.select', { field: 'Industry', value: 'Technology' });
      expect(await page.locator('#ind').getAttribute('data-value')).to.equal('Technology');
    });

    it('types into a lookup and picks the result that starts with the name, not "Show more results"', async () => {
      await runStep(h, 'browser.select', { field: 'Parent Account', value: 'Acme Corp' });
      expect(await page.locator('#parent').inputValue()).to.equal('Acme Corp');
      expect(await page.locator('#advanced').isVisible()).to.equal(false);
    });

    it('selects in a native select', async () => {
      await runStep(h, 'browser.select', { field: 'Type', value: 'Partner' });
      expect(await page.locator('#type').inputValue()).to.equal('Partner');
    });
  });

  describe('browser.expectVisible / expectHidden', () => {
    it('passes for visible elements and fails for hidden ones', async () => {
      await runStep(h, 'browser.expectVisible', { button: 'New' });
      const message = await expectFailure(
        runStep(h, 'browser.expectVisible', { field: 'Account Name', in: 'New Account', ...short })
      );
      expect(message).to.match(/Could not find a visible field "Account Name" in "New Account"/);
    });

    it('waits for elements to disappear', async () => {
      await runStep(h, 'browser.expectHidden', { heading: 'New Account', ...short });
      await runStep(h, 'browser.click', { button: 'New' });
      const message = await expectFailure(runStep(h, 'browser.expectHidden', { heading: 'New Account', ...short }));
      expect(message).to.match(/still shown/);
    });

    it('matches text by substring', async () => {
      await runStep(h, 'browser.click', { button: 'New' });
      await runStep(h, 'browser.fill', { field: 'Account Name', value: 'Acme' });
      await runStep(h, 'browser.click', { button: 'Save', in: 'New Account' });
      await runStep(h, 'browser.expectVisible', { text: 'was created' });
    });
  });

  describe('browser.expectValue / expectText', () => {
    it('checks input and picklist values', async () => {
      await runStep(h, 'browser.click', { button: 'New' });
      await runStep(h, 'browser.fill', { field: 'Account Name', value: 'Acme' });
      await runStep(h, 'browser.select', { field: 'Industry', value: 'Banking' });
      await runStep(h, 'browser.expectValue', { field: 'Account Name', value: 'Acme' });
      await runStep(h, 'browser.expectValue', { field: 'Industry', value: 'Banking' });
      const message = await expectFailure(
        runStep(h, 'browser.expectValue', { field: 'Account Name', value: 'Other', ...short })
      );
      expect(message).to.equal('field "Account Name": expected "Other", got "Acme"');
    });

    it('reads read-only field values on a record page through shadow DOM', async () => {
      await page.goto(`${baseUrl}/lightning/r/Account/${RECORD_ID}/view`);
      await runStep(h, 'browser.expectValue', { field: 'Industry', value: 'Banking' });
      await runStep(h, 'browser.expectValue', { field: 'Rating__c', value: 'Hot' });
      await runStep(h, 'browser.expectText', { heading: 'Acme Corp', contains: 'acme corp' });
      const message = await expectFailure(
        runStep(h, 'browser.expectText', { field: 'Industry', contains: 'Retail', ...short })
      );
      expect(message).to.equal('field "Industry": expected to contain "Retail", got "Banking"');
    });

    it('matches lookups on their first line and highlights-panel fields without their label', async () => {
      await page.goto(`${baseUrl}/lightning/r/Account/${RECORD_ID}/view`);
      await runStep(h, 'browser.expectValue', { field: 'Account Name', value: 'Acme Holdings' });
      await runStep(h, 'browser.expectValue', { field: 'Close Date', value: '12/31/2026' });
    });
  });

  describe('browser.captureRecord', () => {
    beforeEach(async () => {
      await page.goto(`${baseUrl}/lightning/r/Account/${RECORD_ID}/view`);
    });

    it('stores the record from the URL and tracks it when this user just created it', async () => {
      h.org.onQuery = () => ({
        totalSize: 1,
        done: true,
        records: [{ Id: RECORD_ID, CreatedById: '005USER', CreatedDate: new Date().toISOString() }],
      });
      const out = await runStep(h, 'browser.captureRecord', { as: 'acct' });
      expect(h.vars.get('acct')).to.include({ Id: RECORD_ID, sobject: 'Account' });
      expect(h.cleanup.records()).to.deep.equal([{ sobject: 'Account', id: RECORD_ID }]);
      expect(out?.detail).to.equal(`Account ${RECORD_ID}`);
      expect(h.org.calls[0].soql).to.equal(
        `SELECT Id, CreatedById, CreatedDate FROM Account WHERE Id = '${RECORD_ID}'`
      );
    });

    it('does not clean up records that existed before the test', async () => {
      h.org.onQuery = () => ({
        totalSize: 1,
        done: true,
        records: [{ Id: RECORD_ID, CreatedById: '005USER', CreatedDate: '2020-01-01T00:00:00.000+0000' }],
      });
      const out = await runStep(h, 'browser.captureRecord', { as: 'acct' });
      expect(h.cleanup.records()).to.have.length(0);
      expect(out?.detail).to.match(/existing record, not cleaned up/);
    });

    it('does not clean up records created by someone else', async () => {
      h.org.onQuery = () => ({
        totalSize: 1,
        done: true,
        records: [{ Id: RECORD_ID, CreatedById: '005OTHER', CreatedDate: new Date().toISOString() }],
      });
      await runStep(h, 'browser.captureRecord', { as: 'acct' });
      expect(h.cleanup.records()).to.have.length(0);
    });

    it('fails when the browser is not on a record page', async () => {
      await page.goto(`${baseUrl}/new`);
      const message = await expectFailure(runStep(h, 'browser.captureRecord', { as: 'acct', ...short }));
      expect(message).to.match(/not on a record page \(URL: \/new\)/);
    });
  });
});
