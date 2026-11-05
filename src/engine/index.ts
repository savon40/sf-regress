/** Public API of the regression engine. No CLI dependencies - safe to embed elsewhere. */
export * from './types.js';
export { runTests, runTest, isProduction, newRunId, type RunOptions, type RunEvent } from './runner.js';
export { parseTest, loadTestFile, TestFileError } from './loader.js';
export { findTestFiles } from './discover.js';
export { connectionClient, connectionMetadata } from './salesforce.js';
export { Variables, VariableError } from './variables.js';
export { CleanupTracker } from './cleanup.js';
export { resolveRelativeDate } from './dates.js';
export { stepTypeNames } from './steps/registry.js';
export { toJUnitXml } from './junit.js';
export { slug } from './runner.js';
export { DEFAULT_TIMEOUT } from './steps/browser.js';
export { convertRecording, type ConvertResult, type DraftTest } from './record/convert.js';
export { toYaml } from './record/yaml.js';
export { candidateObjects, findCreatedRecords } from './record/created.js';
export { recordingToTest, type RecordedTest } from './record/index.js';
export type { Recording, CreatedRecord } from './record/types.js';
export {
  listObjects,
  findMentionedObjects,
  loadObjectContext,
  loadOrgContext,
  formatObjectContext,
  formatOrgContext,
  type MetadataSource,
  type ObjectContext,
  type ObjectSummary,
  type FieldContext,
} from './author/org-context.js';
