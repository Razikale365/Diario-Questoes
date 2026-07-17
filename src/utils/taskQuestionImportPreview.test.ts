import assert from 'node:assert/strict';
import test from 'node:test';

import { QuestionBankImportContext } from './questionBank';
import { buildTaskQuestionImportPreview } from './taskQuestionImportPreview';

const parsedQuestion = (number: number) => ({
  localId: `parsed-${number}`,
  number,
  statement: `Enunciado ${number}`,
  alternatives: [{ label: 'C', text: 'Certo' }, { label: 'E', text: 'Errado' }],
  answerKey: 'C',
  bank: 'CEBRASPE',
});

const parsedBatch = {
  questions: [parsedQuestion(1), parsedQuestion(2)],
  rejectedBlocks: 1,
  fileName: 'ITCD_CE.pdf',
  pageCount: 27,
};

const task = {
  id: 'task-preview',
  date: '2026-07-13T10:00:00.000Z',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  bank: 'CEBRASPE',
  status: 'in_progress' as const,
  blocks: [{
    id: 'block-1',
    title: 'Índice',
    lesson: 'Aula 02 - ITCD',
    pages: '1-27',
    questions: [{ number: 1, answer: '', isCorrect: null, hasDoubt: false }],
  }],
};

const context: QuestionBankImportContext = {
  sourceKind: 'professor',
  sourceName: 'Aula 02 - ITCD',
  sourceFileName: 'ITCD_CE.pdf',
  targetSlug: 'sefaz_ce',
  discipline: task.discipline,
  lesson: 'Aula 02 - ITCD',
  taskTitle: 'Questões inéditas - ITCD',
  bank: 'CEBRASPE',
  tags: ['ITCD'],
};

const blockDefaults = {
  title: 'Questões inéditas - ITCD',
  lesson: 'Aula 02 - ITCD',
  pages: '27 páginas',
  bank: 'CEBRASPE',
};

const buildFirstPreview = () => buildTaskQuestionImportPreview({
  task,
  currentQuestionBank: [],
  parsed: parsedBatch,
  context,
  destination: { kind: 'existing_block', blockId: 'block-1' },
  blockDefaults,
});

test('builds canonical task and bank preview counts without persistence', () => {
  const preview = buildFirstPreview();
  assert.equal(preview.plan.ok, true);
  assert.equal(preview.rejectedBlocks, 1);
  assert.equal(preview.bankAdded, 2);
  assert.equal(preview.bankDuplicates, 0);
  assert.deepEqual(
    preview.plan.ok ? preview.plan.task.blocks[0].questions.map((question) => question.localId) : [],
    preview.canonicalItems.map((item) => item.id),
  );
});

test('reports canonical and task duplicates on a repeated preview', () => {
  const preview = buildFirstPreview();
  if (!preview.plan.ok) throw new Error('Expected valid first preview');
  const repeated = buildTaskQuestionImportPreview({
    task: preview.plan.task,
    currentQuestionBank: preview.nextQuestionBank,
    parsed: parsedBatch,
    context,
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults,
  });

  assert.equal(repeated.bankAdded, 0);
  assert.equal(repeated.bankDuplicates, 2);
  assert.equal(repeated.plan.ok, true);
  if (!repeated.plan.ok) return;
  assert.equal(repeated.plan.changed, false);
  assert.equal(repeated.plan.task.blocks[0].questions.length, 2);
});

test('reports a locked destination without mutating the bank input', () => {
  const preview = buildFirstPreview();
  const originalBank = [...preview.nextQuestionBank];
  const locked = buildTaskQuestionImportPreview({
    task: { ...task, blocks: task.blocks.map((block) => ({ ...block, isLocked: true })) },
    currentQuestionBank: originalBank,
    parsed: parsedBatch,
    context,
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults,
  });

  assert.equal(locked.plan.ok, false);
  if (locked.plan.ok) return;
  assert.equal(locked.plan.code, 'locked_destination');
  assert.deepEqual(originalBank, preview.nextQuestionBank);
});
