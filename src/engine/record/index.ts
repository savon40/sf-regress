import { parseTest } from '../loader.js';
import type { OrgClient, OrgInfo } from '../types.js';
import { convertRecording } from './convert.js';
import { candidateObjects, findCreatedRecords } from './created.js';
import type { CreatedRecord, Recording } from './types.js';
import { toYaml } from './yaml.js';

export type RecordedTest = {
  yaml: string;
  steps: number;
  params: Record<string, string>;
  created: CreatedRecord[];
  notes: string[];
};

/**
 * The whole post-processing pipeline: find the records the user created while recording,
 * convert the recording into steps, and write YAML (checked to load before returning).
 */
export async function recordingToTest(
  client: OrgClient,
  org: OrgInfo,
  recording: Recording,
  options: { name: string; file: string }
): Promise<RecordedTest> {
  const objects = (await client.describeObjects?.().catch(() => [])) ?? [];
  const toName = Object.fromEntries(objects.map((o) => [o.label.toLowerCase(), o.name]));
  const toLabel = Object.fromEntries(objects.map((o) => [o.name, o.label]));

  const candidates = candidateObjects(recording, toName);
  const created = await findCreatedRecords(client, candidates, new Date(recording.startedAt), org.userId ?? '');
  const { test, notes } = convertRecording(recording, { name: options.name, created, labels: toLabel });
  const yaml = toYaml(test, [
    `Recorded with "sf regress record" on ${recording.startedAt.slice(0, 10)}.`,
    `Run it with: sf regress run --test ${options.file} --target-org <alias>`,
  ]);
  parseTest(yaml, options.file); // Never hand back a test the runner can't load.
  return { yaml, steps: test.steps.length, params: test.params, created, notes };
}
