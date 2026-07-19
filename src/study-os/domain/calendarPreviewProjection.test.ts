import assert from 'node:assert/strict';
import test from 'node:test';

import type { SprintCalendarDocument } from '../api/sprintCalendar';
import { projectCalendarPreviewEntries, summarizeCalendarPreviewByDay } from './calendarPreviewProjection';

const document = {
  run: { decision: 'draft' },
  items: [
    { id: 1, kind: 'source_task', title: 'Administração Pública', sourcePlanTaskId: 31 },
    { id: 2, kind: 'future_cycle_capacity', title: 'Capacidade futura', sourcePlanTaskId: null },
    { id: 3, kind: 'intervention', title: 'Intervenção IA', sourcePlanTaskId: null },
  ],
  assignments: [
    {
      id: 10,
      itemId: 1,
      date: '2026-07-18',
      position: 1,
      durationMinutes: 60,
      precision: 'exact',
      priorityTier: 'high',
      action: { title: 'Revisão cirúrgica: Finanças Públicas', topicHint: 'Corrigir ponto fraco' },
    },
    {
      id: 11,
      itemId: 2,
      date: '2026-07-22',
      position: 1,
      durationMinutes: 240,
      precision: 'provisional',
      priorityTier: 'maintenance',
      action: null,
    },
    {
      id: 12,
      itemId: 3,
      date: '2026-07-18',
      position: 2,
      durationMinutes: 30,
      precision: 'exact',
      priorityTier: 'critical',
      action: { title: 'Revisão cirúrgica', topicHint: null },
    },
  ],
} as SprintCalendarDocument;

test('projectCalendarPreviewEntries keeps the LS task identity and leaves AI interventions out of the task calendar', () => {
  assert.deepEqual(projectCalendarPreviewEntries(document, [{
    sourcePlanTaskId: 31,
    plannerTaskId: 'meta-48-task-10',
    taskNumber: 10,
    discipline: 'Administração Pública',
  }]), [{
    id: 'sprint-calendar-10',
    date: '2026-07-18',
    durationMinutes: 60,
    priorityTier: 'high',
    precision: 'exact',
    title: 'Administração Pública',
    topicHint: 'Corrigir ponto fraco',
    sourcePlanTaskId: 31,
    plannerTaskId: 'meta-48-task-10',
    taskNumber: 10,
    discipline: 'Administração Pública',
    isDraft: true,
  }]);
});

test('summarizeCalendarPreviewByDay keeps every block while exposing one readable focus per day', () => {
  const daySummary = summarizeCalendarPreviewByDay({
    ...document,
    assignments: [
      ...document.assignments,
      {
        id: 12,
        itemId: 1,
        date: '2026-07-18',
        position: 2,
        durationMinutes: 30,
        precision: 'exact',
        priorityTier: 'critical',
        action: { title: 'Simulado de Administração Pública', topicHint: null },
      },
    ],
  } as SprintCalendarDocument, [{
    sourcePlanTaskId: 31,
    plannerTaskId: 'meta-48-task-10',
    taskNumber: 10,
    discipline: 'Administração Pública',
  }]);

  assert.deepEqual(daySummary, [{
    date: '2026-07-18',
    durationMinutes: 90,
    blockCount: 2,
    priorityTier: 'critical',
    focusTitle: 'Administração Pública',
    focusTopicHint: undefined,
    focusPlannerTaskId: 'meta-48-task-10',
    focusTaskNumber: 10,
    focusDiscipline: 'Administração Pública',
    isDraft: true,
  }]);
});
