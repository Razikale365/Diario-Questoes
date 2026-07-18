import assert from 'node:assert/strict';
import test from 'node:test';

import { PlannerTask } from '../types';
import {
  DEFAULT_PLANNER_TASK_COLUMNS,
  DEFAULT_PLANNER_TASK_TABLE_PREFERENCES,
  movePlannerTaskColumn,
  nextPlannerTaskSort,
  parsePlannerTaskTablePreferences,
  PLANNER_TASK_TABLE_PREFERENCES_KEY,
  setPlannerTaskColumnHidden,
  sortPlannerTasks,
} from './plannerTaskTablePreferences';

const task = (id: string, number: number, overrides: Partial<PlannerTask> = {}): PlannerTask => ({
  id,
  number,
  discipline: 'Direito Tributário',
  format: 'Exercícios',
  description: `Tarefa ${number}`,
  spentMinutes: 0,
  estimatedMinutes: 30,
  performance: null,
  status: 'pending',
  relevance: 5,
  durationMinutes: 30,
  source: 'manual',
  createdAt: '2026-07-17T00:00:00.000Z',
  updatedAt: '2026-07-17T00:00:00.000Z',
  ...overrides,
});

test('uses a versioned key and safe defaults for absent, malformed, or old data', () => {
  assert.equal(PLANNER_TASK_TABLE_PREFERENCES_KEY, 'ls_planner_task_table_preferences_v1');
  for (const raw of [null, '', '{', JSON.stringify({ version: 2 })]) {
    assert.deepEqual(parsePlannerTaskTablePreferences(raw), DEFAULT_PLANNER_TASK_TABLE_PREFERENCES);
  }
  assert.equal(DEFAULT_PLANNER_TASK_COLUMNS.includes('actions' as never), false);
});

test('filters unknown ids, removes duplicates, and appends missing columns in default order', () => {
  const parsed = parsePlannerTaskTablePreferences(JSON.stringify({
    version: 1,
    order: ['description', 'unknown', 'description', 'number'],
    hidden: ['format', 'unknown', 'format'],
    sort: { column: 'relevance', direction: 'desc' },
  }));
  assert.deepEqual(parsed.order, [
    'description', 'number', 'discipline', 'format', 'duration',
    'performance', 'status', 'relevance', 'schedule',
  ]);
  assert.deepEqual(parsed.hidden, ['format']);
  assert.deepEqual(parsed.sort, { column: 'relevance', direction: 'desc' });
});

test('malformed visibility cannot blank every data column', () => {
  const parsed = parsePlannerTaskTablePreferences(JSON.stringify({
    version: 1,
    order: DEFAULT_PLANNER_TASK_COLUMNS,
    hidden: DEFAULT_PLANNER_TASK_COLUMNS,
    sort: { column: 'actions', direction: 'asc' },
  }));
  assert.equal(parsed.hidden.length, DEFAULT_PLANNER_TASK_COLUMNS.length - 1);
  assert.equal(parsed.hidden.includes('number'), false);
  assert.equal(parsed.sort, null);
});

test('moves columns and hides or shows configurable values', () => {
  const moved = movePlannerTaskColumn(DEFAULT_PLANNER_TASK_TABLE_PREFERENCES, 'description', 'number');
  assert.equal(moved.order[0], 'description');
  assert.deepEqual(DEFAULT_PLANNER_TASK_TABLE_PREFERENCES.order, DEFAULT_PLANNER_TASK_COLUMNS);

  const hidden = setPlannerTaskColumnHidden(moved, 'format', true);
  assert.deepEqual(hidden.hidden, ['format']);
  const shown = setPlannerTaskColumnHidden(hidden, 'format', false);
  assert.deepEqual(shown.hidden, []);
});

test('refuses to hide the last visible data column', () => {
  const almostAllHidden = {
    ...DEFAULT_PLANNER_TASK_TABLE_PREFERENCES,
    hidden: DEFAULT_PLANNER_TASK_COLUMNS.filter((column) => column !== 'description'),
  };
  assert.equal(setPlannerTaskColumnHidden(almostAllHidden, 'description', true), almostAllHidden);
});

test('cycles asc desc and unsorted without moving missing values first', () => {
  assert.deepEqual(nextPlannerTaskSort(null, 'performance'), { column: 'performance', direction: 'asc' });
  assert.deepEqual(nextPlannerTaskSort({ column: 'performance', direction: 'asc' }, 'performance'), { column: 'performance', direction: 'desc' });
  assert.equal(nextPlannerTaskSort({ column: 'performance', direction: 'desc' }, 'performance'), null);

  const fixtures = [
    task('missing', 3),
    task('low', 2, { performance: 60 }),
    task('high', 1, { performance: 90 }),
  ];
  assert.deepEqual(sortPlannerTasks(fixtures, { column: 'performance', direction: 'desc' }).map((item) => item.id), ['high', 'low', 'missing']);
  assert.deepEqual(sortPlannerTasks(fixtures, { column: 'performance', direction: 'asc' }).map((item) => item.id), ['low', 'high', 'missing']);
});

test('sorts every public value and uses number then id for deterministic ties', () => {
  const fixtures = [
    task('z', 2, { discipline: 'B', scheduledDate: undefined }),
    task('b', 1, { discipline: 'A', scheduledDate: '2026-07-18', startTime: '10:00' }),
    task('a', 1, { discipline: 'A', scheduledDate: '2026-07-18', startTime: '10:00' }),
  ];
  assert.deepEqual(sortPlannerTasks(fixtures, { column: 'discipline', direction: 'asc' }).map((item) => item.id), ['a', 'b', 'z']);
  assert.deepEqual(sortPlannerTasks(fixtures, { column: 'schedule', direction: 'desc' }).map((item) => item.id), ['a', 'b', 'z']);
  assert.deepEqual(sortPlannerTasks(fixtures, null), fixtures);
});
