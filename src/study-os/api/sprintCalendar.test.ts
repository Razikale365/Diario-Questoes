import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySprintCalendarRun,
  fetchSprintCalendarHead,
  parseSprintCalendar,
  previewSprintCalendar,
} from './sprintCalendar';


const calendar = {
  run: {
    id: 7,
    targetSlug: 'sefaz_ce',
    windowStart: '2026-07-18',
    windowEnd: '2026-07-18',
    planningCutoff: '2026-07-15T12:00:00.000000Z',
    exactThrough: '2026-07-17',
    algorithmVersion: 'sefaz-ce-calendar-v1',
    requestHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    baseAppliedRunId: null,
    supersedesRunId: null,
    decision: 'draft',
    status: 'generated',
    warnings: [],
    shortfalls: [],
    version: 1,
    generatedAt: '2026-07-15T12:00:01.000Z',
    appliedAt: null,
  },
  days: [{
    id: 11,
    date: '2026-07-18',
    precision: 'provisional',
    availabilitySource: 'default',
    available: true,
    availableMinutes: 300,
    lsMinutes: 240,
    extraMinutes: 60,
    reservedMinutes: 240,
    overageMinutes: 0,
    energyLevel: 3,
    confidenceBp: 0,
    warnings: [],
  }],
  items: [{
    id: 21,
    itemKey: 'future-cycle:48:2026-07-18',
    origin: 'system',
    kind: 'future_cycle_capacity',
    sourcePlanTaskId: null,
    subjectProfileId: null,
    title: 'Capacidade reservada · aguardando Meta 48',
    expectedMetaNumber: 48,
    state: 'pending',
    result: {},
    completedAt: null,
    version: 1,
  }],
  assignments: [{
    id: 31,
    itemId: 21,
    date: '2026-07-18',
    position: 1,
    durationMinutes: 240,
    precision: 'provisional',
    priorityTier: 'maintenance',
    reasons: ['future_ls_cycle_capacity_only'],
    pinned: false,
    action: null,
    expectedGainMilli: 0,
    replacesPlaceholderItemId: null,
  }],
  overrideVersions: {},
  diff: {
    added: 1,
    moved: 0,
    preserved: 0,
    completed: 0,
    removed: 0,
    noSpace: 0,
    placeholderReplacements: 0,
  },
  replayed: false,
};


test('calendar parser accepts a non-executable provisional envelope', () => {
  assert.deepEqual(parseSprintCalendar(calendar), calendar);
});

test('calendar parser rejects executable placeholders and duplicate day identities', () => {
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    items: [{ ...calendar.items[0], sourcePlanTaskId: 12 }],
  }), /placeholder/i);
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    assignments: [{ ...calendar.assignments[0], action: { action_kind: 'ls_execute' } }],
  }), /placeholder/i);
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    assignments: [{ ...calendar.assignments[0], precision: 'exact' }],
  }), /placeholder/i);
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    days: [...calendar.days, { ...calendar.days[0], id: 12 }],
  }), /duplicate/i);
});

test('calendar parser accepts a source assignment whose replaced placeholder belongs to the base run', () => {
  const replacement = {
    ...calendar,
    items: [{
      ...calendar.items[0], id: 22, itemKey: 'source:48:1', origin: 'source', kind: 'source_task',
      sourcePlanTaskId: 77, subjectProfileId: 1, title: 'Tarefa da Meta 48', expectedMetaNumber: 48,
    }],
    assignments: [{
      ...calendar.assignments[0], itemId: 22, precision: 'exact', action: { title: 'Executar: Tarefa da Meta 48' },
      expectedGainMilli: 10, replacesPlaceholderItemId: 999,
    }],
    diff: { ...calendar.diff, placeholderReplacements: 1 },
  };

  assert.deepEqual(parseSprintCalendar(replacement), replacement);
});

test('calendar parser rejects inconsistent capacity and applied runs without timestamp', () => {
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    days: [{ ...calendar.days[0], availableMinutes: 299 }],
  }), /capacity/i);
  assert.throws(() => parseSprintCalendar({
    ...calendar,
    run: { ...calendar.run, decision: 'applied', appliedAt: null },
  }), /applied/i);
});

test('preview and apply preserve idempotency, mode, and expected head', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    const response = requests.length === 1
      ? calendar
      : {
        ...calendar,
        run: {
          ...calendar.run,
          decision: 'applied',
          appliedAt: '2026-07-15T12:01:00.000Z',
          version: 2,
        },
        undoRunId: null,
      };
    return new Response(JSON.stringify(response), {
      status: requests.length === 1 ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await previewSprintCalendar({
    targetSlug: 'sefaz_ce',
    startDate: '2026-07-18',
    endDate: '2026-07-31',
    expectedRunId: null,
    mode: 'restore_run',
    maxTasksPerDay: 4,
    hoursPerDay: 4,
    restoreRunId: 6,
  }, 'preview-key');
  await applySprintCalendarRun(7, {
    expectedRunId: null,
    expectedOverrideVersions: {},
  }, 'apply-key');

  assert.equal(requests[0]?.input, '/api/v1/sprints/calendar/preview');
  assert.equal(new Headers(requests[0]?.init?.headers).get('Idempotency-Key'), 'preview-key');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    targetSlug: 'sefaz_ce',
    startDate: '2026-07-18',
    endDate: '2026-07-31',
    expectedRunId: null,
    mode: 'restore_run',
    maxTasksPerDay: 4,
    hoursPerDay: 4,
    restoreRunId: 6,
  });
  assert.equal(requests[1]?.input, '/api/v1/sprints/calendar/runs/7/apply');
  assert.equal(new Headers(requests[1]?.init?.headers).get('Idempotency-Key'), 'apply-key');
});

test('calendar head converts only the structured missing response to null', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'calendar_not_found', message: 'missing',
  }), { status: 404, headers: { 'Content-Type': 'application/json' } }));

  assert.equal(await fetchSprintCalendarHead('sefaz_ce', '2026-07-18'), null);
});

test('restore mode requires restoreRunId and other modes reject it', async () => {
  await assert.rejects(() => previewSprintCalendar({
    targetSlug: 'sefaz_ce', startDate: '2026-07-18', endDate: '2026-07-31',
    expectedRunId: null, mode: 'restore_run', maxTasksPerDay: 4, hoursPerDay: 4,
  }, 'missing-restore'), /restoreRunId/);
  await assert.rejects(() => previewSprintCalendar({
    targetSlug: 'sefaz_ce', startDate: '2026-07-18', endDate: '2026-07-31',
    expectedRunId: null, mode: 'reflow_open', maxTasksPerDay: 4, hoursPerDay: 4, restoreRunId: 6,
  }, 'extra-restore'), /restoreRunId/);
});
