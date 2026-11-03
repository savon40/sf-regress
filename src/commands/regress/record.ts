import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Args } from '@oclif/core';
import { Flags, SfCommand, StandardColors } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import {
  connectionClient,
  isProduction,
  parseTest,
  recordingToTest,
  runTests,
  slug,
  type CreatedRecord,
  type OrgClient,
} from '../../engine/index.js';
import { recordSession } from '../../browser/recorder.js';
import { browserFor, freshToken } from '../../cli/org-browser.js';
import { displayPath, formatTestResult } from '../../cli/output.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-regress', 'regress.record');

export type RegressRecordResult = {
  file: string;
  steps: number;
  params: Record<string, string>;
  created: CreatedRecord[];
  notes: string[];
  verified?: boolean;
};

export default class RegressRecord extends SfCommand<RegressRecordResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly args = {
    name: Args.string({ description: messages.getMessage('args.name.summary'), required: true }),
  };

  public static readonly flags = {
    'target-org': Flags.requiredOrg(),
    'api-version': Flags.orgApiVersion(),
    start: Flags.string({ summary: messages.getMessage('flags.start.summary'), default: '/lightning/page/home' }),
    output: Flags.file({ char: 'f', summary: messages.getMessage('flags.output.summary') }),
    'tests-dir': Flags.directory({
      char: 'd',
      summary: messages.getMessage('flags.tests-dir.summary'),
      default: 'tests',
    }),
    force: Flags.boolean({ summary: messages.getMessage('flags.force.summary'), default: false }),
    'keep-records': Flags.boolean({ summary: messages.getMessage('flags.keep-records.summary'), default: false }),
    verify: Flags.boolean({
      summary: messages.getMessage('flags.verify.summary'),
      default: true,
      allowNo: true,
    }),
    'allow-production': Flags.boolean({
      summary: messages.getMessage('flags.allow-production.summary'),
      default: false,
    }),
  };

  public async run(): Promise<RegressRecordResult> {
    const { args, flags } = await this.parse(RegressRecord);
    const targetOrg = flags['target-org'];
    const conn = targetOrg.getConnection(flags['api-version']);
    const client = connectionClient(conn);
    const org = await client.getOrgInfo();

    if (isProduction(org) && !flags['allow-production']) {
      throw new SfError(messages.getMessage('error.production', [org.name]), 'ProductionOrg');
    }
    const file = flags.output ?? join(flags['tests-dir'], `${slug(args.name)}.yaml`);
    if (existsSync(file) && !flags.force) throw new SfError(messages.getMessage('error.exists', [file]), 'FileExists');

    // 1. Record.
    const recording = await recordSession({
      ...(await freshToken(targetOrg, conn)),
      startPath: flags.start,
      onReady: () => this.log(messages.getMessage('info.ready')),
    });
    if (!recording.actions.some((a) => a.name !== 'openPage' && a.name !== 'closePage' && a.name !== 'navigate')) {
      throw new SfError(messages.getMessage('error.empty'), 'NothingRecorded');
    }

    // 2. Post-process into YAML (and find the records created while recording).
    this.spinner.start('Turning the recording into a test');
    const recorded = await recordingToTest(client, org, recording, { name: args.name, file });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, recorded.yaml);
    this.spinner.stop();
    const { created, notes } = recorded;

    this.log(`\nSaved ${StandardColors.success(displayPath(file))} (${recorded.steps} steps)`);
    for (const note of notes) this.warn(note);

    // 4. Remove what the recording created.
    if (created.length > 0) {
      if (flags['keep-records']) {
        this.log(`Kept ${created.length} record(s) created while recording.`);
      } else {
        await this.deleteRecords(client, created);
      }
    }

    // 5. Replay once.
    let verified: boolean | undefined;
    if (flags.verify) {
      this.log('\nReplaying the new test to check it works...\n');
      const summary = await runTests([parseTest(recorded.yaml, displayPath(file))], client, {
        browser: browserFor(targetOrg, conn, true),
        resultsDir: 'regress-results',
      });
      summary.tests.forEach((result) => formatTestResult(result).forEach((line) => this.log(line)));
      verified = summary.failed === 0;
      this.log(
        verified
          ? StandardColors.success('The recording replays cleanly.')
          : StandardColors.warning('The recording did not replay cleanly. Review the failed step in the YAML.')
      );
    }

    return { file, steps: recorded.steps, params: recorded.params, created, notes, verified };
  }

  private async deleteRecords(client: OrgClient, records: CreatedRecord[]): Promise<void> {
    for (const record of [...records].reverse()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await client.delete(record.sobject, record.id);
        this.log(`Deleted ${record.sobject} ${record.name ?? record.id} (created while recording)`);
      } catch (error) {
        this.warn(`Could not delete ${record.sobject} ${record.id}: ${(error as Error).message}`);
      }
    }
  }
}
