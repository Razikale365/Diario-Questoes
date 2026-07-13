import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReviewQueueItem } from '../api/learning';
import type { PlannerWeek } from '../api/planner';
import {
  adaptationReasonLabel,
  buildAdaptiveWeekColumns,
  getPlannerWeekStart,
  reviewDueStatus,
  reviewQueueProof,
} from './adaptiveView';

const score = {
  weakness: 1,
  incidence: 2,
  tier: 3,
  coverageNeed: 4,
  reviewDebt: 5,
  lsAlignment: 6,
  targetFit: 7,
  overlapValue: 8,
  deadlinePressure: 9,
  bancaFit: 10,
  editalWeight: 11,
  balancePenalty: 0,
  lowTrustPenalty: 0,
  weeklyAlignment: 100,
  finalScore: 123,
};

const week: PlannerWeek = {
  run: {
    id: 8,
    targetSlug: 'bacen_economia_financas',
    weekStart: '2026-07-13',
    phase: 'pre_edital',
    algorithmVersion: 'm5-week-v1',
    requestHash: 'request',
    inputHash: 'input',
    supersedesWeekRunId: null,
    status: 'generated',
    shortfallCount: 0,
    shortfallReasons: [],
    generatedAt: '2026-07-12T20:00:00Z',
  },
  slots: [{
    id: 80,
    weekRunId: 8,
    targetSlug: 'bacen_economia_financas',
    date: '2026-07-15',
    position: 1,
    candidateKey: 'candidate-1',
    topicTargetSlug: 'bacen_economia_financas',
    targetTopicId: 12,
    blockKind: 'questions',
    durationMinutes: 60,
    plannedQuestions: 20,
    score,
    evidence: {
      discipline: 'Macroeconomia',
      topic: 'Politica monetaria',
      adaptationReason: 'weekly_forecast_follow',
      candidateEvidence: {},
    },
    state: 'forecast',
    dayRunId: null,
    dayBlockId: null,
  }],
};

test('adaptive week always exposes Monday through Sunday and emphasizes the selected date', () => {
  assert.equal(getPlannerWeekStart('2026-07-16'), '2026-07-13');
  const columns = buildAdaptiveWeekColumns(week, '2026-07-15');
  assert.equal(columns.length, 7);
  assert.deepEqual(columns.map((column) => column.date), [
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    '2026-07-17', '2026-07-18', '2026-07-19',
  ]);
  assert.equal(columns[2].selected, true);
  assert.equal(columns[2].slots[0]?.evidence.topic, 'Politica monetaria');
});

test('adaptation labels distinguish following the forecast from new evidence', () => {
  assert.equal(adaptationReasonLabel('weekly_forecast_follow'), 'Segue a previsão semanal');
  assert.equal(adaptationReasonLabel('weekly_diverged_current_evidence'), 'Mudou com evidência nova');
  assert.equal(adaptationReasonLabel('bounded_review_due'), 'Revisão curta vencida');
  assert.equal(adaptationReasonLabel('stale_return'), 'Conteúdo voltou por desatualização');
  assert.equal(adaptationReasonLabel('future_reason'), 'Ajuste adaptativo');
});

test('review timing distinguishes overdue, due today, and future work', () => {
  assert.equal(reviewDueStatus('2026-07-11', '2026-07-12'), 'overdue');
  assert.equal(reviewDueStatus('2026-07-12', '2026-07-12'), 'today');
  assert.equal(reviewDueStatus('2026-07-13', '2026-07-12'), 'future');
});

test('review proof exposes bounded work and evidence count without question content', () => {
  const item: ReviewQueueItem = {
    id: 1,
    targetSlug: 'bacen_economia_financas',
    topicTargetSlug: 'bacen_economia_financas',
    targetTopicId: 12,
    dueDate: '2026-07-15',
    state: 'pending',
    boundedQuestions: 7,
    triggerEventIds: [2, 3],
    reason: 'recent_errors',
    debtBp: 3750,
    attemptCount: 1,
    resolvedEventId: null,
    version: 1,
    createdAt: '2026-07-12T20:00:00Z',
    updatedAt: '2026-07-12T20:00:00Z',
  };
  assert.equal(reviewQueueProof(item), '7 questões · dívida 38% · 2 evidências');
});
