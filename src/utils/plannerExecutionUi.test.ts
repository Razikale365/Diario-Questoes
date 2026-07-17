import assert from 'node:assert/strict';
import test from 'node:test';

import { plannerTaskActionAvailability } from './plannerExecutionUi';

test('completed Planner work remains visible but exposes no executable controls', () => {
  assert.deepEqual(plannerTaskActionAvailability('completed'), {
    canExecute: false,
    canRecordResult: false,
  });
  assert.deepEqual(plannerTaskActionAvailability('pending'), {
    canExecute: true,
    canRecordResult: true,
  });
});
