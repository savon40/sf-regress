import { apiCreate, apiDelete, apiQuery, apiTrack, apiUpdate } from './api.js';
import { assertContains, assertEquals, assertExists, assertNotEquals } from './assert.js';
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
];

const byType = new Map(STEP_TYPES.map((step) => [step.type, step]));

export function getStepType(type: string): StepType | undefined {
  return byType.get(type);
}

export function stepTypeNames(): string[] {
  return [...byType.keys()];
}
