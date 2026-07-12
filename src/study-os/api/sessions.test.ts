import assert from 'node:assert/strict';
import test from 'node:test';

import { StudyOsApiError } from './client';
import {
  checkpointStudySession,
  fetchActiveStudySession,
  fetchProgress,
  fetchReadingRates,
  finishStudySession,
  inspectMaterial,
  parseMaterialInspection,
  parseProgressState,
  parseReadingRateList,
  parseSessionResult,
  parseSessionStart,
  parseStudySession,
  skipStudySession,
  startStudySession,
} from './sessions';

const progress = {
  id: 51,
  lessonId: 21,
  materialId: 41,
  status: 'in_progress',
  cursorPage: 18,
  furthestPage: 18,
  completedAt: null,
  lastSeenAt: '2026-07-12T10:00:00+00:00',
  confidence: 0.3,
  totalSeconds: 1200,
  sessionCount: 1,
  version: 3,
} as const;

const session = {
  id: 61,
  idempotencyKey: 'start-61',
  targetSlug: 'rfb_auditor',
  lessonId: 21,
  materialId: 41,
  state: 'active',
  startedAt: '2026-07-12T09:40:00+00:00',
  endedAt: null,
  elapsedSeconds: 1200,
  startPage: 1,
  endPage: 18,
  questionsDone: 0,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  favoriteCount: 0,
  outcome: null,
  skipReason: null,
  notes: '',
  version: 2,
} as const;

const sessionStart = {
  session,
  progress,
  openUrl: '/api/v1/materials/41/file?targetSlug=rfb_auditor#page=18',
};

const sessionResult = { session, progress };

const jsonResponse = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'Content-Type': 'application/json' } },
);

test('session parsers accept complete service DTOs', () => {
  assert.deepEqual(parseProgressState(progress), progress);
  assert.deepEqual(parseStudySession(session), session);
  assert.deepEqual(parseSessionStart(sessionStart), sessionStart);
  assert.deepEqual(parseSessionResult(sessionResult), sessionResult);
  assert.deepEqual(parseMaterialInspection({
    materialId: 41,
    pageCount: 120,
    pageOffset: 0,
  }), {
    materialId: 41,
    pageCount: 120,
    pageOffset: 0,
  });
  assert.deepEqual(parseReadingRateList({ items: [{
    materialId: 41,
    pagesPerHour: 18.5,
    sampleCount: 3,
    totalSeconds: 7200,
    source: 'observed',
  }] }).items[0], {
    materialId: 41,
    pagesPerHour: 18.5,
    sampleCount: 3,
    totalSeconds: 7200,
    source: 'observed',
  });
});

test('session parsers reject malformed nested state, enums, and versions', () => {
  assert.throws(
    () => parseProgressState({ ...progress, status: 'done' }),
    /progress/i,
  );
  assert.throws(
    () => parseProgressState({ ...progress, completedAt: 42 }),
    /progress/i,
  );
  assert.throws(
    () => parseStudySession({ ...session, outcome: 'mystery' }),
    /session/i,
  );
  assert.throws(
    () => parseStudySession({ ...session, version: 0 }),
    /session/i,
  );
  assert.throws(
    () => parseSessionStart({ ...sessionStart, progress: { ...progress, confidence: 2 } }),
    /progress/i,
  );
  assert.throws(
    () => parseMaterialInspection({ materialId: 41, pageCount: null, pageOffset: 0 }),
    /material inspection/i,
  );
  assert.throws(
    () => parseReadingRateList({ items: [{ materialId: 41, source: 'guessed' }] }),
    /reading rate/i,
  );
});

test('progress, inspection, active session, and rates use target-scoped URLs', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse(progress),
    jsonResponse({ materialId: 41, pageCount: 120, pageOffset: 0 }),
    jsonResponse(session),
    jsonResponse({ items: [{
      materialId: 41,
      pagesPerHour: 20,
      sampleCount: 0,
      totalSeconds: 0,
      source: 'default',
    }] }),
  ];
  context.mock.method(globalThis, 'fetch', async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requests.push({ input: String(input), init });
    return responses.shift() ?? jsonResponse({}, 500);
  });

  await fetchProgress('rfb_auditor', 21, 41);
  await inspectMaterial(41, 'rfb_auditor');
  await fetchActiveStudySession('rfb_auditor', 21, 41);
  await fetchReadingRates('rfb_auditor');

  assert.deepEqual(requests.map(({ input }) => input), [
    '/api/v1/progress?targetSlug=rfb_auditor&lessonId=21&materialId=41',
    '/api/v1/materials/41/inspect?targetSlug=rfb_auditor',
    '/api/v1/sessions/active?targetSlug=rfb_auditor&lessonId=21&materialId=41',
    '/api/v1/reading-rates?targetSlug=rfb_auditor',
  ]);
  assert.equal(requests[1]?.init?.method, 'POST');
});

test('start sends exact body and idempotency header', async (context) => {
  let request: { input: string; init?: RequestInit } | undefined;
  context.mock.method(globalThis, 'fetch', async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    request = { input: String(input), init };
    return jsonResponse(sessionStart, 201);
  });

  const result = await startStudySession({
    targetSlug: 'rfb_auditor',
    lessonId: 21,
    materialId: 41,
    plannerBlockId: 71,
  }, 'start-61');

  assert.deepEqual(result, sessionStart);
  assert.equal(request?.input, '/api/v1/sessions');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(new Headers(request?.init?.headers).get('Idempotency-Key'), 'start-61');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    targetSlug: 'rfb_auditor',
    lessonId: 21,
    materialId: 41,
    plannerBlockId: 71,
  });
});

test('checkpoint, finish, and skip send optimistic versions and exact payloads', async (context) => {
  const requests: RequestInit[] = [];
  context.mock.method(globalThis, 'fetch', async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requests.push(init ?? {});
    return jsonResponse(sessionResult);
  });

  await checkpointStudySession(61, {
    endPage: 18,
    elapsedSeconds: 1200,
    expectedVersion: 2,
  });
  await finishStudySession(61, {
    outcome: 'partial',
    endPage: 18,
    elapsedSeconds: 1200,
    questionsDone: 0,
    correctCount: 0,
    wrongCount: 0,
    doubtCount: 0,
    favoriteCount: 0,
    notes: 'intervalo',
    expectedVersion: 2,
  });
  await skipStudySession(61, {
    reason: 'lack_of_time',
    notes: '',
    expectedVersion: 2,
  });

  assert.equal(requests[0]?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
    endPage: 18,
    elapsedSeconds: 1200,
    expectedVersion: 2,
  });
  assert.equal(requests[1]?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[1]?.body)), {
    outcome: 'partial',
    endPage: 18,
    elapsedSeconds: 1200,
    questionsDone: 0,
    correctCount: 0,
    wrongCount: 0,
    doubtCount: 0,
    favoriteCount: 0,
    notes: 'intervalo',
    expectedVersion: 2,
  });
  assert.equal(requests[2]?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[2]?.body)), {
    reason: 'lack_of_time',
    notes: '',
    expectedVersion: 2,
  });
});

test('structured session conflicts remain StudyOsApiError instances', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => jsonResponse({
    code: 'session_conflict',
    message: 'session changed before checkpoint',
  }, 409));

  await assert.rejects(
    checkpointStudySession(61, {
      endPage: 19,
      elapsedSeconds: 1300,
      expectedVersion: 1,
    }),
    (error: unknown) => error instanceof StudyOsApiError
      && error.status === 409
      && error.code === 'session_conflict',
  );
});
