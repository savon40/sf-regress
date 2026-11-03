/** Public API of the regression engine. No CLI dependencies - safe to embed elsewhere. */
export * from './types.js';
export { runTests, runTest, isProduction, newRunId, type RunOptions, type RunEvent } from './runner.js';
export { parseTest, loadTestFile, TestFileError } from './loader.js';
export { findTestFiles } from './discover.js';
export { connectionClient } from './salesforce.js';
export { Variables, VariableError } from './variables.js';
export { CleanupTracker } from './cleanup.js';
export { resolveRelativeDate } from './dates.js';
export { stepTypeNames } from './steps/registry.js';
