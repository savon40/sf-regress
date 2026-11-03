import { apiCreate, apiDelete, apiQuery, apiTrack, apiUpdate } from './api.js';
import { assertContains, assertEquals, assertExists, assertNotEquals } from './assert.js';
import {
  browserCaptureRecord,
  browserClick,
  browserExpectHidden,
  browserExpectText,
  browserExpectValue,
  browserExpectVisible,
  browserFill,
  browserGoto,
  browserPress,
  browserSelect,
} from './browser.js';
import type { StepType } from './step.js';

/** All step types. Adding a step type = write its module, add it here. */
const STEP_TYPES: StepType[] = [
  apiCreate,
  apiUpdate,
  apiDelete,
  apiQuery,
  apiTrack,
  assertEquals,
  assertNotEquals,
  assertContains,
  assertExists,
  browserGoto,
  browserClick,
  browserFill,
  browserSelect,
  browserPress,
  browserExpectVisible,
  browserExpectHidden,
  browserExpectValue,
  browserExpectText,
  browserCaptureRecord,
];

const byType = new Map(STEP_TYPES.map((step) => [step.type, step]));

export function getStepType(type: string): StepType | undefined {
  return byType.get(type);
}

export function stepTypeNames(): string[] {
  return [...byType.keys()];
}
