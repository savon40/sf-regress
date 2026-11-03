import { expect } from 'chai';
import { toJUnitXml } from '../../src/engine/junit.js';
import type { RunSummary } from '../../src/engine/types.js';
import { DEV_ORG } from './mock-org.js';

describe('junit', () => {
  const summary: RunSummary = {
    org: { ...DEV_ORG, instanceUrl: 'https://x.my.salesforce.com' },
    runId: 'abc',
    passed: 1,
    failed: 1,
    durationMs: 3500,
    tests: [
      {
        name: 'Passes',
        file: 'tests/a.yaml',
        status: 'passed',
        durationMs: 1000,
        steps: [{ index: 1, type: 'api.create', status: 'passed', durationMs: 5, detail: 'Account 001' }],
        cleanup: { deleted: [{ sobject: 'Account', id: '001' }], errors: [] },
      },
      {
        name: 'Fails <with> "quotes" & stuff',
        file: 'tests/b.yaml',
        status: 'failed',
        durationMs: 2500,
        steps: [
          {
            index: 1,
            type: 'assert.equals',
            status: 'failed',
            durationMs: 1,
            line: 7,
            error: 'expected "A", got "B"',
            screenshot: 'regress-results/b-step1.png',
          },
          { index: 2, type: 'assert.exists', status: 'skipped', durationMs: 0 },
        ],
        cleanup: { deleted: [], errors: [] },
      },
    ],
  };

  it('writes one testcase per test with failures and escaping', () => {
    const xml = toJUnitXml(summary);
    expect(xml).to.match(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).to.include('<testsuite name="sf-regress" tests="2" failures="1"');
    expect(xml).to.include('<testcase name="Passes" classname="tests/a.yaml" time="1.000">');
    expect(xml).to.include('name="Fails &lt;with&gt; &quot;quotes&quot; &amp; stuff"');
    expect(xml).to.include('<failure message="Step 1 (assert.equals): expected &quot;A&quot;, got &quot;B&quot;"');
    expect(xml).to.include('at tests/b.yaml:7');
    expect(xml).to.include('screenshot: regress-results/b-step1.png');
    expect(xml).to.include('SKIPPED 2. assert.exists');
    expect(xml.match(/<failure /g)).to.have.length(1);
  });
});
