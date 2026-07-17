import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSourcePlanBacklog,
  fetchSourcePlanTasks,
  fetchOptionalSprintDay,
  fetchSprintEvidence,
  fetchSprintProjection,
  fetchSprintTrajectory,
  generateSprintDay,
  importSourcePlan,
  parseSourcePlanBacklogList,
  parseSprintConfig,
  parseSprintDay,
  parseSprintEvidenceList,
  parseSprintProjection,
  parseSprintTrajectory,
  parseTaskExecutionResult,
  recordSourceTaskExecution,
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

const projection = {
  targetSlug: 'sefaz_ce',
  asOf: '2026-07-14',
  formulaVersion: 'sefaz-ce-projection-v2',
  scoreKind: 'raw_weighted_equivalent_not_fcc_standardized',
  interval: { confidenceBp: 9000, kind: 'normal_approximation_raw_equivalent' },
  p1: { projected: 42, low: 39, high: 45, floor: 48, stretch: 64, variance: 4 },
  p2: { projected: 55, low: 52, high: 58, floor: 63, stretch: 70, variance: 9 },
  weighted: { projected: 152, low: 143, high: 161, target: 204, distanceToTarget: 52 },
  confidenceBp: 3200,
  dominantOrigin: 'diario',
  warnings: ['Amostra representativa ainda curta.'],
  subjects: [{
    subjectProfileId: 1,
    subjectKey: 'p2_lte',
    displayName: 'Legislacao Tributaria Estadual do Ceara',
    paper: 'P2',
    questionCount: 20,
    questionWeight: 2,
    estimateBp: 7000,
    lowBp: 6200,
    highBp: 7800,
    effectiveSample: 12.5,
    confidenceBp: 3000,
    fragilityBp: 7000,
    representativeSetCount: 1,
    demotionEligible: false,
    dominantOrigin: 'diario',
    warnings: ['LTE sem transferencia de conteudo de GO.'],
  }],
};

const evidenceObservation = {
  id: 11,
  targetSlug: 'sefaz_ce',
  batchId: 'diario-backup-2026-07-14',
  subjectProfileId: 1,
  subjectKey: 'p2_lte',
  discipline: 'Legislacao Tributaria Estadual',
  topicHint: 'Agregado do bloco',
  observedOn: '2026-07-14',
  origin: 'diario',
  sourceRecordId: 'diario:task-1:block-1',
  sourceRevision: 'sha256:revision-1',
  sourceUpdatedAt: '2026-07-14T12:00:00.000000Z',
  measurementType: 'mixed_set',
  examBoard: 'FCC',
  correctCount: 7,
  wrongCount: 3,
  doubtCount: 2,
  percentageBp: 7000,
  sampleSize: 10,
  transferScope: 'content',
  transferabilityBp: 10000,
  contentHash: 'a'.repeat(64),
  provenance: { backupFileHash: 'b'.repeat(64), imported: true },
};

const cycle = {
  id: 7,
  sourceKind: 'ls',
  planLabel: 'Meta 47',
  metaNumber: 47,
  releasedAt: '2026-07-11T09:00:00.000000Z',
  startsOn: '2026-07-11',
  endsOn: '2026-07-17',
  version: 1,
};

const backlog = {
  id: 9,
  reason: 'cycle_closed_pending',
  returnScoreMilli: 1250,
  state: 'candidate',
  discoveredOn: '2026-07-18',
  recoveredOn: null,
};

const day = {
  runId: 1,
  targetSlug: 'sefaz_ce',
  date: '2026-07-14',
  daysRemaining: 18,
  modeLabel: 'Reta final tatica',
  capacity: { lsBudgetMinutes: 240, extraBudgetMinutes: 60, energyLevel: 3 },
  projections: { p1: 42, p2: 55 },
  projection,
  projectionOrigin: 'derived',
  actions: [action],
  minimumViable: { actionIds: [2], minutes: 60 },
  supersedesRunId: null,
  status: 'generated',
  algorithmVersion: 'sefaz-ce-sprint-v1',
  generatedAt: '2026-07-13T20:00:00Z',
  version: 1,
  replayed: false,
};

const executionResult = {
  execution: {
    id: 81,
    outcome: 'completed',
    performedOn: '2026-07-16',
    taskMinutes: 60,
    exerciseMinutes: 35,
    questionsTotal: 20,
    correctCount: 16,
    wrongCount: 4,
    doubtCount: 2,
    performanceBp: 8000,
    energyAfter: 3,
    notes: 'Revisão registrada no dia correto',
    recordedAt: '2026-07-17T09:00:00.000000Z',
    version: 1,
  },
  sourceTask: {
    id: 4,
    targetSlug: 'sefaz_ce',
    status: 'completed',
    spentMinutes: 60,
    performanceBp: 8000,
    provenance: { observedOn: '2026-07-16' },
  },
  sprintAction: { id: 2, state: 'completed', decision: 'accepted', version: 2 },
  calendarItem: { id: 8, state: 'completed', completedAt: '2026-07-16T12:00:00.000000Z', version: 2 },
  replayed: false,
  refreshRequired: true,
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

test('calibration parsers accept strict projection, evidence and trajectory contracts', () => {
  const evidence = { targetSlug: 'sefaz_ce', items: [evidenceObservation], unresolvedCount: 0 };
  const run = {
    runId: 1,
    date: '2026-07-14',
    p1: 42,
    p2: 55,
    projection,
    projectionOrigin: 'derived',
    confidenceBp: 3200,
    weightedProjected: 152,
    distanceToTarget: 52,
    dominantOrigin: 'diario',
    formulaVersion: 'sefaz-ce-projection-v2',
    generatedAt: '2026-07-14T12:05:00Z',
  };
  const trajectory = { targetSlug: 'sefaz_ce', latest: run, runs: [run] };

  assert.deepEqual(parseSprintProjection(projection), projection);
  assert.deepEqual(parseSprintEvidenceList(evidence), evidence);
  assert.deepEqual(parseSprintTrajectory(trajectory), trajectory);
});

test('calibration parsers reject malformed confidence and non-aggregate evidence', () => {
  assert.throws(
    () => parseSprintProjection({ ...projection, interval: { ...projection.interval, confidenceBp: 9500 } }),
    /sprint projection/i,
  );
  assert.throws(
    () => parseSprintEvidenceList({
      targetSlug: 'sefaz_ce',
      items: [{ ...evidenceObservation, measurementType: 'question_text' }],
      unresolvedCount: 0,
    }),
    /sprint evidence/i,
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
            cycleOverrunCount: 0, cycle, taskIds: [4], replayed: false,
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

test('source execution request uses the authoritative URL, payload, and idempotency key', async (context) => {
  let request: { input: string; init?: RequestInit } | undefined;
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify(executionResult), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.deepEqual(await recordSourceTaskExecution(4, {
    outcome: 'completed', performedOn: '2026-07-16', taskMinutes: 60, exerciseMinutes: 35,
    questionsTotal: 20, correctCount: 16, wrongCount: 4, doubtCount: 2,
    energyAfter: 3, notes: 'Revisão registrada no dia correto',
  }, 'execution-key'), executionResult);

  assert.equal(request?.input, '/api/v1/source-plans/tasks/4/executions');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(new Headers(request?.init?.headers).get('Idempotency-Key'), 'execution-key');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    outcome: 'completed', performedOn: '2026-07-16', taskMinutes: 60, exerciseMinutes: 35,
    questionsTotal: 20, correctCount: 16, wrongCount: 4, doubtCount: 2,
    energyAfter: 3, notes: 'Revisão registrada no dia correto',
  });
});

test('source execution parser accepts failed and skipped executions without inventing source terminal state', () => {
  assert.deepEqual(parseTaskExecutionResult(executionResult), executionResult);
  assert.deepEqual(parseTaskExecutionResult({
    ...executionResult,
    execution: { ...executionResult.execution, outcome: 'failed' },
    sourceTask: { ...executionResult.sourceTask, status: 'pending' },
    calendarItem: { ...executionResult.calendarItem, state: 'failed', completedAt: null },
  }), {
    ...executionResult,
    execution: { ...executionResult.execution, outcome: 'failed' },
    sourceTask: { ...executionResult.sourceTask, status: 'pending' },
    calendarItem: { ...executionResult.calendarItem, state: 'failed', completedAt: null },
  });
  assert.deepEqual(parseTaskExecutionResult({
    ...executionResult,
    execution: { ...executionResult.execution, outcome: 'skipped' },
    sourceTask: { ...executionResult.sourceTask, status: 'pending' },
    calendarItem: { ...executionResult.calendarItem, state: 'archived', completedAt: null },
  }), {
    ...executionResult,
    execution: { ...executionResult.execution, outcome: 'skipped' },
    sourceTask: { ...executionResult.sourceTask, status: 'pending' },
    calendarItem: { ...executionResult.calendarItem, state: 'archived', completedAt: null },
  });
});

test('source execution parser rejects malformed source and calendar terminal states', () => {
  assert.throws(
    () => parseTaskExecutionResult({
      ...executionResult,
      execution: { ...executionResult.execution, outcome: 'saved', performanceBp: 7900 },
    }),
    /task execution/i,
  );
  assert.throws(
    () => parseTaskExecutionResult({
      ...executionResult,
      sourceTask: { ...executionResult.sourceTask, status: 'saved' },
    }),
    /task execution/i,
  );
  assert.throws(
    () => parseTaskExecutionResult({
      ...executionResult,
      calendarItem: { ...executionResult.calendarItem, state: 'skipped' },
    }),
    /task execution/i,
  );
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
    cycle,
    backlog,
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

test('calibration fetchers preserve dates, includeInactive and backlog query contracts', async (context) => {
  const requests: string[] = [];
  const run = {
    runId: 1,
    date: '2026-07-14',
    p1: 42,
    p2: 55,
    projection,
    projectionOrigin: 'derived',
    confidenceBp: 3200,
    weightedProjected: 152,
    distanceToTarget: 52,
    dominantOrigin: 'diario',
    formulaVersion: 'sefaz-ce-projection-v2',
    generatedAt: '2026-07-14T12:05:00Z',
  };
  const responses = [
    projection,
    { targetSlug: 'sefaz_ce', items: [evidenceObservation], unresolvedCount: 0 },
    { targetSlug: 'sefaz_ce', latest: run, runs: [run] },
    { targetSlug: 'sefaz_ce', date: null, items: [], unresolvedCount: 0 },
    { targetSlug: 'sefaz_ce', items: [backlog] },
  ];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requests.push(String(input));
    return new Response(JSON.stringify(responses[requests.length - 1]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await fetchSprintProjection('sefaz_ce', '2026-07-14');
  await fetchSprintEvidence('sefaz_ce');
  await fetchSprintTrajectory('sefaz_ce');
  await fetchSourcePlanTasks('sefaz_ce', undefined, true);
  const listedBacklog = await fetchSourcePlanBacklog('sefaz_ce');

  assert.deepEqual(parseSourcePlanBacklogList({ targetSlug: 'sefaz_ce', items: [backlog] }), listedBacklog);
  assert.deepEqual(requests, [
    '/api/v1/sprints/projection?targetSlug=sefaz_ce&asOf=2026-07-14',
    '/api/v1/sprints/evidence?targetSlug=sefaz_ce',
    '/api/v1/sprints/trajectory?targetSlug=sefaz_ce',
    '/api/v1/source-plans/tasks?targetSlug=sefaz_ce&includeInactive=true',
    '/api/v1/source-plans/backlog?targetSlug=sefaz_ce',
  ]);
});
