import assert from 'node:assert/strict';
import test from 'node:test';

import {
  plannerTaskActionAvailability,
  plannerTaskPerformanceLabel,
} from './plannerExecutionUi';

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

test('missing performance remains unknown instead of becoming zero-percent evidence', () => {
  assert.equal(plannerTaskPerformanceLabel(null), 'Sem evidência');
  assert.equal(plannerTaskPerformanceLabel(0), '0%');
  assert.equal(plannerTaskPerformanceLabel(82.5), '82,5%');
});
