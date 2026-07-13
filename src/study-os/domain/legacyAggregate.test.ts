import assert from 'node:assert/strict';
import test from 'node:test';

import type { QuestionBankItem } from '../../types';
import { buildLegacyAggregateBatchIdentity, buildLegacyAggregateImport } from './legacyAggregate';


const makeItem = (overrides: Partial<QuestionBankItem> = {}): QuestionBankItem => ({
  id: 'question-1',
  fingerprint: 'fingerprint-1',
  statement: 'Proprietary statement that must never cross the boundary',
  alternatives: [{ label: 'A', text: 'Proprietary alternative' }, { label: 'B', text: 'Another' }],
  correctAnswer: 'B',
  sourceKind: 'tec',
  sourceName: 'TEC local backup',
  targetSlug: 'bacen_economia_financas',
  discipline: 'Macroeconomia',
  lesson: 'Contas nacionais e politica macroeconomica',
  bank: 'CEBRASPE',
  tags: [],
  favorite: true,
  hasDoubt: true,
  observations: 'Private observation',
  attempts: [{ answer: 'A', isCorrect: false, attemptedAt: '2026-07-10T10:00:00Z' }],
  importedAt: '2026-07-10T09:00:00Z',
  updatedAt: '2026-07-10T10:00:00Z',
  ...overrides,
});


test('legacy aggregate groups attempts without carrying proprietary content', () => {
  const result = buildLegacyAggregateImport([
    makeItem(),
    makeItem({
      id: 'question-2',
      fingerprint: 'fingerprint-2',
      favorite: false,
      hasDoubt: false,
      attempts: [{ answer: 'B', isCorrect: true, attemptedAt: '2026-07-10T11:00:00Z' }],
    }),
  ], 'bacen_economia_financas');

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.items[0], {
    sourceItemId: result.items[0]?.sourceItemId,
    discipline: 'Macroeconomia',
    topic: 'Contas nacionais e politica macroeconomica',
    eventKind: 'questions',
    occurredAt: '2026-07-10T11:00:00.000Z',
    sourceDate: '2026-07-10',
    questionsDone: 2,
    correctCount: 1,
    wrongCount: 1,
    doubtCount: 1,
    favoriteCount: 1,
  });
  const serialized = JSON.stringify(result.items).toLowerCase();
  for (const forbidden of ['statement', 'alternative', 'answer', 'observation', 'private']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});


test('legacy aggregate rejects ambiguous target or missing topic locally', () => {
  const result = buildLegacyAggregateImport([
    makeItem({ id: 'other-target', targetSlug: 'rfb_auditor' }),
    makeItem({ id: 'missing-topic', lesson: undefined, taskTitle: undefined }),
  ], 'bacen_economia_financas');

  assert.equal(result.items.length, 0);
  assert.deepEqual(result.rejected.map((item) => item.code), [
    'target_mismatch',
    'topic_missing',
  ]);
});


test('legacy aggregate source identities are deterministic', () => {
  const items = [makeItem()];
  assert.equal(
    buildLegacyAggregateImport(items, 'bacen_economia_financas').items[0]?.sourceItemId,
    buildLegacyAggregateImport(items, 'bacen_economia_financas').items[0]?.sourceItemId,
  );
});

test('aggregate batch identity is stable for one source snapshot and changes for a new day', () => {
  const first = buildLegacyAggregateImport([makeItem()], 'bacen_economia_financas');
  const same = buildLegacyAggregateImport([makeItem()], 'bacen_economia_financas');
  const changedCounts = buildLegacyAggregateImport([
    makeItem({
      attempts: [
        { answer: 'A', isCorrect: false, attemptedAt: '2026-07-10T10:00:00Z' },
        { answer: 'B', isCorrect: true, attemptedAt: '2026-07-10T11:00:00Z' },
      ],
    }),
  ], 'bacen_economia_financas');
  const newDay = buildLegacyAggregateImport([
    makeItem({
      attempts: [{ answer: 'B', isCorrect: true, attemptedAt: '2026-07-11T11:00:00Z' }],
    }),
  ], 'bacen_economia_financas');

  assert.equal(
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', first.items),
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', same.items),
  );
  assert.equal(
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', first.items),
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', changedCounts.items),
  );
  assert.notEqual(
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', first.items),
    buildLegacyAggregateBatchIdentity('bacen_economia_financas', newDay.items),
  );
});
