import assert from 'node:assert/strict';
import test from 'node:test';

import { Question, QuestionBankItem, StudyTask } from '../types';
import { ImportedObjectiveQuestion } from './objectiveQuestionParser';
import { planTaskQuestionImport } from './taskQuestionImport';

const parsed = (number: number, answerKey = 'B'): ImportedObjectiveQuestion => ({
  localId: `parsed-${number}`,
  number,
  statement: `Enunciado completo ${number}`,
  alternatives: [
    { label: 'A', text: `Alternativa A${number}` },
    { label: 'B', text: `Alternativa B${number}` },
  ],
  answerKey,
  bank: 'FCC',
  year: 2026,
});

const canonical = (number: number, answerKey = 'B'): QuestionBankItem => ({
  id: `qb-${number}`,
  fingerprint: `fp-${number}`,
  sourceQuestionNumber: number,
  statement: `Enunciado completo ${number}`,
  alternatives: [
    { label: 'A', text: `Alternativa A${number}` },
    { label: 'B', text: `Alternativa B${number}` },
  ],
  correctAnswer: answerKey,
  isMultipleChoice: true,
  sourceKind: 'professor',
  sourceName: 'Aula 02 - ITCD',
  sourceFileName: 'ITCD_CE.pdf',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  lesson: 'Aula 02 - ITCD',
  taskTitle: 'Questões inéditas - ITCD',
  bank: 'FCC',
  year: 2026,
  tags: ['ITCD'],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-13T12:00:00.000Z',
  updatedAt: '2026-07-13T12:00:00.000Z',
});

const taskWith = (questions: Question[], locked = false): StudyTask => ({
  id: 'task-1',
  date: '2026-07-13T10:00:00.000Z',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  bank: 'FCC',
  status: 'in_progress',
  blocks: [{
    id: 'block-1',
    title: 'Questões por índice',
    lesson: 'Aula 02 - ITCD',
    pages: '1-27',
    bank: 'FCC',
    isLocked: locked,
    questions,
  }],
});

const taskWithSection = (children: StudyTask['blocks'] = [], locked = false): StudyTask => ({
  ...taskWith([]),
  blocks: [{
    id: 'section-1',
    title: 'Aula 02 - ITCD',
    lesson: 'Aula 02 - ITCD',
    pages: '',
    questions: [],
    isSection: true,
    isLocked: locked,
  }, ...children],
});

const defaults = {
  title: 'Questões inéditas - ITCD',
  lesson: 'Aula 02 - ITCD',
  pages: '27 páginas',
  bank: 'FCC',
};

test('enriches an index-only question and preserves all execution progress', () => {
  const existing: Question = {
    number: 2,
    answer: 'A',
    correctAnswer: 'B',
    isCorrect: false,
    hasDoubt: true,
    favorite: true,
    observations: 'Fiquei entre A e B.',
    eliminated: ['C'],
    doubtedAlts: ['A', 'B'],
    attempts: [{ answer: 'A', isCorrect: false, attemptedAt: '2026-07-12T18:00:00.000Z' }],
  };
  const result = planTaskQuestionImport({
    task: taskWith([existing]),
    sourceQuestions: [parsed(2)],
    canonicalItems: [canonical(2)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const imported = result.task.blocks[0].questions[0];
  assert.equal(result.summary.enriched, 1);
  assert.equal(imported.localId, 'qb-2');
  assert.equal(imported.answer, 'A');
  assert.equal(imported.isCorrect, false);
  assert.equal(imported.hasDoubt, true);
  assert.equal(imported.favorite, true);
  assert.equal(imported.observations, existing.observations);
  assert.deepEqual(imported.eliminated, ['C']);
  assert.deepEqual(imported.doubtedAlts, ['A', 'B']);
  assert.deepEqual(imported.attempts, existing.attempts);
});

test('preserves a conflicting manual key and imports non-conflicting content', () => {
  const result = planTaskQuestionImport({
    task: taskWith([
      { number: 1, answer: '', correctAnswer: 'A', isCorrect: null, hasDoubt: false },
      { number: 2, answer: '', isCorrect: null, hasDoubt: false },
    ]),
    sourceQuestions: [parsed(1, 'B'), parsed(2, 'B')],
    canonicalItems: [canonical(1, 'B'), canonical(2, 'B')],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.task.blocks[0].questions[0].correctAnswer, 'A');
  assert.equal(result.task.blocks[0].questions[1].correctAnswer, 'B');
  assert.equal(result.summary.answerKeyConflicts, 1);

  const repeated = planTaskQuestionImport({
    task: result.task,
    sourceQuestions: [parsed(1, 'B'), parsed(2, 'B')],
    canonicalItems: [canonical(1, 'B'), canonical(2, 'B')],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.changed, false);
  assert.equal(repeated.task, result.task);
  assert.equal(repeated.summary.answerKeyConflicts, 1);
  assert.equal(repeated.summary.duplicates, 2);
});

test('appends unmatched questions with unique internal numbers and source numbers', () => {
  const result = planTaskQuestionImport({
    task: taskWith([{ number: 25, answer: '', isCorrect: null, hasDoubt: false }]),
    sourceQuestions: [parsed(2), parsed(3)],
    canonicalItems: [canonical(2), canonical(3)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.task.blocks[0].questions.map((question) => question.number), [25, 26, 27]);
  assert.deepEqual(result.task.blocks[0].questions.slice(1).map((question) => question.sourceQuestionNumber), [2, 3]);
});

test('is idempotent when the same canonical batch is imported twice', () => {
  const first = planTaskQuestionImport({
    task: taskWith([]),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.equal(second.summary.duplicates, 1);
  assert.equal(second.task.blocks[0].questions.length, 1);
});

test('rejects empty, mismatched, missing, and locked destinations', () => {
  const base = {
    task: taskWith([]),
    destination: { kind: 'existing_block' as const, blockId: 'block-1' },
    blockDefaults: defaults,
  };
  const empty = planTaskQuestionImport({ ...base, sourceQuestions: [], canonicalItems: [] });
  assert.deepEqual(empty.ok ? null : [empty.code, empty.message], [
    'empty_batch',
    'Nenhuma questão objetiva foi detectada.',
  ]);
  const mismatch = planTaskQuestionImport({ ...base, sourceQuestions: [parsed(1)], canonicalItems: [] });
  assert.deepEqual(mismatch.ok ? null : [mismatch.code, mismatch.message], [
    'batch_mismatch',
    'O lote processado não corresponde aos itens canônicos do banco.',
  ]);
  const missing = planTaskQuestionImport({ ...base, destination: { kind: 'existing_block', blockId: 'missing' }, sourceQuestions: [parsed(1)], canonicalItems: [canonical(1)] });
  assert.deepEqual(missing.ok ? null : [missing.code, missing.message], [
    'missing_block',
    'Selecione um bloco existente para receber as questões.',
  ]);
  const locked = planTaskQuestionImport({ ...base, task: taskWith([], true), sourceQuestions: [parsed(1)], canonicalItems: [canonical(1)] });
  assert.deepEqual(locked.ok ? null : [locked.code, locked.message], [
    'locked_destination',
    'Desbloqueie o bloco ou a seção antes de importar.',
  ]);

  const missingSection = planTaskQuestionImport({
    ...base,
    destination: { kind: 'new_block', sectionTitle: 'Ausente' },
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
  });
  assert.deepEqual(missingSection.ok ? null : [missingSection.code, missingSection.message], [
    'missing_section',
    'Selecione uma seção existente para criar a atividade.',
  ]);
});

test('keeps complete conflicting content while importing another question', () => {
  const manual: Question = {
    number: 1,
    sourceQuestionNumber: 1,
    statement: 'Conteúdo manual preservado',
    alternatives: [{ label: 'A', text: 'Manual A' }, { label: 'B', text: 'Manual B' }],
    answer: '',
    isCorrect: null,
    hasDoubt: false,
  };
  const result = planTaskQuestionImport({
    task: taskWith([manual]),
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'existing_block', blockId: 'block-1' },
    blockDefaults: defaults,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.contentConflicts, 1);
  assert.equal(result.summary.appended, 1);
  assert.equal(result.task.blocks[0].questions[0].statement, 'Conteúdo manual preservado');
});

test('creates a responsive section and treats a repeated batch as idempotent', () => {
  let nextId = 0;
  const first = planTaskQuestionImport({
    task: taskWith([]),
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
    idFactory: () => `new-${++nextId}`,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.task.blocks.at(-2)?.isSection, true);
  assert.equal(first.task.blocks.at(-1)?.layout?.width, 12);
  assert.equal(first.task.blocks.at(-1)?.layout?.columns, 1);
  assert.equal(first.task.blocks.at(-1)?.layout?.rows, 2);
  assert.equal(first.task.blocks.at(-1)?.layout?.type, 'grid');
  assert.equal(first.task.blocks.at(-1)?.layout?.rowSpan, 4);
  assert.equal(first.task.blocks.at(-1)?.showStats, true);
  assert.equal(first.task.blocks.at(-1)?.showGabarito, false);

  const repeated = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(1), parsed(2)],
    canonicalItems: [canonical(1), canonical(2)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.changed, false);
  assert.equal(repeated.summary.duplicates, 2);

  const differentBatch = planTaskQuestionImport({
    task: first.task,
    sourceQuestions: [parsed(3)],
    canonicalItems: [canonical(3)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.deepEqual(differentBatch.ok ? null : [differentBatch.code, differentBatch.message], [
    'duplicate_section',
    'Já existe uma seção com este título; escolha Nova atividade para acrescentar outro lote.',
  ]);
});

test('does not treat a conflicting same-number manual question as an equivalent section batch', () => {
  const manualBlock: StudyTask['blocks'][number] = {
    id: 'manual-block',
    title: 'Manual',
    lesson: 'Aula 02 - ITCD',
    pages: '',
    questions: [{
      number: 1,
      sourceQuestionNumber: 1,
      statement: 'Conteúdo manual diferente',
      alternatives: [{ label: 'A', text: 'Manual A' }, { label: 'B', text: 'Manual B' }],
      answer: '',
      isCorrect: null,
      hasDoubt: false,
    }],
  };
  const result = planTaskQuestionImport({
    task: taskWithSection([manualBlock]),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'new_section', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'duplicate_section');
});

test('creates one block in an existing unlocked section and rejects a locked section', () => {
  const first = planTaskQuestionImport({
    task: taskWithSection(),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'new_block', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
    idFactory: () => 'new-block',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.task.blocks.at(-1)?.id, 'new-block');

  const locked = planTaskQuestionImport({
    task: taskWithSection([], true),
    sourceQuestions: [parsed(1)],
    canonicalItems: [canonical(1)],
    destination: { kind: 'new_block', sectionTitle: 'Aula 02 - ITCD' },
    blockDefaults: defaults,
  });
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.code, 'locked_destination');
});
