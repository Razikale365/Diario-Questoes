import { StudyTask } from '../types';
import { normalizeTaskBlocksLayout } from './layout';

export interface TaskBackupMergeResult {
  tasks: StudyTask[];
  added: number;
  duplicates: number;
}

export const parseStudyTaskBackup = (value: unknown): StudyTask[] => {
  if (!Array.isArray(value)) {
    throw new Error('Backup de tarefas inválido.');
  }

  return value.map((task) => normalizeTaskBlocksLayout(task as StudyTask));
};

export const mergeStudyTaskBackup = (
  currentTasks: StudyTask[],
  incomingTasks: StudyTask[],
): TaskBackupMergeResult => {
  const mergedTasks = currentTasks.map(normalizeTaskBlocksLayout);
  const existingIds = new Set(mergedTasks.map((task) => task.id));
  let added = 0;
  let duplicates = 0;

  incomingTasks.map(normalizeTaskBlocksLayout).forEach((task) => {
    if (existingIds.has(task.id)) {
      duplicates += 1;
      return;
    }

    mergedTasks.push(task);
    existingIds.add(task.id);
    added += 1;
  });

  return {
    tasks: mergedTasks,
    added,
    duplicates,
  };
};
