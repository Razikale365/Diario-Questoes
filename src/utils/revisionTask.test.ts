import assert from 'node:assert/strict';
import test from 'node:test';

import { Question, StudyTask } from '../types';

type RevisionTaskModule = typeof import('./revisionTask');

const loadRevisionTask = async (): Promise<Partial<RevisionTaskModule>> => {
  try {
    return await import('./revisionTask');
  } catch {
    return {};
  }
};

const importedQuestion = (overrides: Partial<Question>): Question => ({
  number: 1,
  sourceQuestionNumber: 37,
  localId: 'qb-question-37',
  statement: 'Enunciado completo da questão 37.',
  alternatives: [
    { label: 'A', text: 'Alternativa A.' },
    { label: 'B', text: 'Alternativa B.' },
  ],
  answer: 'B',
  correctAnswer: 'A',
  isCorrect: false,
  hasDoubt: true,
  doubtedAlts: ['A', 'B'],
  eliminated: ['C'],
  observations: 'Fiquei entre A e B.',
  favorite: true,
  sourceKind: 'estrategia',
  sourceName: 'Aula 04 - Questões',
  attempts: [{ answer: 'B', isCorrect: false, attemptedAt: '2026-07-12T18:00:00.000Z' }],
  ...overrides,
});

const completedTask = (id: string, questions: Question[]): StudyTask => ({
  id,
  date: '2026-07-12T18:00:00.000Z',
  targetSlug: 'sefaz_ce',
  discipline: 'Legislação Tributária Estadual',
  bank: 'CEBRASPE',
  status: 'completed',
  blocks: [
    {
      id: `${id}-block`,
      title: 'Questões importadas',
      lesson: 'Aula 04',
      pages: '12-18',
      bank: 'CEBRASPE',
      questions,
    },
  ],
});

test('revision draft carries imported doubt questions into an executable retry task', async () => {
  const sut = await loadRevisionTask();
  assert.equal(typeof sut.buildRevisionTaskDraft, 'function');

  const question37 = importedQuestion({});
  const question52 = importedQuestion({
    number: 2,
    sourceQuestionNumber: 52,
    localId: 'qb-question-52',
    statement: 'Enunciado completo da questão 52.',
    answer: 'A',
    correctAnswer: 'A',
    isCorrect: true,
    hasDoubt: true,
    doubtedAlts: ['A'],
    eliminated: [],
    observations: 'Acertei com insegurança.',
  });
  const excluded = importedQuestion({
    number: 3,
    sourceQuestionNumber: 60,
    localId: 'qb-question-60',
    answer: 'A',
    correctAnswer: 'A',
    isCorrect: true,
    hasDoubt: false,
  });
  const duplicateTask = completedTask('task-duplicate', [
    { ...question37, answer: 'A', isCorrect: true },
  ]);
  let nextId = 0;

  const draft = sut.buildRevisionTaskDraft!(
    [completedTask('task-original', [question37, question52, excluded]), duplicateTask],
    'Legislação Tributária Estadual',
    new Set(['Aula 04']),
    { idFactory: () => `revision-id-${++nextId}` },
  );

  assert.equal(draft.questionCount, 2);
  assert.match(draft.lines.join('\n'), /questões 37 e 52/i);
  const activityBlocks = draft.blocks.filter((block) => !block.isSection);
  assert.equal(activityBlocks.length, 1);
  assert.equal(activityBlocks[0].lesson, 'Aula 04');
  assert.equal(activityBlocks[0].bank, 'CEBRASPE');
  assert.deepEqual(
    activityBlocks[0].questions.map((question) => ({
      number: question.number,
      sourceQuestionNumber: question.sourceQuestionNumber,
      localId: question.localId,
      statement: question.statement,
      answer: question.answer,
      isCorrect: question.isCorrect,
      hasDoubt: question.hasDoubt,
      correctAnswer: question.correctAnswer,
      attempts: question.attempts,
      eliminated: question.eliminated,
      doubtedAlts: question.doubtedAlts,
    })),
    [
      {
        number: 1,
        sourceQuestionNumber: 37,
        localId: 'qb-question-37',
        statement: 'Enunciado completo da questão 37.',
        answer: '',
        isCorrect: null,
        hasDoubt: true,
        correctAnswer: 'A',
        attempts: [],
        eliminated: [],
        doubtedAlts: ['A', 'B'],
      },
      {
        number: 2,
        sourceQuestionNumber: 52,
        localId: 'qb-question-52',
        statement: 'Enunciado completo da questão 52.',
        answer: '',
        isCorrect: null,
        hasDoubt: true,
        correctAnswer: 'A',
        attempts: [],
        eliminated: [],
        doubtedAlts: ['A'],
      },
    ],
  );

  assert.equal(question37.answer, 'B');
  assert.equal(question37.isCorrect, false);
  assert.equal(question37.attempts?.length, 1);
});

test('revision draft remains empty when the selected lesson has no errors or doubts', async () => {
  const sut = await loadRevisionTask();
  assert.equal(typeof sut.buildRevisionTaskDraft, 'function');
  const task = completedTask('task-clean', [
    importedQuestion({ answer: 'A', correctAnswer: 'A', isCorrect: true, hasDoubt: false }),
  ]);

  const draft = sut.buildRevisionTaskDraft!(
    [task],
    'Legislação Tributária Estadual',
    new Set(['Aula 04']),
  );

  assert.deepEqual(draft, { lines: [], blocks: [], questionCount: 0 });
});
