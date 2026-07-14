import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSourcePlanTasks,
  fetchOptionalSprintDay,
  generateSprintDay,
  importSourcePlan,
  parseSprintConfig,
  parseSprintDay,
  updateSprintAction,
} from './sprint';


const subject = {
  id: 1,
  targetSlug: 'sefaz_ce',
  subjectKey: 'p2_lte',
  displayName: 'Legislacao Tributaria Estadual do Ceara',
  aliases: ['LTE'],
  paper: 'P2',
  questionCount: 20,
  questionWeight: 2,
  discursiveEligible: true,
  baselineAccuracyBp: null,
  targetLowBp: 7875,
  targetHighBp: 8375,
  baselineConfidenceBp: 0,
  focusBand: 'focus',
  baselineSource: 'unknown',
  notes: '',
  active: true,
  version: 1,
};

const config = {
  targetSlug: 'sefaz_ce',
  startDate: '2026-07-13',
  objectiveDate: '2026-08-01',
  examEndDate: '2026-08-02',
  lsBudgetMinutes: 240,
  extraBudgetMinutes: 60,
  triageMode: 'suggest_only',
  state: 'active',
  goals: {
    p1Floor: 48,
    p1Low: 48,
    p1High: 52,
    p2Low: 63,
    p2High: 67,
    discursiveLow: 75,
    discursiveHigh: 82,
  },
  subjects: [subject],
  version: 1,
};

const action = {
  id: 2,
  runId: 1,
  position: 1,
  actionKind: 'ls_execute',
  recommendation: 'execute',
  sourcePlanTaskId: 4,
  externalTaskId: 'meta-47-29',
  planLabel: 'Meta 47',
  subjectProfileId: 1,
  subjectKey: 'p2_lte',
  subjectName: 'Legislacao Tributaria Estadual do Ceara',
  paper: 'P2',
  topicHint: 'Lei 18.665/2023',
  title: 'Executar: Revisao intermediaria',
  durationMinutes: 60,
  plannedQuestions: 10,
  expectedGainMilli: 400,
  confidenceBp: 2500,
  whyNow: 'Peso 2 e deficit confirmado.',
  rationale: ['Peso 2 e deficit confirmado.'],
  scoreDetails: { questionWeight: 2 },
  decision: 'pending',
  state: 'pending',
  actualMinutes: null,
  questionsDone: 0,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  energyAfter: null,
  linkedStudyTaskId: null,
  materialHint: '',
  questionRefs: [{ questionFingerprint: 'q-1', sourceTaskId: 'task-1', reason: 'doubt' }],
  version: 1,
};

const day = {
  runId: 1,
  targetSlug: 'sefaz_ce',
  date: '2026-07-14',
  daysRemaining: 18,
  modeLabel: 'Reta final tatica',
  capacity: { lsBudgetMinutes: 240, extraBudgetMinutes: 60, energyLevel: 3 },
  projections: { p1: 42, p2: 55 },
  actions: [action],
  minimumViable: { actionIds: [2], minutes: 60 },
  supersedesRunId: null,
  status: 'generated',
  algorithmVersion: 'sefaz-ce-sprint-v1',
  generatedAt: '2026-07-13T20:00:00Z',
  version: 1,
  replayed: false,
};

test('sprint parsers accept the official config and auditable day contract', () => {
  assert.deepEqual(parseSprintConfig(config), config);
  assert.deepEqual(parseSprintDay(day), day);
});

test('sprint parsers reject automatic LS mutation and invalid budgets', () => {
  assert.throws(
    () => parseSprintDay({
      ...day,
      actions: [{ ...action, recommendation: 'auto_delete' }],
    }),
    /sprint action/i,
  );
  assert.throws(
    () => parseSprintConfig({ ...config, extraBudgetMinutes: 300 }),
    /sprint config/i,
  );
});

test('sprint requests preserve idempotency and exact action result payloads', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    const response = requests.length === 1
      ? day
      : requests.length === 2
        ? {
            targetSlug: 'sefaz_ce', sourceKind: 'ls', planLabel: 'Meta 47',
            createdCount: 1, updatedCount: 0, unresolvedCount: 0,
            taskIds: [4], replayed: false,
          }
        : { ...action, state: 'completed', version: 2, replayed: false };
    return new Response(JSON.stringify(response), {
      status: requests.length === 1 ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await generateSprintDay({
    targetSlug: 'sefaz_ce', date: '2026-07-14', energyLevel: 3,
    p1Projection: 42, p2Projection: 55,
  }, 'generate-key');
  await importSourcePlan({
    targetSlug: 'sefaz_ce', sourceKind: 'ls', planLabel: 'Meta 47', metaNumber: 47,
    tasks: [{
      externalTaskId: 'meta-47-29', scheduledDate: '2026-07-14', sourceOrder: 29,
      discipline: 'LTE', topicHint: 'ICMS', taskKind: 'review', description: 'Revisao',
      estimatedMinutes: 60, status: 'pending',
    }],
  }, 'import-key');
  await updateSprintAction(2, {
    expectedVersion: 1,
    decision: 'accepted',
    state: 'completed',
    actualMinutes: 58,
    questionsDone: 10,
    correctCount: 7,
    wrongCount: 3,
    doubtCount: 2,
    energyAfter: 2,
    questionRefs: [{ questionFingerprint: 'q-1', sourceTaskId: 'task-1', reason: 'doubt' }],
  }, 'action-key');

  assert.equal(requests[0]?.input, '/api/v1/sprints/generate-day');
  assert.equal(new Headers(requests[0]?.init?.headers).get('Idempotency-Key'), 'generate-key');
  assert.equal(requests[1]?.input, '/api/v1/source-plans/import');
  assert.equal(new Headers(requests[1]?.init?.headers).get('Idempotency-Key'), 'import-key');
  assert.equal(requests[2]?.input, '/api/v1/sprints/actions/2');
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
    expectedVersion: 1,
    decision: 'accepted',
    state: 'completed',
    actualMinutes: 58,
    questionsDone: 10,
    correctCount: 7,
    wrongCount: 3,
    doubtCount: 2,
    energyAfter: 2,
    questionRefs: [{ questionFingerprint: 'q-1', sourceTaskId: 'task-1', reason: 'doubt' }],
  });
});

test('optional sprint day only converts the structured missing response to null', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'sprint_day_not_found', message: 'missing',
  }), { status: 404, headers: { 'Content-Type': 'application/json' } }));

  assert.equal(await fetchOptionalSprintDay('sefaz_ce', '2026-07-14'), null);
});

test('source-plan task listing restores the complete persisted calendar contract including zero order', async (context) => {
  const sourceTask = {
    id: 4,
    targetSlug: 'sefaz_ce',
    sourceKind: 'ls',
    externalTaskId: 'meta-47-29',
    planLabel: 'Meta 47',
    metaNumber: 0,
    scheduledDate: '2026-07-14',
    sourceOrder: 0,
    discipline: 'Legislacao Tributaria Estadual',
    subjectKey: 'p2_lte',
    mappingStatus: 'matched',
    topicHint: 'Lei 18.665/2023',
    taskKind: 'review',
    description: 'Revisao intermediaria',
    details: 'Refazer erros e duvidas.',
    materialHint: 'PDF original',
    estimatedMinutes: 60,
    spentMinutes: 12,
    relevance: 10,
    status: 'started',
    performanceBp: 7000,
    linkedStudyTaskId: 'study-task-1',
    provenance: {
      browserTaskId: 'meta-47-29',
      plannerSource: 'ls-meta-text',
      planejamento: 'SEFAZ CE Pos-edital',
      startTime: '08:00',
    },
    version: 2,
  };
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    targetSlug: 'sefaz_ce',
    date: null,
    items: [sourceTask],
    unresolvedCount: 0,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  const result = await fetchSourcePlanTasks('sefaz_ce');

  assert.deepEqual(result.items, [sourceTask]);
  assert.equal(result.unresolvedCount, 0);
});
