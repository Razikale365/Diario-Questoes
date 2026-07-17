import { QuestionBankItem, StudyTask } from '../types';
import { QUESTION_BANK_STORAGE_KEY } from './questionBank';

export const STUDY_TASKS_STORAGE_KEY = 'ls_tasks_v2';

export interface TaskQuestionImportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistTaskQuestionImportInput {
  storage: TaskQuestionImportStorage;
  tasks: StudyTask[];
  questionBank: QuestionBankItem[];
}

export type PersistTaskQuestionImportResult =
  | { ok: true }
  | { ok: false; error: Error; rollbackErrors: Error[] };

const toError = (value: unknown) => value instanceof Error ? value : new Error(String(value));

const restore = (storage: TaskQuestionImportStorage, key: string, value: string | null) => {
  if (value === null) storage.removeItem(key);
  else storage.setItem(key, value);
};

export const persistTaskQuestionImportSnapshot = (
  input: PersistTaskQuestionImportInput,
): PersistTaskQuestionImportResult => {
  let serializedTasks: string;
  let serializedQuestionBank: string;
  try {
    serializedTasks = JSON.stringify(input.tasks);
    serializedQuestionBank = JSON.stringify(input.questionBank);
  } catch (error) {
    return { ok: false, error: toError(error), rollbackErrors: [] };
  }

  let previousTasks: string | null;
  let previousQuestionBank: string | null;
  try {
    previousTasks = input.storage.getItem(STUDY_TASKS_STORAGE_KEY);
    previousQuestionBank = input.storage.getItem(QUESTION_BANK_STORAGE_KEY);
  } catch (error) {
    return { ok: false, error: toError(error), rollbackErrors: [] };
  }

  try {
    input.storage.setItem(STUDY_TASKS_STORAGE_KEY, serializedTasks);
    input.storage.setItem(QUESTION_BANK_STORAGE_KEY, serializedQuestionBank);
    return { ok: true };
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const [key, value] of [
      [STUDY_TASKS_STORAGE_KEY, previousTasks],
      [QUESTION_BANK_STORAGE_KEY, previousQuestionBank],
    ] as const) {
      try {
        restore(input.storage, key, value);
      } catch (rollbackError) {
        rollbackErrors.push(toError(rollbackError));
      }
    }
    return { ok: false, error: toError(error), rollbackErrors };
  }
};
