import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerMetaHistoryEntry, PlannerTask } from '../types';
import { buildPlannerInsights } from './plannerInsights';

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
    completedTasks: tasks.filter((item) => item.status === 'completed').length,
    pendingTasks: tasks.filter((item) => item.status === 'pending').length,
    ignoredTasks: tasks.filter((item) => item.status === 'ignored').length,
    startedTasks: tasks.filter((item) => item.status === 'started').length,
    importedAt: '2026-06-01T00:00:00.000Z',
  },
  tasks,
  archivedAt: '2026-06-01T00:00:00.000Z',
});

test('buildPlannerInsights flags overload, high relevance pending, and neglected disciplines', () => {
  const history = [
    historyEntry('44', [
      task({ number: 1, discipline: 'Direito Financeiro', durationMinutes: 60, relevance: 7 }),
      task({ number: 2, discipline: 'Português', durationMinutes: 60, relevance: 8 }),
      task({ number: 3, discipline: 'LTE', durationMinutes: 60, relevance: 9 }),
    ]),
    historyEntry('43', [
      task({ number: 1, discipline: 'Direito Financeiro', durationMinutes: 60, relevance: 7 }),
      task({ number: 2, discipline: 'Português', durationMinutes: 60, relevance: 8 }),
      task({ number: 3, discipline: 'LTE', durationMinutes: 60, relevance: 9 }),
    ]),
  ];
  const current = [
    task({ number: 1, discipline: 'Direito Financeiro', durationMinutes: 120, relevance: 9 }),
    task({ number: 2, discipline: 'Direito Financeiro', durationMinutes: 120, relevance: 9 }),
    task({ number: 3, discipline: 'Direito Financeiro', durationMinutes: 120, relevance: 9 }),
    task({ number: 4, discipline: 'Direito Financeiro', durationMinutes: 120, relevance: 9 }),
    task({ number: 5, discipline: 'Português', durationMinutes: 30, relevance: 10 }),
  ];

  const result = buildPlannerInsights(current, history, '45');
  const financeiro = result.disciplineInsights.find((item) => item.discipline === 'Direito Financeiro');
  const portugues = result.disciplineInsights.find((item) => item.discipline === 'Português');
  const lte = result.disciplineInsights.find((item) => item.discipline === 'LTE');

  assert.equal(result.highRelevancePending, 5);
  assert.equal(financeiro?.loadState, 'overloaded');
  assert.equal(financeiro?.trend, 'up');
  assert.equal(portugues?.loadState, 'underloaded');
  assert.equal(lte?.loadState, 'neglected');
  assert.ok(result.recommendations.some((item) => item.includes('Direito Financeiro')));
});
