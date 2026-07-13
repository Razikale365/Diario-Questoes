import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deferReviewItem,
  fetchReviewQueue,
  importLearningAggregates,
  parseLearningImportReport,
  parseReviewQueue,
  rebuildReviewQueue,
} from './learning';


const reviewItem = {
  id: 1,
  targetSlug: 'bacen_economia_financas',
  topicTargetSlug: 'bacen_economia_financas',
  targetTopicId: 11,
  dueDate: '2026-07-13',
  state: 'pending',
  boundedQuestions: 8,
  triggerEventIds: [1, 2],
  reason: 'recent_errors',
  debtBp: 4800,
  attemptCount: 0,
  resolvedEventId: null,
  version: 1,
  createdAt: '2026-07-13T12:00:00Z',
  updatedAt: '2026-07-13T12:00:00Z',
} as const;

const report = {
  targetSlug: 'bacen_economia_financas',
  batchId: 'batch-1',
  importedCount: 1,
  rejectedCount: 1,
  rejected: [{ sourceItemId: 'missing', code: 'topic_unmapped', message: 'No exact topic' }],
} as const;

const jsonResponse = (value: unknown, status = 200) => new Response(
  JSON.stringify(value),
  { status, headers: { 'Content-Type': 'application/json' } },
);

test('learning parsers accept strict queue and import reports', () => {
  assert.deepEqual(parseReviewQueue({ items: [reviewItem] }).items[0], reviewItem);
  assert.deepEqual(parseLearningImportReport(report), report);
  assert.throws(
    () => parseReviewQueue({ items: [{ ...reviewItem, boundedQuestions: 20 }] }),
    /review/i,
  );
  assert.throws(
    () => parseLearningImportReport({ ...report, importedCount: -1 }),
    /import/i,
  );
});

test('learning and review requests use exact URLs, keys, and aggregate-only bodies', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse({ items: [reviewItem] }),
    jsonResponse({ items: [reviewItem] }),
    jsonResponse({ ...reviewItem, state: 'deferred', dueDate: '2026-07-16', version: 2 }),
    jsonResponse(report),
  ];
  context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return responses.shift() ?? jsonResponse({}, 500);
  });
  const aggregate = {
    sourceItemId: 'group-1',
    discipline: 'Macroeconomia',
    topic: 'Contas nacionais',
    eventKind: 'questions' as const,
    occurredAt: '2026-07-10T12:00:00Z',
    sourceDate: '2026-07-10',
    questionsDone: 20,
    correctCount: 15,
    wrongCount: 5,
    doubtCount: 1,
    favoriteCount: 0,
  };

  await fetchReviewQueue('bacen_economia_financas', '2026-07-13');
  await rebuildReviewQueue({ targetSlug: 'bacen_economia_financas', asOf: '2026-07-13' }, 'rebuild-1');
  await deferReviewItem(1, { dueDate: '2026-07-16', expectedVersion: 1 }, 'defer-1');
  await importLearningAggregates({
    targetSlug: 'bacen_economia_financas',
    batchId: 'batch-1',
    items: [aggregate],
  }, 'import-1');

  assert.equal(requests[0]?.input, '/api/v1/review/queue?targetSlug=bacen_economia_financas&asOf=2026-07-13');
  assert.equal(new Headers(requests[1]?.init?.headers).get('Idempotency-Key'), 'rebuild-1');
  assert.equal(new Headers(requests[2]?.init?.headers).get('Idempotency-Key'), 'defer-1');
  assert.equal(new Headers(requests[3]?.init?.headers).get('Idempotency-Key'), 'import-1');
  const body = String(requests[3]?.init?.body).toLowerCase();
  assert.equal(body.includes('statement'), false);
  assert.equal(body.includes('alternative'), false);
  assert.deepEqual(JSON.parse(body), {
    targetslug: 'bacen_economia_financas',
    batchid: 'batch-1',
    items: [{
      sourceitemid: 'group-1',
      discipline: 'macroeconomia',
      topic: 'contas nacionais',
      eventkind: 'questions',
      occurredat: '2026-07-10t12:00:00z',
      sourcedate: '2026-07-10',
      questionsdone: 20,
      correctcount: 15,
      wrongcount: 5,
      doubtcount: 1,
      favoritecount: 0,
    }],
  });
});
