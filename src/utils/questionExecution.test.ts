import assert from 'node:assert/strict';
import test from 'node:test';

import { ActivityBlock, Question } from '../types';

type QuestionExecutionModule = typeof import('./questionExecution');

const loadQuestionExecution = async (): Promise<Partial<QuestionExecutionModule>> => {
  try {
    return await import('./questionExecution');
  } catch {
    return {};
  }
};

const makeQuestion = (overrides: Partial<Question> = {}): Question => ({
  number: 1,
  answer: '',
  isCorrect: null,
  hasDoubt: false,
  statement: 'Enunciado da questao.',
  alternatives: [
    { label: 'A', text: 'Alternativa A' },
    { label: 'B', text: 'Alternativa B' },
  ],
  ...overrides,
});

test('answer keys start hidden and an individual reveal grades the selected answer', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.isQuestionAnswerRevealed, 'function');
  assert.equal(typeof sut.toggleQuestionAnswerReveal, 'function');

  const hidden = new Set<string>();
  assert.equal(sut.isQuestionAnswerRevealed!(hidden, 'block-1:q-1'), false);

  const decision = sut.toggleQuestionAnswerReveal!(
    hidden,
    'block-1:q-1',
    makeQuestion({ answer: 'B', correctAnswer: 'B' }),
  );

  assert.equal(decision.revealedIds.has('block-1:q-1'), true);
  assert.deepEqual(decision.updates, { isCorrect: true });
  assert.equal(hidden.size, 0);
});

test('hiding answer feedback changes only local reveal state', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.toggleQuestionAnswerReveal, 'function');

  const question = makeQuestion({ answer: 'A', correctAnswer: 'A', isCorrect: true });
  const revealed = new Set(['block-1:q-1']);
  const decision = sut.toggleQuestionAnswerReveal!(revealed, 'block-1:q-1', question);

  assert.equal(decision.revealedIds.has('block-1:q-1'), false);
  assert.equal(decision.updates, null);
  assert.equal(question.answer, 'A');
  assert.equal(question.isCorrect, true);
});

test('block reveal handles keyed questions and block hide preserves every result', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.toggleAllQuestionAnswers, 'function');

  const questions = [
    { id: 'q-1', question: makeQuestion({ number: 1, answer: 'A', correctAnswer: 'A' }) },
    { id: 'q-2', question: makeQuestion({ number: 2, correctAnswer: 'B' }) },
    { id: 'q-3', question: makeQuestion({ number: 3 }) },
    { id: 'q-4', question: makeQuestion({ number: 4, answer: 'A', correctAnswer: 'ANULADA' }) },
  ];

  const revealed = sut.toggleAllQuestionAnswers!(new Set(), questions);
  assert.deepEqual([...revealed.revealedIds].sort(), ['q-1', 'q-2', 'q-4']);
  assert.deepEqual(revealed.updates, [{ id: 'q-1', updates: { isCorrect: true } }]);

  const hidden = sut.toggleAllQuestionAnswers!(revealed.revealedIds, questions);
  assert.deepEqual([...hidden.revealedIds], []);
  assert.deepEqual(hidden.updates, []);
});

test('changing an answer clears stale correctness until the next reveal', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.buildAnswerSelectionUpdate, 'function');

  const changed = sut.buildAnswerSelectionUpdate!(
    makeQuestion({ answer: 'A', correctAnswer: 'A', isCorrect: true }),
    'B',
  );
  assert.deepEqual(changed, { answer: 'B', isCorrect: null });

  const cleared = sut.buildAnswerSelectionUpdate!(
    makeQuestion({ answer: 'B', correctAnswer: 'B', isCorrect: true }),
    'B',
  );
  assert.deepEqual(cleared, { answer: '', isCorrect: null });
});

test('persisting an answer does not auto-grade before reveal', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.applyQuestionUpdate, 'function');

  const selected = sut.applyQuestionUpdate!(
    makeQuestion({ answer: '', correctAnswer: 'B', isCorrect: null }),
    { answer: 'B' },
  );
  assert.equal(selected.answer, 'B');
  assert.equal(selected.isCorrect, null);

  const revealed = sut.applyQuestionUpdate!(selected, { isCorrect: true });
  assert.equal(revealed.isCorrect, true);
});

test('missing and annulled keys reveal without creating an automatic result', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.getQuestionRevealUpdate, 'function');
  assert.equal(typeof sut.shouldShowQuestionCorrectness, 'function');

  assert.equal(sut.getQuestionRevealUpdate!(makeQuestion({ answer: 'A' })), null);
  assert.equal(
    sut.getQuestionRevealUpdate!(makeQuestion({ answer: 'A', correctAnswer: 'ANULADA' })),
    null,
  );
  assert.equal(
    sut.getQuestionRevealUpdate!(makeQuestion({ answer: '', correctAnswer: 'A' })),
    null,
  );
  assert.equal(
    sut.shouldShowQuestionCorrectness!(
      makeQuestion({ answer: 'A', correctAnswer: 'ANULADA', isCorrect: true }),
      true,
    ),
    false,
  );
  assert.equal(
    sut.shouldShowQuestionCorrectness!(
      makeQuestion({ answer: 'A', correctAnswer: 'A', isCorrect: true }),
      false,
    ),
    false,
  );
  assert.equal(
    sut.shouldShowQuestionCorrectness!(
      makeQuestion({ answer: 'A', correctAnswer: 'A', isCorrect: true }),
      true,
    ),
    true,
  );
});

test('manual C/E question creation supplies executable alternatives and a stable local identity', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.saveQuestionDraft, 'function');

  const block: ActivityBlock = {
    id: 'block-1',
    title: 'Questoes manuais',
    lesson: 'Aula 01',
    pages: '',
    questions: [],
  };
  const result = sut.saveQuestionDraft!(
    block,
    {
      kind: 'true_false',
      sourceQuestionNumber: '002',
      statement: 'O item apresentado esta correto.',
      alternatives: [],
      correctAnswer: 'C',
      sourceName: 'Inclusao manual',
    },
    { idFactory: () => 'manual-q-1' },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.block.questions[0], {
    number: 1,
    sourceQuestionNumber: 2,
    localId: 'manual-q-1',
    statement: 'O item apresentado esta correto.',
    alternatives: [
      { label: 'C', text: 'Certo' },
      { label: 'E', text: 'Errado' },
    ],
    correctAnswer: 'C',
    isMultipleChoice: false,
    sourceKind: 'other',
    sourceName: 'Inclusao manual',
    answer: '',
    isCorrect: null,
    hasDoubt: false,
  });
});

test('editing malformed multiple-choice content preserves progress unless the key changes', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.saveQuestionDraft, 'function');

  const original = makeQuestion({
    number: 7,
    localId: 'imported-q-7',
    sourceQuestionNumber: 12,
    answer: 'B',
    correctAnswer: 'B',
    isCorrect: true,
    favorite: true,
    observations: 'Revisar depois.',
  });
  const block: ActivityBlock = {
    id: 'block-1',
    title: 'Importadas',
    lesson: 'Aula 02',
    pages: '',
    questions: [original],
  };
  const draft = {
    kind: 'multiple_choice' as const,
    sourceQuestionNumber: '12',
    statement: 'Enunciado corrigido.',
    alternatives: [
      { label: 'A', text: 'Texto A corrigido' },
      { label: 'B', text: 'Texto B corrigido' },
      { label: 'C', text: '' },
    ],
    correctAnswer: 'B',
    sourceName: 'PDF corrigido',
  };

  const preserved = sut.saveQuestionDraft!(block, draft, { editingQuestionNumber: 7 });
  assert.equal(preserved.ok, true);
  if (!preserved.ok) return;
  assert.equal(preserved.block.questions[0].answer, 'B');
  assert.equal(preserved.block.questions[0].isCorrect, true);
  assert.equal(preserved.block.questions[0].favorite, true);
  assert.equal(preserved.block.questions[0].observations, 'Revisar depois.');
  assert.deepEqual(preserved.block.questions[0].alternatives, [
    { label: 'A', text: 'Texto A corrigido' },
    { label: 'B', text: 'Texto B corrigido' },
  ]);

  const changedKey = sut.saveQuestionDraft!(
    preserved.block,
    { ...draft, correctAnswer: 'A' },
    { editingQuestionNumber: 7 },
  );
  assert.equal(changedKey.ok, true);
  if (!changedKey.ok) return;
  assert.equal(changedKey.block.questions[0].answer, 'B');
  assert.equal(changedKey.block.questions[0].isCorrect, null);
});

test('manual multiple-choice questions require a statement and at least two alternatives', async () => {
  const sut = await loadQuestionExecution();
  assert.equal(typeof sut.saveQuestionDraft, 'function');

  const block: ActivityBlock = {
    id: 'block-1',
    title: 'Manuais',
    lesson: 'Aula 01',
    pages: '',
    questions: [],
  };
  const result = sut.saveQuestionDraft!(block, {
    kind: 'multiple_choice',
    sourceQuestionNumber: '',
    statement: '  ',
    alternatives: [{ label: 'A', text: 'Unica alternativa' }],
    correctAnswer: 'A',
    sourceName: '',
  });

  assert.deepEqual(result, {
    ok: false,
    errors: ['Informe o enunciado.', 'Informe pelo menos duas alternativas.'],
  });
});
