import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlannerTask } from '../types';
import { filterPlannerTaskDiscovery, normalizeTaskSearch } from './unifiedTasks';

const task = (overrides: Partial<PlannerTask> = {}): PlannerTask => ({
  id: 'task-1', number: 1, discipline: 'Direito', format: 'Questões', description: 'Constituição',
  spentMinutes: 0, estimatedMinutes: 60, performance: null, status: 'pending', relevance: 8,
  durationMinutes: 60, source: 'manual', createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
  ...overrides,
});

test('task search ignores accents and combines filters with AND', () => {
  assert.equal(normalizeTaskSearch('  Constituição  '), 'constituicao');
  const result = filterPlannerTaskDiscovery([task()], { query: 'constituicao', discipline: 'Direito', view: 'pending', today: '2026-07-15' });
  assert.equal(result.length, 1);
});

test('today and completion remain distinct quick views', () => {
  const tasks = [task({ id: 'done', status: 'completed', scheduledDate: '2026-07-14' }), task({ id: 'today', scheduledDate: '2026-07-15' })];
  assert.deepEqual(filterPlannerTaskDiscovery(tasks, { query: '', discipline: '', view: 'today', today: '2026-07-15' }).map(({ id }) => id), ['today']);
  assert.deepEqual(filterPlannerTaskDiscovery(tasks, { query: '', discipline: '', view: 'completed', today: '2026-07-15' }).map(({ id }) => id), ['done']);
});
