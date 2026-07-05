import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerMetaHistoryEntry, PlannerTask } from '../types';
import { generateNextMetaDraft, materializeDraftTasks, summarizeDraftTasks } from './plannerGenerator';

const task = (overrides: Partial<PlannerTask> & Pick<PlannerTask, 'discipline' | 'number'>): PlannerTask => {
  const durationMinutes = overrides.durationMinutes || 60;
  return {
    id: `${overrides.discipline}-${overrides.number}`,
    format: 'Revisão e Exercícios',
    description: 'Conteúdo da tarefa',
    spentMinutes: 0,
    estimatedMinutes: durationMinutes,
    performance: 0,
    status: 'pending',
    relevance: 8,
    durationMinutes,
    source: 'ls-meta-text',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
};

const historyEntry = (id: string, tasks: PlannerTask[]): PlannerMetaHistoryEntry => ({
  id,
  meta: {
    id,
    title: `Meta ${id}`,
    totalTasks: tasks.length,
    totalDisciplines: new Set(tasks.map((item) => item.discipline)).size,
    completedPercent: 0,
    completedTasks: 0,
    pendingTasks: tasks.length,
    ignoredTasks: 0,
    startedTasks: 0,
    importedAt: '2026-06-01T00:00:00.000Z',
  },
  tasks,
  archivedAt: '2026-06-01T00:00:00.000Z',
});

test('generateNextMetaDraft carries priority pending tasks and retakes neglected disciplines within limits', () => {
  const current = [
    task({ number: 1, discipline: 'Direito Financeiro', durationMinutes: 120, relevance: 10 }),
    task({ number: 2, discipline: 'Português', durationMinutes: 30, relevance: 9 }),
  ];
  const history = [
    historyEntry('44', [
      task({ number: 1, discipline: 'LTE', durationMinutes: 60, relevance: 9 }),
      task({ number: 2, discipline: 'Direito Financeiro', durationMinutes: 60, relevance: 8 }),
    ]),
  ];

  const draft = generateNextMetaDraft(current, history, {
    weeklyHours: 4,
    maxTasks: 4,
    currentMetaId: '45',
  });

  assert.equal(draft.totalTasks, 3);
  assert.ok(draft.totalMinutes <= 240);
  assert.equal(draft.tasks[0].reason, 'carry-pending');
  assert.ok(draft.tasks.some((item) => item.discipline === 'LTE' && item.reason === 'retake'));
  assert.ok(draft.allocations.some((item) => item.discipline === 'Direito Financeiro'));
});

test('materializeDraftTasks converts a draft to executable planner tasks', () => {
  const materialized = materializeDraftTasks([
    {
      discipline: 'Português',
      format: 'Revisão e Exercícios',
      description: 'Revisão curta',
      durationMinutes: 45,
      relevance: 9,
      reason: 'rebalance',
    },
  ], {
    planejamento: 'Planner Receita',
    metaNumber: 46,
  });

  assert.equal(materialized.length, 1);
  assert.equal(materialized[0].source, 'generated');
  assert.equal(materialized[0].planejamento, 'Planner Receita');
  assert.equal(materialized[0].metaNumber, 46);
  assert.equal(materialized[0].status, 'pending');
});

test('summarizeDraftTasks recalculates totals after manual draft edits', () => {
  const draft = summarizeDraftTasks([
    {
      discipline: 'Português',
      format: 'Revisão e Exercícios',
      description: 'Editada',
      durationMinutes: 30,
      relevance: 10,
      reason: 'rebalance',
    },
    {
      discipline: 'Direito Financeiro',
      format: 'Revisão e Exercícios',
      description: 'Pendência',
      durationMinutes: 90,
      relevance: 8,
      reason: 'carry-pending',
    },
  ]);

  assert.equal(draft.totalTasks, 2);
  assert.equal(draft.totalMinutes, 120);
  assert.equal(draft.allocations[0].discipline, 'Direito Financeiro');
  assert.equal(draft.allocations[1].relevance, 10);
});
