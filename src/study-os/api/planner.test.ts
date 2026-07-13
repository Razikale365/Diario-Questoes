import assert from 'node:assert/strict';
import test from 'node:test';

import { StudyOsApiError } from './client';
import {
  fetchPlannerDay,
  fetchPlannerScoreboard,
  fetchPlannerTargets,
  fetchTargetTopics,
  generatePlannerDay,
  parsePlannerDay,
  parsePlannerScoreboard,
  parsePlannerSourceChoice,
  parsePlannerTargetList,
  parseTargetTopicList,
  refreshPlannerDay,
  fetchPlannerWeek,
  generatePlannerWeek,
  parsePlannerWeek,
  refreshPlannerWeek,
  seedPlannerTargets,
  submitPlannerBlockResult,
  updatePlannerTarget,
  updateTargetTopics,
} from './planner';


const target = {
  targetSlug: 'bacen_economia_financas',
  displayName: 'BACEN Economia e Financas',
  institution: 'Banco Central do Brasil',
  role: 'Analista',
  banca: 'CEBRASPE',
  phase: 'pre_edital',
  deadline: null,
  dailyQuota: 4,
  priorityScore: 88,
  sourceUrls: ['https://www.bcb.gov.br/'],
  notes: '',
  active: true,
  version: 1,
} as const;

const topic = {
  id: 11,
  targetSlug: 'bacen_economia_financas',
  discipline: 'Macroeconomia',
  topic: 'Politica monetaria',
  coverageStatus: 'weak',
  editalWeight: 2,
  incidence: 92,
  tier: 1,
  bancaFit: 95,
  overlapValue: 100,
  transferKind: 'target_specific',
  sourceKind: 'manual',
  lessonId: 7,
  materialId: 13,
  tecSourceUrl: 'https://www.tecconcursos.com.br/questoes/cadernos',
  tecSourceId: 'macro',
  plannedQuestions: 20,
  reviewDebt: 70,
  notes: '',
  active: true,
  version: 2,
} as const;

const scoreBreakdown = {
  weakness: 9000,
  incidence: 9200,
  tier: 10000,
  coverageNeed: 7000,
  reviewDebt: 7000,
  lsAlignment: 0,
  targetFit: 10000,
  overlapValue: 10000,
  deadlinePressure: 0,
  bancaFit: 9500,
  editalWeight: 2000,
  balancePenalty: 0,
  lowTrustPenalty: 0,
  weeklyAlignment: 0,
  finalScore: 98500,
} as const;

const evidence = {
  candidateEvidence: {
    targetTopicId: 11,
    selectedTargetSlug: 'bacen_economia_financas',
    sourceTargetSlug: 'bacen_economia_financas',
    transferKind: 'target_specific',
    transferConfidence: 100,
    coverageStatus: 'weak',
    incidence: 92,
    tier: 1,
    bancaFit: 95,
    overlapValue: 100,
    editalWeight: 2,
    profileSourceKind: 'manual',
    materialMappingPresent: true,
    lessonId: 7,
    materialId: 13,
    materialKind: 'original',
    materialTrust: 10,
    progressStatus: 'weak',
    cursorPage: 18,
    pageCount: 100,
    tecSourceUrl: 'https://www.tecconcursos.com.br/questoes/cadernos',
    tecSourceId: 'macro',
    wrongCount: 4,
    doubtCount: 2,
    favoriteCount: 1,
    failedSessions: 0,
    skippedBlocks: 0,
    weakProgress: true,
    reviewDebt: 70,
    stopReason: null,
  },
  scoreEvidence: {
    algorithmVersion: 'm4-v1',
    inputHash: 'a'.repeat(64),
    candidateKey: 'candidate-abc',
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    components: scoreBreakdown,
    weightsMilli: { weakness: 3000 },
    penaltyWeightsMilli: { low_trust_penalty: 3000 },
  },
} as const;

const candidate = {
  id: 31,
  runId: 21,
  candidateKey: 'candidate-abc',
  targetSlug: 'bacen_economia_financas',
  discipline: 'Macroeconomia',
  topic: 'Politica monetaria',
  blockKind: 'theory',
  sourceKind: 'course',
  targetTopicId: 11,
  lessonId: 7,
  materialId: 13,
  durationMinutes: 60,
  plannedQuestions: 0,
  scoreBreakdown,
  chosenPosition: 1,
  displacedBy: null,
  stopReason: null,
  evidence,
  adaptationReason: 'profile_fallback',
} as const;

const block = {
  id: 41,
  runId: 21,
  candidateId: 31,
  targetSlug: 'bacen_economia_financas',
  date: '2026-07-13',
  position: 1,
  blockKind: 'theory',
  title: 'Ler ou reler: Macroeconomia - Politica monetaria',
  durationMinutes: 60,
  plannedQuestions: 0,
  state: 'pending',
  executionSessionId: null,
  questionsDone: 0,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  favoriteCount: 0,
  version: 1,
  discipline: 'Macroeconomia',
  topic: 'Politica monetaria',
  sourceKind: 'course',
  lessonId: 7,
  materialId: 13,
  scoreBreakdown,
  evidence,
  adaptationReason: 'profile_fallback',
} as const;

const week = {
  run: {
    id: 51,
    targetSlug: 'bacen_economia_financas',
    weekStart: '2026-07-13',
    phase: 'pre_edital',
    algorithmVersion: 'm5-week-v1',
    requestHash: 'c'.repeat(64),
    inputHash: 'd'.repeat(64),
    supersedesWeekRunId: null,
    status: 'shortfall',
    shortfallCount: 1,
    shortfallReasons: ['2026-07-14: no unique executable review candidate'],
    generatedAt: '2026-07-13T10:00:00Z',
  },
  slots: [{
    id: 61,
    weekRunId: 51,
    targetSlug: 'bacen_economia_financas',
    date: '2026-07-13',
    position: 1,
    candidateKey: 'candidate-abc',
    topicTargetSlug: 'bacen_economia_financas',
    targetTopicId: 11,
    blockKind: 'theory',
    durationMinutes: 60,
    plannedQuestions: 0,
    score: scoreBreakdown,
    evidence: { discipline: 'Macroeconomia', topic: 'Politica monetaria', adaptationReason: 'profile_fallback', candidateEvidence: evidence.candidateEvidence },
    state: 'forecast',
    dayRunId: null,
    dayBlockId: null,
  }],
} as const;

const run = {
  id: 21,
  targetSlug: 'bacen_economia_financas',
  date: '2026-07-13',
  phase: 'pre_edital',
  dailyQuota: 4,
  timeBudgetMinutes: 240,
  algorithmVersion: 'm4-v1',
  inputHash: 'b'.repeat(64),
  supersedesRunId: null,
  status: 'shortfall',
  shortfallCount: 3,
  shortfallReasons: ['no executable questions candidate', 'missing', 'missing'],
  generatedAt: '2026-07-13T10:00:00+00:00',
} as const;

const day = { run, blocks: [block], scoreboard: [candidate] } as const;

const sourceChoiceEvidence = {
  algorithmVersion: 'm6-source-choice-v2',
  sourceId: 81,
  sourceItemId: 82,
  sourceKind: 'course',
  displayName: 'Curso regular 2026',
  contentRole: 'primary_theory',
  sourceTargetSlug: 'bacen_economia_financas',
  targetFitBp: 10000,
  transferConfidenceBp: 10000,
  trustBp: 10000,
  freshnessBp: 10000,
  orderReadinessBp: 7500,
  strategyAlignmentBp: 10000,
  materialAvailabilityBp: 10000,
  lowTrustPenaltyBp: 0,
  mismatchPenaltyBp: 0,
  incidenceBp: 9200,
  banca: 'CEBRASPE',
  targetBanca: 'CEBRASPE',
  bancaFitBp: 10000,
  choiceContext: { coverageStatus: 'weak' },
  edition: '2026',
  lessonId: 7,
  materialId: 13,
  materialKind: 'original',
  externalUrl: null,
  externalId: null,
  mappingStatus: 'approved',
  mappingConfidenceBp: 10000,
  primaryEligible: true,
  manualOverride: false,
  transferKind: 'target_specific',
  stopReason: null,
  finalScore: 111200,
} as const;

const sourceChoice = {
  status: 'chosen',
  choiceRunId: 91,
  choiceRowId: 92,
  sourceItemId: 82,
  sourceKind: 'course',
  displayName: 'Curso regular 2026',
  contentRole: 'primary_theory',
  sourceTargetSlug: 'bacen_economia_financas',
  lessonId: 7,
  materialId: 13,
  externalUrl: null,
  externalId: null,
  finalScore: 111200,
  evidence: sourceChoiceEvidence,
  alternatives: [{
    choiceRowId: 92,
    sourceItemId: 82,
    chosen: true,
    displacedByRowId: null,
    stopReason: null,
    finalScore: 111200,
    evidence: sourceChoiceEvidence,
  }],
} as const;

const jsonResponse = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'Content-Type': 'application/json' } },
);

test('planner parsers accept complete target, topic, day, and scoreboard DTOs', () => {
  assert.deepEqual(parsePlannerTargetList({ items: [target] }).items[0], target);
  assert.deepEqual(parseTargetTopicList({ items: [topic] }).items[0], topic);
  assert.deepEqual(parsePlannerDay(day), day);
  assert.deepEqual(parsePlannerScoreboard({ items: [candidate] }).items[0], candidate);
  assert.deepEqual(parsePlannerWeek(week), week);
});

test('planner parser preserves auditable source choice evidence', () => {
  assert.deepEqual(parsePlannerSourceChoice(sourceChoice), sourceChoice);
  assert.throws(
    () => parsePlannerSourceChoice({
      ...sourceChoice,
      evidence: { ...sourceChoiceEvidence, trustBp: 10001 },
    }),
    /source choice evidence/i,
  );
});

test('week generation, lookup, and refresh requests are exact', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const refreshedWeek = {
    ...week,
    run: { ...week.run, id: 52, supersedesWeekRunId: 51 },
    slots: week.slots.map((slot) => ({ ...slot, weekRunId: 52 })),
  };
  const responses = [jsonResponse(week, 201), jsonResponse(week), jsonResponse(refreshedWeek, 201)];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return responses.shift() ?? jsonResponse({}, 500);
  });

  await generatePlannerWeek({
    targetSlug: 'bacen_economia_financas',
    weekStart: '2026-07-13',
    dailyQuotas: { '2026-07-13': 2 },
  }, 'week-1');
  await fetchPlannerWeek('bacen_economia_financas', '2026-07-13');
  await refreshPlannerWeek({
    previousWeekRunId: 51,
    targetSlug: 'bacen_economia_financas',
    weekStart: '2026-07-13',
  }, 'week-2');

  assert.equal(requests[0]?.input, '/api/v1/planner/generate-week');
  assert.equal(new Headers(requests[0]?.init?.headers).get('Idempotency-Key'), 'week-1');
  assert.equal(requests[1]?.input, '/api/v1/planner/week?targetSlug=bacen_economia_financas&weekStart=2026-07-13');
  assert.equal(requests[2]?.input, '/api/v1/planner/refresh-week');
  assert.equal(new Headers(requests[2]?.init?.headers).get('Idempotency-Key'), 'week-2');
});

test('planner parsers reject malformed nested scores, evidence, and shortfalls', () => {
  assert.throws(
    () => parsePlannerDay({ ...day, blocks: [{ ...block, scoreBreakdown: { ...scoreBreakdown, weakness: -1 } }] }),
    /score/i,
  );
  assert.throws(
    () => parsePlannerScoreboard({ items: [{ ...candidate, evidence: { scoreEvidence: {} } }] }),
    /evidence/i,
  );
  assert.throws(
    () => parsePlannerDay({ ...day, run: { ...run, shortfallCount: 2 } }),
    /run/i,
  );
  assert.throws(
    () => parseTargetTopicList({ items: [{ ...topic, coverageStatus: 'done' }] }),
    /topic/i,
  );
});

test('planner profile requests use target-scoped URLs and exact edit bodies', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({ items: [target] }),
    jsonResponse({ items: [topic] }),
    jsonResponse({ targetsSeeded: 1, topicsSeeded: 6, targetSlugs: ['bacen_economia_financas'] }, 201),
    jsonResponse({ ...target, dailyQuota: 5, version: 2 }),
    jsonResponse({ items: [{ ...topic, reviewDebt: 80, version: 3 }] }),
  ];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return responses.shift() ?? jsonResponse({}, 500);
  });

  await fetchPlannerTargets();
  await fetchTargetTopics('bacen_economia_financas');
  await seedPlannerTargets(['bacen_economia_financas']);
  await updatePlannerTarget({ targetSlug: 'bacen_economia_financas', dailyQuota: 5, expectedVersion: 1 });
  await updateTargetTopics('bacen_economia_financas', [{ id: 11, reviewDebt: 80, expectedVersion: 2 }]);

  assert.deepEqual(requests.map(({ input }) => input), [
    '/api/v1/planner/targets',
    '/api/v1/planner/topics?targetSlug=bacen_economia_financas',
    '/api/v1/planner/targets/seed',
    '/api/v1/planner/targets',
    '/api/v1/planner/topics?targetSlug=bacen_economia_financas',
  ]);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), { targetSlugs: ['bacen_economia_financas'] });
  assert.deepEqual(JSON.parse(String(requests[4]?.init?.body)), {
    items: [{ id: 11, reviewDebt: 80, expectedVersion: 2 }],
  });
});

test('day generation, lookup, scoreboard, refresh, and result requests are exact', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const finishedBlock = { ...block, state: 'completed', questionsDone: 0, version: 2 } as const;
  const refreshed = {
    ...day,
    run: { ...run, id: 22, supersedesRunId: 21 },
    blocks: [{ ...block, runId: 22 }],
    scoreboard: [{ ...candidate, runId: 22 }],
  } as const;
  const responses = [
    jsonResponse(day, 201),
    jsonResponse(day),
    jsonResponse({ items: [candidate] }),
    jsonResponse(refreshed, 201),
    jsonResponse(finishedBlock),
  ];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return responses.shift() ?? jsonResponse({}, 500);
  });

  await generatePlannerDay({ targetSlug: 'bacen_economia_financas', date: '2026-07-13', timeBudgetMinutes: 240 }, 'generate-21');
  await fetchPlannerDay('bacen_economia_financas', '2026-07-13');
  await fetchPlannerScoreboard(21);
  await refreshPlannerDay({ previousRunId: 21, targetSlug: 'bacen_economia_financas', date: '2026-07-14' }, 'refresh-22');
  await submitPlannerBlockResult(41, {
    state: 'completed',
    questionsDone: 0,
    correctCount: 0,
    wrongCount: 0,
    doubtCount: 0,
    favoriteCount: 0,
    expectedVersion: 1,
  });

  assert.equal(new Headers(requests[0]?.init?.headers).get('Idempotency-Key'), 'generate-21');
  assert.equal(requests[1]?.input, '/api/v1/planner/day?targetSlug=bacen_economia_financas&date=2026-07-13');
  assert.equal(requests[2]?.input, '/api/v1/planner/scoreboard?runId=21');
  assert.equal(new Headers(requests[3]?.init?.headers).get('Idempotency-Key'), 'refresh-22');
  assert.equal(requests[4]?.input, '/api/v1/planner/blocks/41/result');
  assert.deepEqual(JSON.parse(String(requests[4]?.init?.body)), {
    state: 'completed',
    questionsDone: 0,
    correctCount: 0,
    wrongCount: 0,
    doubtCount: 0,
    favoriteCount: 0,
    expectedVersion: 1,
  });
});

test('structured planner conflicts remain StudyOsApiError instances', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse({
    code: 'stale_planner_block',
    message: 'planner block changed',
  }, 409));

  await assert.rejects(
    submitPlannerBlockResult(41, {
      state: 'skipped',
      questionsDone: 0,
      correctCount: 0,
      wrongCount: 0,
      doubtCount: 0,
      favoriteCount: 0,
      expectedVersion: 1,
    }),
    (error: unknown) => error instanceof StudyOsApiError
      && error.status === 409
      && error.code === 'stale_planner_block',
  );
});
