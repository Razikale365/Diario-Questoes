import assert from 'node:assert/strict';
import test from 'node:test';

import {
  currentSourcePlanTasks,
  externalSourceTaskId,
  mergeRestoredSourcePlanTasks,
  plannerTaskFromSourcePlan,
  sourcePlanTaskInput,
  sourceTaskKind,
} from './sourcePlanBridge';


test('persisted LS tasks hydrate the calendar without losing execution state', () => {
  const task = plannerTaskFromSourcePlan({
    id: 4,
    targetSlug: 'sefaz_ce',
    sourceKind: 'ls',
    externalTaskId: 'meta-47-29',
    planLabel: 'Meta 47',
    metaNumber: 47,
    scheduledDate: '2026-07-14',
    sourceOrder: 29,
    discipline: 'Legislacao Tributaria Estadual',
    subjectKey: 'p2_lte',
    mappingStatus: 'matched',
    topicHint: 'Lei 18.665/2023',
    taskKind: 'review',
    description: 'Revisao intermediaria',
    details: 'Refazer erros e duvidas.',
    materialHint: 'PDF original',
    estimatedMinutes: 60,
    spentMinutes: 12,
    relevance: 10,
    status: 'started',
    performanceBp: 7000,
    linkedStudyTaskId: 'study-task-1',
    provenance: {
      browserTaskId: 'meta-47-29',
      plannerSource: 'ls-meta-text',
      planejamento: 'SEFAZ CE Pos-edital',
      startTime: '08:00',
      format: 'PDF + questoes',
      createdAt: '2026-07-12T12:00:00.000Z',
      updatedAt: '2026-07-13T12:00:00.000Z',
      plannedQuestions: 10,
      tecUrl: 'https://www.tecconcursos.com.br/s/Q6XHkN',
    },
    version: 2,
  });

  assert.equal(task.id, 'meta-47-29');
  assert.equal(task.number, 29);
  assert.equal(task.scheduledDate, '2026-07-14');
  assert.equal(task.startTime, '08:00');
  assert.equal(task.status, 'started');
  assert.equal(task.performance, 70);
  assert.equal(task.plannerSourceKind, 'ls');
  assert.equal(task.plannedBlockKind, 'review');
  assert.equal(task.plannedQuestions, 10);
  assert.equal(task.sourceUrl, 'https://www.tecconcursos.com.br/s/Q6XHkN');
  assert.equal(task.linkedStudyTaskId, 'study-task-1');
});

test('manual and trilha source kinds remain distinct after hydration', () => {
  const base = {
    id: 5,
    targetSlug: 'sefaz_ce',
    externalTaskId: 'task-5',
    planLabel: 'Trilha',
    metaNumber: null,
    scheduledDate: null,
    sourceOrder: 5,
    discipline: 'Economia',
    subjectKey: 'p1_economia',
    mappingStatus: 'matched' as const,
    topicHint: '',
    taskKind: 'questions' as const,
    description: 'Questões FCC',
    details: '',
    materialHint: '',
    estimatedMinutes: 45,
    spentMinutes: 0,
    relevance: 7,
    status: 'pending' as const,
    performanceBp: null,
    linkedStudyTaskId: null,
    provenance: {},
    version: 1,
  };

  assert.equal(plannerTaskFromSourcePlan({ ...base, sourceKind: 'trilha' }).plannerSourceKind, 'trilha_estrategica');
  assert.equal(plannerTaskFromSourcePlan({ ...base, sourceKind: 'manual' }).source, 'manual');
});

test('calendar restoration selects the latest numbered meta but keeps unnumbered plans usable', () => {
  const task = {
    id: 5,
    targetSlug: 'sefaz_ce',
    sourceKind: 'ls' as const,
    externalTaskId: 'task-5',
    planLabel: 'Meta 47',
    metaNumber: 47,
    scheduledDate: null,
    sourceOrder: 5,
    discipline: 'Economia',
    subjectKey: 'p1_economia',
    mappingStatus: 'matched' as const,
    topicHint: '',
    taskKind: 'questions' as const,
    description: 'Questões FCC',
    details: '',
    materialHint: '',
    estimatedMinutes: 45,
    spentMinutes: 0,
    relevance: 7,
    status: 'pending' as const,
    performanceBp: null,
    linkedStudyTaskId: null,
    provenance: {},
    version: 1,
  };

  assert.deepEqual(
    currentSourcePlanTasks([
      { ...task, id: 1, externalTaskId: 'meta-46', metaNumber: 46 },
      { ...task, id: 2, externalTaskId: 'meta-47', metaNumber: 47 },
      { ...task, id: 3, externalTaskId: 'manual', metaNumber: null },
    ]).map((item) => item.externalTaskId),
    ['meta-47'],
  );
  assert.equal(currentSourcePlanTasks([{ ...task, metaNumber: null }]).length, 1);
});

test('SQLite restoration replaces a stale LS meta without overwriting a newer local import', () => {
  const plannerTask = (id: string, metaNumber: number, status: 'pending' | 'completed') => ({
    id,
    number: 1,
    metaNumber,
    discipline: 'Economia',
    format: 'Questões',
    description: `Meta ${metaNumber}`,
    spentMinutes: 0,
    estimatedMinutes: 60,
    performance: null,
    status,
    relevance: 8,
    durationMinutes: 60,
    source: 'ls-meta-text' as const,
    plannerSourceKind: 'ls' as const,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  });
  const manual = { ...plannerTask('manual', 1, 'pending'), metaNumber: undefined, source: 'manual' as const, plannerSourceKind: 'manual' as const };
  const persisted47 = plannerTask('persisted-47', 47, 'pending');

  assert.deepEqual(
    mergeRestoredSourcePlanTasks([plannerTask('stale-46', 46, 'completed'), manual], [persisted47])
      .map((task) => task.id),
    ['manual', 'persisted-47'],
  );
  assert.deepEqual(
    mergeRestoredSourcePlanTasks([plannerTask('local-48', 48, 'pending')], [persisted47])
      .map((task) => task.id),
    ['local-48'],
  );
});

test('SQLite restoration keeps a newer local edit for the same LS task', () => {
  const base = {
    id: 'meta-47-task-29',
    number: 29,
    metaNumber: 47,
    discipline: 'LTE',
    format: 'Revisao',
    description: 'Texto persistido antigo',
    spentMinutes: 0,
    estimatedMinutes: 60,
    performance: null,
    status: 'pending' as const,
    relevance: 10,
    durationMinutes: 60,
    source: 'ls-meta-text' as const,
    plannerSourceKind: 'ls' as const,
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
  };
  const local = {
    ...base,
    description: 'Edicao local mais recente',
    status: 'started' as const,
    updatedAt: '2026-07-13T12:00:00.000Z',
  };

  const merged = mergeRestoredSourcePlanTasks([local], [base]);

  assert.equal(merged[0]?.description, 'Edicao local mais recente');
  assert.equal(merged[0]?.status, 'started');
  assert.equal(merged[0]?.updatedAt, '2026-07-13T12:00:00.000Z');
});

test('LS task identity is deterministic across browser imports', () => {
  assert.equal(externalSourceTaskId({
    id: 'old-random-browser-id',
    number: 29,
    metaNumber: 47,
    discipline: 'LTE',
    format: 'Revisão',
    description: 'Revisão VI',
    spentMinutes: 0,
    estimatedMinutes: 60,
    performance: null,
    status: 'pending',
    relevance: 10,
    durationMinutes: 60,
    source: 'ls-meta-text',
    targetSlug: 'sefaz_ce',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  }), 'ls-sefaz-ce-meta-47-task-29');
});

test('discursive LS tasks are transversal even when the description only says textual practice', () => {
  assert.equal(sourceTaskKind({
    id: 'meta-47-task-22',
    number: 22,
    discipline: 'Discursivas',
    format: 'Prática',
    description: 'Prática de produção textual',
    spentMinutes: 0,
    estimatedMinutes: 60,
    performance: null,
    status: 'pending',
    relevance: 8,
    durationMinutes: 60,
    source: 'ls-meta-text',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  }), 'discursive');
});

test('source-plan persistence keeps zero performance and zero relevance as evidence', () => {
  const task = sourcePlanTaskInput({
    id: 'meta-47-task-30',
    number: 30,
    discipline: 'Direito Financeiro',
    format: 'Questões',
    description: 'AFO',
    spentMinutes: 20,
    estimatedMinutes: 60,
    performance: 0,
    status: 'completed',
    relevance: 0,
    durationMinutes: 60,
    source: 'ls-meta-text',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  });

  assert.equal(task.performanceBp, 0);
  assert.equal(task.relevance, 0);
});

test('source-plan bridge round-trips a valid zero meta number', () => {
  const hydrated = plannerTaskFromSourcePlan({
    id: 30,
    targetSlug: 'sefaz_ce',
    sourceKind: 'ls',
    externalTaskId: 'meta-zero-task-zero',
    planLabel: 'Meta 0',
    metaNumber: 0,
    scheduledDate: '2026-07-13',
    sourceOrder: 0,
    discipline: 'Lingua Portuguesa',
    subjectKey: 'p1_portugues',
    mappingStatus: 'matched',
    topicHint: '',
    taskKind: 'questions',
    description: 'Diagnostico inicial',
    details: '',
    materialHint: '',
    estimatedMinutes: 30,
    spentMinutes: 0,
    relevance: 5,
    status: 'pending',
    performanceBp: null,
    linkedStudyTaskId: null,
    provenance: {},
    version: 1,
  });
  const persisted = sourcePlanTaskInput(hydrated);

  assert.equal(hydrated.metaNumber, 0);
  assert.equal(persisted.externalTaskId, 'ls-sefaz-ce-meta-0-task-0');
  assert.equal(persisted.provenance?.metaNumber, 0);
  assert.equal(persisted.sourceOrder, 0);
});
