import assert from 'node:assert/strict';
import test from 'node:test';

import { QuestionBankItem, StudyTask } from '../types';
import { QUESTION_BANK_STORAGE_KEY } from './questionBank';
import {
  persistTaskQuestionImportSnapshot,
  STUDY_TASKS_STORAGE_KEY,
  TaskQuestionImportStorage,
} from './taskQuestionImportStorage';

class MemoryStorage implements TaskQuestionImportStorage {
  readonly values = new Map<string, string>();
  failOnceOn: string | null = null;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failOnceOn === key) {
      this.failOnceOn = null;
      throw new Error(`write failed: ${key}`);
    }
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const tasks: StudyTask[] = [{
  id: 'task-next',
  date: '2026-07-13T10:00:00.000Z',
  discipline: 'Direito Tributário',
  bank: 'FCC',
  blocks: [],
  status: 'in_progress',
}];

const questionBank: QuestionBankItem[] = [{
  id: 'qb-1',
  fingerprint: 'fp-1',
  sourceQuestionNumber: 1,
  statement: 'Enunciado',
  alternatives: [{ label: 'C', text: 'Certo' }, { label: 'E', text: 'Errado' }],
  sourceKind: 'professor',
  sourceName: 'Aula 01',
  discipline: 'Direito Tributário',
  bank: 'FCC',
  tags: [],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
}];

test('persists the task array and question bank together', () => {
  const storage = new MemoryStorage();
  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.deepEqual(result, { ok: true });
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), JSON.stringify(tasks));
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), JSON.stringify(questionBank));
});

test('restores both previous values when the bank write fails', () => {
  const storage = new MemoryStorage();
  storage.values.set(STUDY_TASKS_STORAGE_KEY, '["old-task"]');
  storage.values.set(QUESTION_BANK_STORAGE_KEY, '["old-question"]');
  storage.failOnceOn = QUESTION_BANK_STORAGE_KEY;

  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.equal(result.ok, false);
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), '["old-task"]');
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), '["old-question"]');
});

test('removes a newly-created key while rolling back an absent previous bank', () => {
  const storage = new MemoryStorage();
  storage.values.set(STUDY_TASKS_STORAGE_KEY, '["old-task"]');
  storage.failOnceOn = QUESTION_BANK_STORAGE_KEY;

  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });

  assert.equal(result.ok, false);
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), '["old-task"]');
  assert.equal(storage.getItem(QUESTION_BANK_STORAGE_KEY), null);
});

test('attempts both rollbacks and reports rollback errors independently', () => {
  const storage = new MemoryStorage();
  storage.values.set(STUDY_TASKS_STORAGE_KEY, '["old-task"]');
  storage.values.set(QUESTION_BANK_STORAGE_KEY, '["old-question"]');
  let bankWrites = 0;
  storage.setItem = (key: string, value: string) => {
    if (key === QUESTION_BANK_STORAGE_KEY) {
      bankWrites += 1;
      throw new Error(`bank write ${bankWrites} failed`);
    }
    storage.values.set(key, value);
  };

  const result = persistTaskQuestionImportSnapshot({ storage, tasks, questionBank });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rollbackErrors.length, 1);
  assert.equal(storage.getItem(STUDY_TASKS_STORAGE_KEY), '["old-task"]');
});
