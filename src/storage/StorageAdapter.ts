import { StudyTask } from '../types';
import { STUDY_TASKS_STORAGE_KEY } from '../utils/taskQuestionImportStorage';

export interface StorageAdapter {
  readTasks(): StudyTask[];
  writeTasks(tasks: StudyTask[]): void;
  readActiveTaskId(): string | null;
  writeActiveTaskId(id: string | null): void;
}

export class LocalStorageAdapter implements StorageAdapter {
  readTasks(): StudyTask[] {
    try {
      const saved = localStorage.getItem(STUDY_TASKS_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as StudyTask[]) : [];
    } catch {
      return [];
    }
  }

  writeTasks(tasks: StudyTask[]): void {
    try {
      localStorage.setItem(STUDY_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('[LocalStorageAdapter] Failed to save tasks', e);
    }
  }

  readActiveTaskId(): string | null {
    try {
      return localStorage.getItem('ls_active_task_v2') || null;
    } catch {
      return null;
    }
  }

  writeActiveTaskId(id: string | null): void {
    try {
      if (id) {
        localStorage.setItem('ls_active_task_v2', id);
      } else {
        localStorage.removeItem('ls_active_task_v2');
      }
    } catch (e) {
      console.error('[LocalStorageAdapter] Failed to save active task id', e);
    }
  }
}
