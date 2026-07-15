import assert from 'node:assert/strict';
import test from 'node:test';

import type { SprintCalendarDocument } from '../api/sprintCalendar';
import { buildSprintCalendarView } from './sprintCalendarView';


const document = {
  run: { id: 7, decision: 'draft' },
  days: [
    {
      date: '2026-07-18', precision: 'provisional', availableMinutes: 300,
      reservedMinutes: 240, overageMinutes: 0,
    },
    {
      date: '2026-07-19', precision: 'protected', availableMinutes: 180,
      reservedMinutes: 210, overageMinutes: 30,
    },
  ],
  items: [
    { id: 1, state: 'pending' },
    { id: 2, state: 'completed' },
  ],
  assignments: [
    { itemId: 1, date: '2026-07-18', priorityTier: 'maintenance' },
    { itemId: 2, date: '2026-07-19', priorityTier: 'protected' },
  ],
} as SprintCalendarDocument;


test('calendar view combines day load, state, and human labels in one pass', () => {
  assert.deepEqual(buildSprintCalendarView(document), {
    runId: 7,
    decision: 'draft',
    totals: { days: 2, assignments: 2, completed: 1, overCapacityDays: 1 },
    days: [
      {
        date: '2026-07-18', label: 'Provisório', minutes: 240,
        capacityMinutes: 300, itemCount: 1, completedCount: 0,
        overCapacity: false, hottestPriority: 'maintenance',
      },
      {
        date: '2026-07-19', label: 'Protegido', minutes: 210,
        capacityMinutes: 180, itemCount: 1, completedCount: 1,
        overCapacity: true, hottestPriority: 'protected',
      },
    ],
  });
});

test('critical work remains hottest when a day also contains protected work', () => {
  const mixed = {
    ...document,
    assignments: [
      ...document.assignments,
      { itemId: 1, date: '2026-07-19', priorityTier: 'critical' },
    ],
  } as SprintCalendarDocument;

  assert.equal(buildSprintCalendarView(mixed).days[1]?.hottestPriority, 'critical');
});
