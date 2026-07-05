import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerQuestionBankItemInline,
  buildQuestionBankItems,
  createQuestionBankBackup,
  createStudyTaskFromQuestionBankItems,
  filterQuestionBankItems,
  importQuestionBankBackup,
  getQuestionBankAnswerOptions,
  isStudyTaskCompatibleWithPlannerTask,
  matchQuestionBankItemsToPlannerTask,
  mergeQuestionBankItems,
  parseQuestionBankBackup,
  resetQuestionBankItemAttempts,
  resolveMergedQuestionBankItems,
  syncQuestionBankItemProgress,
} from './questionBank';

const importedQuestions = [
  {
    localId: 'q_1',
    number: 1,
    statement: 'O controle de constitucionalidade pode ser difuso ou concentrado.',
    alternatives: [
      { label: 'C', text: 'Certo' },
      { label: 'E', text: 'Errado' },
    ],
    answerKey: 'C',
    bank: 'CEBRASPE',
    year: 2024,
  },
  {
    localId: 'q_2',
    number: 2,
    statement: 'A lei orçamentária anual compreende orçamento fiscal e seguridade.',
    alternatives: [
      { label: 'A', text: 'Somente orçamento fiscal.' },
      { label: 'B', text: 'Somente investimento.' },
      { label: 'C', text: 'Fiscal, investimento e seguridade.' },
      { label: 'D', text: 'Apenas seguridade.' },
    ],
    answerKey: 'C',
    bank: 'FGV',
    year: 2023,
  },
];

const context = {
  sourceKind: 'tec' as const,
  sourceName: 'Caderno TEC Controle',
  sourceFileName: 'controle.pdf',
  discipline: 'Direito Constitucional',
  lesson: 'Controle de Constitucionalidade',
  taskTitle: 'Questões de Controle',
  bank: 'Outra',
  tags: ['meta 45', 'controle'],
};

test('mergeQuestionBankItems deduplicates questions and preserves local user state', () => {
  const initial = buildQuestionBankItems(importedQuestions, context);
  const edited = {
    ...initial[0],
    favorite: true,
    attempts: [{ answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T00:00:00.000Z' }],
  };

  const result = mergeQuestionBankItems([edited], initial);

  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items.find((item) => item.fingerprint === edited.fingerprint)?.favorite, true);
  assert.equal(result.items.find((item) => item.fingerprint === edited.fingerprint)?.attempts.length, 1);
});

test('filterQuestionBankItems searches metadata and statement text', () => {
  const items = buildQuestionBankItems(importedQuestions, context);

  const byQuery = filterQuestionBankItems(items, { query: 'orçamentária' });
  const byDiscipline = filterQuestionBankItems(items, { discipline: 'Direito Constitucional' });
  const bySource = filterQuestionBankItems(items, { sourceKind: 'estrategia' });

  assert.equal(byQuery.length, 1);
  assert.equal(byQuery[0].sourceQuestionNumber, 2);
  assert.equal(byDiscipline.length, 2);
  assert.equal(bySource.length, 0);
});

test('filterQuestionBankItems filters by latest attempt status', () => {
  const [first, second] = buildQuestionBankItems(importedQuestions, context);
  const wrong = {
    ...first,
    attempts: [{ answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T13:00:00.000Z' }],
  };
  const correct = {
    ...second,
    attempts: [{ answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T13:05:00.000Z' }],
  };
  const unanswered = {
    ...first,
    id: 'qb_unanswered',
    fingerprint: 'unanswered',
    sourceQuestionNumber: 3,
    statement: 'Questão ainda sem tentativa no banco.',
    attempts: [],
  };
  const items = [wrong, correct, unanswered];

  assert.deepEqual(filterQuestionBankItems(items, { attemptStatus: 'wrong' }).map((item) => item.id), [wrong.id]);
  assert.deepEqual(filterQuestionBankItems(items, { attemptStatus: 'correct' }).map((item) => item.id), [correct.id]);
  assert.deepEqual(filterQuestionBankItems(items, { attemptStatus: 'answered' }).map((item) => item.id), [wrong.id, correct.id]);
  assert.deepEqual(filterQuestionBankItems(items, { attemptStatus: 'unanswered' }).map((item) => item.id), [unanswered.id]);
});

test('filterQuestionBankItems filters locally marked doubt questions', () => {
  const [first, second] = buildQuestionBankItems(importedQuestions, context);
  const withDoubt = {
    ...first,
    hasDoubt: true,
    observations: 'Rever controle concentrado.',
  };
  const items = [withDoubt, second];

  assert.deepEqual(filterQuestionBankItems(items, { onlyDoubts: true }).map((item) => item.id), [withDoubt.id]);
});

test('createStudyTaskFromQuestionBankItems converts bank questions into an executable task', () => {
  const items = buildQuestionBankItems(importedQuestions, context);
  const task = createStudyTaskFromQuestionBankItems(items, { title: 'Rodada Controle' });

  assert.ok(task);
  assert.equal(task?.planejamento, 'Banco de Questões');
  assert.equal(task?.blocks[0].questions.length, 2);
  assert.equal(task?.blocks[0].questions[0].correctAnswer, 'C');
  assert.equal(task?.blocks[0].title, 'Rodada Controle');
});

test('matchQuestionBankItemsToPlannerTask links compatible bank questions by discipline and task text', () => {
  const constitutional = buildQuestionBankItems(importedQuestions, context);
  const finance = buildQuestionBankItems([importedQuestions[1]], {
    ...context,
    discipline: 'Direito Financeiro',
    lesson: 'Lei 4.320 e orçamento',
    taskTitle: 'Questões de Orçamento',
  });

  const matches = matchQuestionBankItemsToPlannerTask(
    {
      id: 'planner-1',
      number: 3,
      discipline: 'Direito Constitucional',
      format: 'Revisão e Exercícios',
      description: 'Controle de constitucionalidade concentrado e difuso',
      spentMinutes: 0,
      estimatedMinutes: 60,
      performance: null,
      status: 'pending',
      relevance: 9,
      durationMinutes: 60,
      source: 'ls-meta-text',
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    },
    [...constitutional, ...finance],
  );

  assert.equal(matches.length, 2);
  assert.ok(matches.every((item) => item.discipline === 'Direito Constitucional'));
  assert.deepEqual(matches.map((item) => item.sourceQuestionNumber), [1, 2]);
});

test('matchQuestionBankItemsToPlannerTask prefers exact task-title matches when a caderno has the same law keywords', () => {
  const sharedContext = {
    sourceKind: 'professor' as const,
    sourceName: 'Professor Raphael Senra - Lei 18.665/2023',
    discipline: 'Legis. Tribut. Estadual (ICMS)',
    lesson: 'Lei 18.665/2023',
    bank: 'Professor',
    tags: ['Meta 46', 'Lei 18.665/2023'],
  };
  const aula03 = buildQuestionBankItems(importedQuestions, {
    ...sharedContext,
    taskTitle: 'Meta 46 - Tarefa 29 - Lei 18.665/2023 Arts. 01 ao 06',
  });
  const parte2 = buildQuestionBankItems(importedQuestions, {
    ...sharedContext,
    taskTitle: 'Meta 46 - Tarefa 31 - Lei 18.665/2023 Arts. 07 ao 23',
  });

  const task29Matches = matchQuestionBankItemsToPlannerTask(
    {
      id: 'planner-29',
      number: 29,
      metaNumber: 46,
      discipline: 'Legis. Tribut. Estadual (ICMS)',
      format: 'Revisao e questoes',
      description: 'Lei 18.665/2023 - Arts. 01 ao 06',
      spentMinutes: 0,
      estimatedMinutes: 60,
      performance: null,
      status: 'pending',
      relevance: 9,
      durationMinutes: 60,
      source: 'ls-meta-pdf',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
    },
    [...aula03, ...parte2],
  );

  const task31Matches = matchQuestionBankItemsToPlannerTask(
    {
      id: 'planner-31',
      number: 31,
      metaNumber: 46,
      discipline: 'Legis. Tribut. Estadual (ICMS)',
      format: 'Revisao e questoes',
      description: 'Lei 18.665/2023 - Arts. 07 ao 23',
      spentMinutes: 0,
      estimatedMinutes: 60,
      performance: null,
      status: 'pending',
      relevance: 9,
      durationMinutes: 60,
      source: 'ls-meta-pdf',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
    },
    [...aula03, ...parte2],
  );

  assert.equal(task29Matches.length, 2);
  assert.ok(task29Matches.every((item) => item.taskTitle?.includes('Tarefa 29')));
  assert.equal(task31Matches.length, 2);
  assert.ok(task31Matches.every((item) => item.taskTitle?.includes('Tarefa 31')));
});

test('matchQuestionBankItemsToPlannerTask keeps professor Aula 04 questions off the Aula 03 task', () => {
  const aula04 = buildQuestionBankItems(importedQuestions, {
    sourceKind: 'professor',
    sourceName: 'Professor Raphael Senra - Aula 04 - Lei 18.665/2023',
    discipline: 'Legis. Tribut. Estadual (ICMS)',
    lesson: 'Lei 18.665/2023',
    taskTitle: 'Lei 18.665/2023 - Aula 04',
    bank: 'Professor',
    tags: ['Meta 46', 'Lei 18.665/2023', 'Aula 04'],
  });

  const task29Matches = matchQuestionBankItemsToPlannerTask(
    {
      id: 'planner-29',
      number: 29,
      metaNumber: 46,
      discipline: 'Legis. Tribut. Estadual (ICMS)',
      format: 'Revisao e Exercicios',
      description: 'Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)',
      details: '- Clique em Aula 03 - Lei 18.665/2023',
      spentMinutes: 0,
      estimatedMinutes: 80,
      performance: null,
      status: 'pending',
      relevance: 10,
      durationMinutes: 80,
      source: 'ls-meta-pdf',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
    },
    aula04,
  );

  const task31Matches = matchQuestionBankItemsToPlannerTask(
    {
      id: 'planner-31',
      number: 31,
      metaNumber: 46,
      discipline: 'Legis. Tribut. Estadual (ICMS)',
      format: 'Revisao e Exercicios',
      description: 'Lei 18.665/2023 - Arts. 07 ao 23 (Revisão)',
      details: '- Clique em Aula 04 - Lei 18.665/2023',
      spentMinutes: 0,
      estimatedMinutes: 46,
      performance: null,
      status: 'pending',
      relevance: 10,
      durationMinutes: 46,
      source: 'ls-meta-pdf',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
    },
    aula04,
  );

  assert.equal(task29Matches.length, 0);
  assert.equal(task31Matches.length, 2);
});

test('isStudyTaskCompatibleWithPlannerTask rejects a stale Aula 04 execution link for the Aula 03 planner task', () => {
  const aula04 = buildQuestionBankItems(importedQuestions, {
    sourceKind: 'professor',
    sourceName: 'Professor Raphael Senra - Aula 04 - Lei 18.665/2023',
    discipline: 'Legis. Tribut. Estadual (ICMS)',
    lesson: 'Lei 18.665/2023',
    taskTitle: 'Lei 18.665/2023 - Aula 04',
    bank: 'Professor',
    tags: ['Meta 46', 'Lei 18.665/2023', 'Aula 04'],
  });
  const studyTask = createStudyTaskFromQuestionBankItems(aula04, {
    title: 'Tarefa 31 - Legis. Tribut. Estadual (ICMS)',
    lesson: 'Professor Raphael Senra - Aula 04 - Lei 18.665/2023',
  });

  assert.ok(studyTask);
  assert.equal(
    isStudyTaskCompatibleWithPlannerTask(
      {
        id: 'planner-29',
        number: 29,
        metaNumber: 46,
        discipline: 'Legis. Tribut. Estadual (ICMS)',
        format: 'Revisao e Exercicios',
        description: 'Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)',
        details: '- Clique em Aula 03 - Lei 18.665/2023',
        spentMinutes: 0,
        estimatedMinutes: 80,
        performance: null,
        status: 'pending',
        relevance: 10,
        durationMinutes: 80,
        source: 'ls-meta-pdf',
        createdAt: '2026-07-04T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
      },
      studyTask,
    ),
    false,
  );
});

test('createQuestionBankBackup exports a versioned portable question bank file', () => {
  const items = buildQuestionBankItems(importedQuestions, context);
  const backup = createQuestionBankBackup(items, '2026-07-03T12:00:00.000Z', [
    {
      id: 'batch-tec-1',
      sourceKind: 'tec',
      sourceName: 'Caderno TEC Controle',
      appliedAt: '2026-07-03T12:30:00.000Z',
      changedIds: [items[0].id, items[0].id, items[1].id],
      applied: 2,
      unmatched: 1,
    },
  ]);
  const parsed = parseQuestionBankBackup(backup);

  assert.equal(parsed.schema, 'diario-questoes.question-bank');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, '2026-07-03T12:00:00.000Z');
  assert.equal(parsed.itemCount, 2);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].discipline, 'Direito Constitucional');
  assert.equal(parsed.externalAnswerBatchCount, 1);
  assert.deepEqual(parsed.externalAnswerBatches[0].changedIds, [items[0].id, items[1].id]);
});

test('importQuestionBankBackup validates and merges backup items with local user state', () => {
  const [first, second] = buildQuestionBankItems(importedQuestions, context);
  const localEdited = {
    ...first,
    favorite: true,
    attempts: [{ answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T00:00:00.000Z' }],
  };
  const backup = createQuestionBankBackup([first, second], '2026-07-03T12:00:00.000Z');

  const result = importQuestionBankBackup([localEdited], backup, [
    {
      id: 'batch-local',
      sourceKind: 'tec',
      sourceName: 'Local TEC',
      appliedAt: '2026-07-03T11:00:00.000Z',
      changedIds: [localEdited.id],
      applied: 1,
      unmatched: 0,
    },
  ]);

  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.imported, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items.find((item) => item.id === localEdited.id)?.favorite, true);
  assert.equal(result.items.find((item) => item.id === localEdited.id)?.attempts.length, 1);
  assert.deepEqual(result.externalAnswerBatches.map((batch) => batch.id), ['batch-local']);
  assert.equal(result.externalAnswerBatchesImported, 0);
});

test('importQuestionBankBackup imports external answer batch history when present', () => {
  const [first, second] = buildQuestionBankItems(importedQuestions, context);
  const backup = createQuestionBankBackup([first, second], '2026-07-03T12:00:00.000Z', [
    {
      id: 'batch-imported',
      sourceKind: 'tec',
      sourceName: 'Caderno importado',
      appliedAt: '2026-07-03T12:30:00.000Z',
      changedIds: [first.id, second.id],
      applied: 2,
      unmatched: 0,
    },
  ]);

  const result = importQuestionBankBackup([], backup, [
    {
      id: 'batch-local',
      sourceKind: 'tec',
      sourceName: 'Caderno local',
      appliedAt: '2026-07-03T11:00:00.000Z',
      changedIds: ['qb_local'],
      applied: 1,
      unmatched: 0,
    },
  ]);

  assert.equal(result.externalAnswerBatchesImported, 1);
  assert.deepEqual(result.externalAnswerBatches.map((batch) => batch.id), ['batch-imported', 'batch-local']);
});

test('syncQuestionBankItemProgress stores answer attempts and favorite changes by bank id', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);

  const answered = syncQuestionBankItemProgress(
    [bankItem],
    {
      localId: bankItem.id,
      answer: 'E',
      isCorrect: false,
      correctAnswer: 'C',
      favorite: true,
    },
    { answer: 'E', favorite: true },
    '2026-07-03T13:00:00.000Z',
  );

  assert.equal(answered.changed, true);
  assert.equal(answered.attemptAdded, true);
  assert.equal(answered.items[0].favorite, true);
  assert.deepEqual(answered.items[0].attempts, [
    { answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T13:00:00.000Z' },
  ]);
});

test('syncQuestionBankItemProgress stores doubt flag and observations by bank id', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);

  const result = syncQuestionBankItemProgress(
    [bankItem],
    {
      localId: bankItem.id,
      answer: '',
      isCorrect: null,
      correctAnswer: 'C',
      favorite: false,
      hasDoubt: true,
      observations: 'Confundi difuso com concentrado.',
    },
    { hasDoubt: true, observations: 'Confundi difuso com concentrado.' },
    '2026-07-03T13:10:00.000Z',
  );

  assert.equal(result.changed, true);
  assert.equal(result.items[0].hasDoubt, true);
  assert.equal(result.items[0].observations, 'Confundi difuso com concentrado.');
  assert.equal(result.items[0].updatedAt, '2026-07-03T13:10:00.000Z');
});

test('syncQuestionBankItemProgress updates the latest attempt when correctness is set after answering', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);
  const withAttempt = {
    ...bankItem,
    attempts: [{ answer: 'C', isCorrect: null, attemptedAt: '2026-07-03T13:00:00.000Z' }],
  };

  const result = syncQuestionBankItemProgress(
    [withAttempt],
    {
      localId: bankItem.id,
      answer: 'C',
      isCorrect: true,
      correctAnswer: 'C',
    },
    { isCorrect: true },
    '2026-07-03T13:05:00.000Z',
  );

  assert.equal(result.changed, true);
  assert.equal(result.attemptAdded, false);
  assert.deepEqual(result.items[0].attempts, [
    { answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T13:00:00.000Z' },
  ]);
});

test('resetQuestionBankItemAttempts clears attempts for one bank item only', () => {
  const [first, second] = buildQuestionBankItems(importedQuestions, context);
  const answeredFirst = {
    ...first,
    attempts: [
      { answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T13:00:00.000Z' },
      { answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T13:05:00.000Z' },
    ],
  };
  const answeredSecond = {
    ...second,
    attempts: [{ answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T13:10:00.000Z' }],
  };

  const result = resetQuestionBankItemAttempts(
    [answeredFirst, answeredSecond],
    answeredFirst.id,
    '2026-07-03T13:30:00.000Z',
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.items[0].attempts, []);
  assert.equal(result.items[0].updatedAt, '2026-07-03T13:30:00.000Z');
  assert.equal(result.items[1].attempts.length, 1);
});

test('resetQuestionBankItemAttempts is unchanged for missing or unanswered items', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);

  assert.equal(resetQuestionBankItemAttempts([bankItem], 'missing').changed, false);
  assert.equal(resetQuestionBankItemAttempts([bankItem], bankItem.id).changed, false);
});

test('answerQuestionBankItemInline records a corrected attempt by bank item id', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);

  const result = answerQuestionBankItemInline([bankItem], bankItem.id, 'C', '2026-07-03T14:00:00.000Z');

  assert.equal(result.changed, true);
  assert.deepEqual(result.items[0].attempts, [
    { answer: 'C', isCorrect: true, attemptedAt: '2026-07-03T14:00:00.000Z' },
  ]);
  assert.equal(result.items[0].updatedAt, '2026-07-03T14:00:00.000Z');
});

test('answerQuestionBankItemInline handles wrong and uncorrected attempts', () => {
  const [withAnswer, withoutAnswer] = buildQuestionBankItems(importedQuestions, context);
  const uncorrected = { ...withoutAnswer, id: 'qb_sem_gabarito', correctAnswer: undefined };

  const result = answerQuestionBankItemInline(
    [withAnswer, uncorrected],
    uncorrected.id,
    'B',
    '2026-07-03T14:05:00.000Z',
  );
  const wrong = answerQuestionBankItemInline(
    [withAnswer],
    withAnswer.id,
    'E',
    '2026-07-03T14:10:00.000Z',
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.items[1].attempts, [
    { answer: 'B', isCorrect: null, attemptedAt: '2026-07-03T14:05:00.000Z' },
  ]);
  assert.deepEqual(wrong.items[0].attempts, [
    { answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T14:10:00.000Z' },
  ]);
});

test('answerQuestionBankItemInline ignores missing item or empty answer', () => {
  const [bankItem] = buildQuestionBankItems(importedQuestions, context);

  assert.equal(answerQuestionBankItemInline([bankItem], 'missing', 'A').changed, false);
  assert.equal(answerQuestionBankItemInline([bankItem], bankItem.id, '').changed, false);
});

test('getQuestionBankAnswerOptions returns visible answer options with a safe limit', () => {
  const [, bankItem] = buildQuestionBankItems(importedQuestions, context);
  const extended = {
    ...bankItem,
    alternatives: [
      ...bankItem.alternatives,
      { label: 'E', text: 'Inclui crédito adicional.' },
      { label: 'F', text: 'Inclui orçamento monetário.' },
    ],
  };

  assert.deepEqual(getQuestionBankAnswerOptions(extended, 3), [
    { label: 'A', text: 'Somente orçamento fiscal.' },
    { label: 'B', text: 'Somente investimento.' },
    { label: 'C', text: 'Fiscal, investimento e seguridade.' },
  ]);
  assert.deepEqual(getQuestionBankAnswerOptions(extended, 0), []);
  assert.equal(extended.alternatives.length, 6);
});

test('resolveMergedQuestionBankItems keeps executable questions linked to the stored bank ids', () => {
  const incoming = buildQuestionBankItems(importedQuestions, context);
  const existingFirst = {
    ...incoming[0],
    id: 'qb_existing_local_id',
    favorite: true,
    attempts: [{ answer: 'E', isCorrect: false, attemptedAt: '2026-07-03T13:00:00.000Z' }],
  };
  const merged = mergeQuestionBankItems([existingFirst], incoming);
  const executableItems = resolveMergedQuestionBankItems(incoming, merged.items);

  assert.equal(executableItems.length, 2);
  assert.equal(executableItems[0].id, 'qb_existing_local_id');
  assert.equal(executableItems[0].favorite, true);
  assert.equal(executableItems[0].attempts.length, 1);
  assert.deepEqual(executableItems.map((item) => item.sourceQuestionNumber), [1, 2]);
});
