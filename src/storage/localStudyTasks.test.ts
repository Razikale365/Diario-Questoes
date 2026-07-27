import assert from 'node:assert/strict';
import test from 'node:test';

import type { StudyTask } from '../types';
import {
  isLocalPrivateTask,
  loadLocalStudyTasks,
  markTasksAsLocalPrivate,
  mergeLocalPrivatePackageTasks,
  migrateMatchingTasksToLocalPrivate,
  mergeSyncedTasksWithLocalPrivate,
  saveLocalStudyTasks,
  splitStudyTasksByStorageScope,
  type LocalStudyTaskStore,
} from './localStudyTasks';

const task = (id: string, storageScope?: StudyTask['storageScope']): StudyTask => ({
  id,
  date: '2026-07-25T08:00:00.000-03:00',
  discipline: 'Simulados',
  bank: 'FCC',
  blocks: [],
  status: 'in_progress',
  storageScope,
});

class MemoryLocalStudyTaskStore implements LocalStudyTaskStore {
  tasks: StudyTask[] = [];

  async load() {
    return this.tasks;
  }

  async save(tasks: StudyTask[]) {
    this.tasks = tasks;
  }
}

test('marks imported package tasks as private local data', () => {
  const [marked] = markTasksAsLocalPrivate(
    [task('package-task')],
    () => '2026-07-25T12:00:00.000Z',
  );

  assert.equal(marked.storageScope, 'local-private');
  assert.equal(marked.updatedAt, '2026-07-25T12:00:00.000Z');
  assert.equal(isLocalPrivateTask(marked), true);
});

test('migrates a previously imported matching task without losing its progress', () => {
  const existing = {
    ...task('package-task'),
    blocks: [{
      id: 'block',
      title: 'Questões',
      lesson: 'P1',
      pages: '',
      questions: [{
        number: 1,
        answer: 'B',
        isCorrect: true,
        hasDoubt: false,
      }],
    }],
  };

  const [migrated] = migrateMatchingTasksToLocalPrivate(
    [existing, task('regular')],
    [task('package-task')],
    () => '2026-07-25T13:00:00.000Z',
  );

  assert.equal(migrated.storageScope, 'local-private');
  assert.equal(migrated.blocks[0].questions[0].answer, 'B');
  assert.equal(migrated.updatedAt, '2026-07-25T13:00:00.000Z');
});

test('refreshes package content while preserving existing question progress', () => {
  const existing = {
    ...task('package-task'),
    status: 'completed' as const,
    blocks: [{
      id: 'block',
      title: 'Questões antigas',
      lesson: 'P1',
      pages: '',
      showGabarito: true,
      questions: [{
        number: 1,
        localId: 'package-task:q1',
        statement: 'Texto com rodapé incorreto. 23',
        alternatives: [{ label: 'E', text: 'Alternativa incorreta. 23' }],
        answer: 'E',
        isCorrect: true,
        hasDoubt: true,
        favorite: true,
        observations: 'Rever regra',
        eliminated: ['A'],
        doubtedAlts: ['C'],
        attempts: [{
          answer: 'E',
          isCorrect: true,
          attemptedAt: '2026-07-25T10:00:00.000Z',
        }],
      }],
    }],
  };
  const incoming = {
    ...task('package-task'),
    blocks: [{
      id: 'block',
      title: 'Questões corrigidas',
      lesson: 'P1',
      pages: '',
      showGabarito: false,
      questions: [{
        number: 1,
        localId: 'package-task:q1',
        statement: 'Texto corrigido.',
        alternatives: [{ label: 'E', text: 'Alternativa corrigida.' }],
        answer: '',
        isCorrect: null,
        hasDoubt: false,
        favorite: false,
        observations: '',
        eliminated: [],
        doubtedAlts: [],
        attempts: [],
      }],
    }],
  };

  const result = mergeLocalPrivatePackageTasks(
    [existing],
    [incoming],
    () => '2026-07-25T14:00:00.000Z',
  );
  const [refreshed] = result.tasks;
  const [question] = refreshed.blocks[0].questions;

  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 1);
  assert.equal(refreshed.storageScope, 'local-private');
  assert.equal(refreshed.updatedAt, '2026-07-25T14:00:00.000Z');
  assert.equal(refreshed.status, 'completed');
  assert.equal(refreshed.blocks[0].title, 'Questões corrigidas');
  assert.equal(refreshed.blocks[0].showGabarito, true);
  assert.equal(question.statement, 'Texto corrigido.');
  assert.equal(question.alternatives?.[0].text, 'Alternativa corrigida.');
  assert.equal(question.answer, 'E');
  assert.equal(question.isCorrect, true);
  assert.equal(question.hasDoubt, true);
  assert.equal(question.favorite, true);
  assert.equal(question.observations, 'Rever regra');
  assert.deepEqual(question.eliminated, ['A']);
  assert.deepEqual(question.doubtedAlts, ['C']);
  assert.equal(question.attempts?.length, 1);
});

test('separates private package tasks from the cloud-synced task snapshot', () => {
  const split = splitStudyTasksByStorageScope([
    task('regular'),
    task('private', 'local-private'),
  ]);

  assert.deepEqual(split.synced.map(({ id }) => id), ['regular']);
  assert.deepEqual(split.localPrivate.map(({ id }) => id), ['private']);
});

test('preserves private tasks when a cloud pull replaces synced tasks', () => {
  const merged = mergeSyncedTasksWithLocalPrivate(
    [task('remote'), task('private')],
    [task('old-regular'), task('private', 'local-private')],
  );

  assert.deepEqual(merged.map(({ id }) => id), ['remote', 'private']);
  assert.equal(merged[1].storageScope, 'local-private');
});

test('persists and reloads only private tasks from the local task store', async () => {
  const store = new MemoryLocalStudyTaskStore();

  await saveLocalStudyTasks(
    [task('regular'), task('private', 'local-private')],
    store,
  );

  assert.deepEqual(store.tasks.map(({ id }) => id), ['private']);
  assert.deepEqual(
    (await loadLocalStudyTasks(store)).map(({ id }) => id),
    ['private'],
  );
});

test('does not erase private tasks imported by another browser tab', async () => {
  const store = new MemoryLocalStudyTaskStore();
  store.tasks = [task('private', 'local-private')];

  await saveLocalStudyTasks([task('regular')], store);

  assert.deepEqual(store.tasks.map(({ id }) => id), ['private']);
});
