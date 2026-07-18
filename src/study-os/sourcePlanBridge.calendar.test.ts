import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerTask } from '../types';

import { plannerCalendarEndDate } from './sourcePlanBridge';


const currentTask: PlannerTask = {
  id: 'meta-47-current',
  number: 49,
  metaNumber: 47,
  discipline: 'Economia',
  format: 'Questões',
  description: 'Bloco da meta vigente',
  spentMinutes: 0,
  estimatedMinutes: 45,
  performance: null,
  status: 'pending',
  relevance: 9,
  durationMinutes: 45,
  source: 'ls-meta-text',
  sourceCycleStartsOn: '2026-07-18',
  sourceCycleEndsOn: '2026-07-21',
  createdAt: '2026-07-18T08:00:00-03:00',
  updatedAt: '2026-07-18T08:00:00-03:00',
};

test('calendar horizon uses the current cycle end inside the supported 15-day window and never includes P1', () => {
  assert.equal(
    plannerCalendarEndDate([currentTask], '2026-07-18', '2026-08-01'),
    '2026-07-21',
  );
  assert.equal(
    plannerCalendarEndDate([], '2026-07-18', '2026-08-01'),
    '2026-07-31',
  );
});

test('calendar horizon clamps a longer cycle to the backend 15-day contract', () => {
  assert.equal(
    plannerCalendarEndDate([{
      ...currentTask,
      sourceCycleEndsOn: '2026-08-20',
    }], '2026-07-18', '2026-09-01'),
    '2026-08-01',
  );
});
