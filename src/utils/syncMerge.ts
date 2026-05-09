import { StudyTask } from '../types';

export interface SyncMergeResult {
  merged: StudyTask[];
  hadLocalWinner: boolean;
  localWins: number;
  remoteWins: number;
}

const timestampOf = (task: StudyTask): number => (
  task.updatedAt ? new Date(task.updatedAt).getTime() : 0
);

export const mergeTasksForSync = (remote: StudyTask[], local: StudyTask[]): SyncMergeResult => {
  const remoteMap = new Map(remote.map(task => [task.id, task]));
  const localMap = new Map(local.map(task => [task.id, task]));

  const merged: StudyTask[] = [];
  let localWins = 0;
  let remoteWins = 0;

  for (const remoteTask of remote) {
    const localTask = localMap.get(remoteTask.id);

    if (!localTask) {
      merged.push(remoteTask);
      remoteWins += 1;
      continue;
    }

    if (timestampOf(localTask) > timestampOf(remoteTask)) {
      merged.push(localTask);
      localWins += 1;
    } else {
      merged.push(remoteTask);
      remoteWins += 1;
    }
  }

  for (const localTask of local) {
    if (!remoteMap.has(localTask.id)) {
      merged.push(localTask);
      localWins += 1;
    }
  }

  return {
    merged,
    hadLocalWinner: localWins > 0,
    localWins,
    remoteWins
  };
};
