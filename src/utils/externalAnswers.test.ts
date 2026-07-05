import test from 'node:test';
import assert from 'node:assert/strict';

import { QuestionBankItem } from '../types';
import {
  applyExternalAnswerAttempts,
  findExternalAnswerBatch,
  getNextExternalAnswerNumber,
  getExternalAnswerDraftLabel,
  getQuickCaptureShortcutAnswer,
  buildTecSidecarWindowFeatures,
  getTecSidecarUrl,
  isEditableShortcutTarget,
  parseExternalAnswerDraft,
  parseExternalAnswerBatchHistory,
  parseExternalAnswerText,
  recordExternalAnswerBatch,
  removeExternalAnswerBatch,
  removeLatestExternalAnswerTextEntry,
  selectExternalAnswerReviewItems,
  upsertExternalAnswerText,
} from './externalAnswers';

const makeItem = (id: string, sourceQuestionNumber: number | undefined, correctAnswer?: string): QuestionBankItem => ({
  id,
  fingerprint: id,
  sourceQuestionNumber,
  statement: `Questao ${sourceQuestionNumber || id}`,
  alternatives: [
    { label: 'A', text: 'Alternativa A' },
    { label: 'B', text: 'Alternativa B' },
    { label: 'C', text: 'Alternativa C' },
    { label: 'D', text: 'Alternativa D' },
    { label: 'E', text: 'Alternativa E' },
  ],
  correctAnswer,
  isMultipleChoice: true,
  sourceKind: 'tec',
  sourceName: 'Caderno TEC',
  discipline: 'Direito Constitucional',
  lesson: 'Controle de Constitucionalidade',
  taskTitle: 'Rodada TEC',
  bank: 'CEBRASPE',
  tags: [],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-03T12:00:00.000Z',
  updatedAt: '2026-07-03T12:00:00.000Z',
});

test('parseExternalAnswerText captures common TEC-style answer logs', () => {
  const result = parseExternalAnswerText(`
Questao 1: C
2 - errado
Q3) A
04 Certo
5 anulada
linha qualquer
`);

  assert.deepEqual(
    result.entries.map((entry) => ({ number: entry.number, answer: entry.answer })),
    [
      { number: 1, answer: 'C' },
      { number: 2, answer: 'E' },
      { number: 3, answer: 'A' },
      { number: 4, answer: 'C' },
      { number: 5, answer: 'ANULADA' },
    ],
  );
  assert.deepEqual(result.ignoredLines, ['linha qualquer']);
});

test('upsertExternalAnswerText adds and replaces quick captured answers without duplicates', () => {
  const firstCapture = upsertExternalAnswerText('', 1, 'Certo');
  const withSecond = upsertExternalAnswerText(firstCapture, 2, 'Errado');
  const corrected = upsertExternalAnswerText(`${withSecond}\nobservacao solta\n2 C`, 2, 'B');

  assert.equal(corrected, '1 Certo\n2 B\nobservacao solta');
  assert.deepEqual(parseExternalAnswerText(corrected).duplicateNumbers, []);
  assert.deepEqual(
    parseExternalAnswerText(corrected).entries.map((entry) => ({ number: entry.number, answer: entry.answer })),
    [
      { number: 1, answer: 'C' },
      { number: 2, answer: 'B' },
    ],
  );
});

test('getNextExternalAnswerNumber suggests the next question after quick captured answers', () => {
  assert.equal(getNextExternalAnswerNumber(''), 1);
  assert.equal(getNextExternalAnswerNumber('linha ignorada\n1 A\n4 Errado'), 5);
});

test('removeLatestExternalAnswerTextEntry removes the last parseable captured answer', () => {
  const result = removeLatestExternalAnswerTextEntry('1 Certo\nobservacao solta\n2 B\nnota final');

  assert.deepEqual(result.removed, { number: 2, answer: 'B', raw: '2 B' });
  assert.equal(result.text, '1 Certo\nobservacao solta\nnota final');
});

test('removeLatestExternalAnswerTextEntry is unchanged when no captured answer exists', () => {
  const result = removeLatestExternalAnswerTextEntry('observacao solta\nsem resposta');

  assert.equal(result.removed, null);
  assert.equal(result.text, 'observacao solta\nsem resposta');
});

test('getQuickCaptureShortcutAnswer maps keyboard shortcuts without making C ambiguous', () => {
  assert.equal(getQuickCaptureShortcutAnswer('a'), 'A');
  assert.equal(getQuickCaptureShortcutAnswer('C'), 'C');
  assert.equal(getQuickCaptureShortcutAnswer('5'), 'E');
  assert.equal(getQuickCaptureShortcutAnswer('z'), 'Certo');
  assert.equal(getQuickCaptureShortcutAnswer('X'), 'Errado');
  assert.equal(getQuickCaptureShortcutAnswer('Enter'), null);
});

test('isEditableShortcutTarget avoids capturing while typing in editable fields', () => {
  assert.equal(isEditableShortcutTarget('input'), true);
  assert.equal(isEditableShortcutTarget('TEXTAREA'), true);
  assert.equal(isEditableShortcutTarget('select'), true);
  assert.equal(isEditableShortcutTarget('div', true), true);
  assert.equal(isEditableShortcutTarget('button'), false);
  assert.equal(isEditableShortcutTarget(null), false);
});

test('getTecSidecarUrl normalizes safe http urls and rejects unsafe protocols', () => {
  assert.equal(
    getTecSidecarUrl(' www.tecconcursos.com.br/questoes/cadernos/123 '),
    'https://www.tecconcursos.com.br/questoes/cadernos/123',
  );
  assert.equal(getTecSidecarUrl('https://www.tecconcursos.com.br/questoes/cadernos?filtro=1'), 'https://www.tecconcursos.com.br/questoes/cadernos?filtro=1');
  assert.equal(getTecSidecarUrl('javascript:alert(1)'), 'https://www.tecconcursos.com.br/questoes/cadernos');
  assert.equal(getTecSidecarUrl(''), 'https://www.tecconcursos.com.br/questoes/cadernos');
});

test('buildTecSidecarWindowFeatures creates a reusable popup feature string', () => {
  const features = buildTecSidecarWindowFeatures({ width: 400, height: 4000, left: -20, top: 90.8 });

  assert.match(features, /popup=yes/);
  assert.match(features, /width=720/);
  assert.match(features, /height=1200/);
  assert.match(features, /left=0/);
  assert.match(features, /top=90/);
  assert.doesNotMatch(features, /noopener|noreferrer/);
});

test('parseExternalAnswerDraft restores a valid quick capture draft', () => {
  const parsed = parseExternalAnswerDraft(JSON.stringify({
    text: '1 A\n2 Certo',
    quickNumber: 3,
    updatedAt: '2026-07-03T17:00:00.000Z',
  }));

  assert.deepEqual(parsed, {
    text: '1 A\n2 Certo',
    quickNumber: 3,
    updatedAt: '2026-07-03T17:00:00.000Z',
  });
});

test('parseExternalAnswerDraft falls back to the next parsed question number', () => {
  const parsed = parseExternalAnswerDraft(JSON.stringify({
    text: '1 A\n4 Errado',
    quickNumber: 0,
    updatedAt: '',
  }));

  assert.deepEqual(parsed, {
    text: '1 A\n4 Errado',
    quickNumber: 5,
    updatedAt: undefined,
  });
});

test('parseExternalAnswerDraft rejects invalid or empty draft payloads', () => {
  assert.equal(parseExternalAnswerDraft('nao-json'), null);
  assert.equal(parseExternalAnswerDraft(JSON.stringify({ text: '', quickNumber: 5 })), null);
  assert.equal(parseExternalAnswerDraft(JSON.stringify({ text: 123, quickNumber: 5 })), null);
});

test('getExternalAnswerDraftLabel formats draft save status defensively', () => {
  assert.equal(getExternalAnswerDraftLabel(undefined), 'Rascunho salvo');
  assert.equal(getExternalAnswerDraftLabel('data-invalida'), 'Rascunho salvo');
  assert.match(getExternalAnswerDraftLabel('2026-07-03T17:45:00.000Z'), /^Rascunho salvo \d{2}:\d{2}$/);
});

test('applyExternalAnswerAttempts records attempts on filtered bank items by source number', () => {
  const first = makeItem('qb_10', 10, 'C');
  const second = makeItem('qb_11', 11, 'E');
  const outsideFilter = makeItem('qb_12', 12, 'A');
  const parsed = parseExternalAnswerText('10 C\n11 C\n12 A\n99 B');

  const result = applyExternalAnswerAttempts(
    [first, second, outsideFilter],
    [first, second],
    parsed.entries,
    '2026-07-03T15:00:00.000Z',
  );

  assert.equal(result.applied, 2);
  assert.deepEqual(result.unmatched.map((entry) => entry.number), [12, 99]);
  assert.deepEqual(result.items.find((item) => item.id === first.id)?.attempts, [
    { answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T15:00:00.000Z' },
  ]);
  assert.deepEqual(result.items.find((item) => item.id === second.id)?.attempts, [
    { answer: 'C', isCorrect: false, attemptedAt: '2026-07-03T15:00:00.000Z' },
  ]);
  assert.equal(result.items.find((item) => item.id === outsideFilter.id)?.attempts.length, 0);
});

test('applyExternalAnswerAttempts can fall back to visible filtered order', () => {
  const first = makeItem('qb_a', undefined, 'A');
  const second = makeItem('qb_b', undefined, 'B');
  const parsed = parseExternalAnswerText('1 A\n2 C');

  const result = applyExternalAnswerAttempts(
    [first, second],
    [first, second],
    parsed.entries,
    '2026-07-03T15:10:00.000Z',
  );

  assert.equal(result.applied, 2);
  assert.equal(result.items[0].attempts[0].isCorrect, true);
  assert.equal(result.items[1].attempts[0].isCorrect, false);
});

test('selectExternalAnswerReviewItems isolates the latest applied wrong and uncorrected attempts', () => {
  const correct = {
    ...makeItem('qb_correct', 1, 'A'),
    attempts: [{ answer: 'A', isCorrect: true, attemptedAt: '2026-07-03T15:10:00.000Z' }],
  };
  const wrong = {
    ...makeItem('qb_wrong', 2, 'B'),
    attempts: [{ answer: 'C', isCorrect: false, attemptedAt: '2026-07-03T15:10:00.000Z' }],
  };
  const uncorrected = {
    ...makeItem('qb_uncorrected', 3),
    attempts: [{ answer: 'D', isCorrect: null, attemptedAt: '2026-07-03T15:10:00.000Z' }],
  };
  const olderWrong = {
    ...makeItem('qb_old', 4, 'E'),
    attempts: [{ answer: 'A', isCorrect: false, attemptedAt: '2026-07-03T14:10:00.000Z' }],
  };
  const items = [correct, wrong, uncorrected, olderWrong];
  const changedIds = [correct.id, wrong.id, uncorrected.id];

  assert.deepEqual(selectExternalAnswerReviewItems(items, changedIds, 'all').map((item) => item.id), [
    correct.id,
    wrong.id,
    uncorrected.id,
  ]);
  assert.deepEqual(selectExternalAnswerReviewItems(items, changedIds, 'wrong').map((item) => item.id), [wrong.id]);
  assert.deepEqual(selectExternalAnswerReviewItems(items, changedIds, 'wrong-or-uncorrected').map((item) => item.id), [
    wrong.id,
    uncorrected.id,
  ]);
});

test('recordExternalAnswerBatch keeps newest batches first, deduplicates ids, and prunes history', () => {
  const previous = [
    {
      id: 'batch-old',
      sourceKind: 'tec' as const,
      sourceName: 'Caderno velho',
      appliedAt: '2026-07-03T14:00:00.000Z',
      changedIds: ['qb_old'],
      applied: 1,
      unmatched: 0,
    },
    {
      id: 'batch-replaced',
      sourceKind: 'tec' as const,
      sourceName: 'Versao antiga',
      appliedAt: '2026-07-03T13:00:00.000Z',
      changedIds: ['qb_x'],
      applied: 1,
      unmatched: 0,
    },
  ];

  const next = recordExternalAnswerBatch(
    previous,
    {
      id: 'batch-replaced',
      sourceKind: 'tec',
      sourceName: 'Caderno atual',
      appliedAt: '2026-07-03T15:00:00.000Z',
      changedIds: ['qb_1', 'qb_1', 'qb_2'],
      applied: 3,
      unmatched: 1,
    },
    2,
  );

  assert.deepEqual(next.map((batch) => batch.id), ['batch-replaced', 'batch-old']);
  assert.deepEqual(next[0].changedIds, ['qb_1', 'qb_2']);
  assert.equal(next[0].sourceName, 'Caderno atual');
});

test('parseExternalAnswerBatchHistory sanitizes stored history', () => {
  const parsed = parseExternalAnswerBatchHistory(JSON.stringify([
    {
      id: 'batch-1',
      sourceKind: 'tec',
      sourceName: 'Caderno TEC',
      appliedAt: '2026-07-03T15:00:00.000Z',
      changedIds: ['qb_1', 'qb_1', ''],
      applied: 2,
      unmatched: 0,
    },
    {
      id: '',
      sourceKind: 'tec',
      appliedAt: '2026-07-03T15:00:00.000Z',
      changedIds: ['qb_invalid'],
      applied: 1,
      unmatched: 0,
    },
    'quebrado',
  ]));

  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    id: 'batch-1',
    sourceKind: 'tec',
    sourceName: 'Caderno TEC',
    appliedAt: '2026-07-03T15:00:00.000Z',
    changedIds: ['qb_1'],
    applied: 2,
    unmatched: 0,
  });
  assert.deepEqual(parseExternalAnswerBatchHistory('nao-json'), []);
});

test('findExternalAnswerBatch returns a saved batch by id without falling back incorrectly', () => {
  const history = parseExternalAnswerBatchHistory(JSON.stringify([
    {
      id: 'batch-newer',
      sourceKind: 'tec',
      appliedAt: '2026-07-03T16:00:00.000Z',
      changedIds: ['qb_newer'],
      applied: 1,
      unmatched: 0,
    },
    {
      id: 'batch-older',
      sourceKind: 'tec',
      appliedAt: '2026-07-03T15:00:00.000Z',
      changedIds: ['qb_older'],
      applied: 1,
      unmatched: 0,
    },
  ]));

  assert.equal(findExternalAnswerBatch(history, 'batch-older')?.id, 'batch-older');
  assert.equal(findExternalAnswerBatch(history, 'missing'), null);
  assert.equal(findExternalAnswerBatch(history, ''), null);
});

test('removeExternalAnswerBatch removes only the requested saved batch', () => {
  const history = parseExternalAnswerBatchHistory(JSON.stringify([
    {
      id: 'batch-newer',
      sourceKind: 'tec',
      appliedAt: '2026-07-03T16:00:00.000Z',
      changedIds: ['qb_newer'],
      applied: 1,
      unmatched: 0,
    },
    {
      id: 'batch-older',
      sourceKind: 'tec',
      appliedAt: '2026-07-03T15:00:00.000Z',
      changedIds: ['qb_older'],
      applied: 1,
      unmatched: 0,
    },
  ]));

  assert.deepEqual(removeExternalAnswerBatch(history, 'batch-newer').map((batch) => batch.id), ['batch-older']);
  assert.deepEqual(removeExternalAnswerBatch(history, 'missing').map((batch) => batch.id), [
    'batch-newer',
    'batch-older',
  ]);
  assert.deepEqual(removeExternalAnswerBatch(history, '').map((batch) => batch.id), ['batch-newer', 'batch-older']);
});
