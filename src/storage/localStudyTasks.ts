import type { Question, StudyTask } from '../types';

export interface LocalStudyTaskStore {
  load(): Promise<StudyTask[]>;
  save(tasks: StudyTask[]): Promise<void>;
}

interface LocalStudyTaskRecord {
  id: 'private-package';
  tasks: StudyTask[];
}

const DATABASE_NAME = 'diario-questoes-local-tasks';
const DATABASE_VERSION = 1;
const STORE_NAME = 'tasks';
const RECORD_ID = 'private-package';

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao acessar as tarefas locais.'));
  });

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir as tarefas locais.'));
  });

const browserStore: LocalStudyTaskStore = {
  async load() {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const record = await requestResult<LocalStudyTaskRecord | undefined>(
        transaction.objectStore(STORE_NAME).get(RECORD_ID),
      );
      return record?.tasks || [];
    } finally {
      database.close();
    }
  },
  async save(tasks) {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      await requestResult(
        transaction.objectStore(STORE_NAME).put({
          id: RECORD_ID,
          tasks,
        } satisfies LocalStudyTaskRecord),
      );
    } finally {
      database.close();
    }
  },
};

let browserSaveQueue: Promise<void> = Promise.resolve();

export const isLocalPrivateTask = (task: StudyTask) =>
  task.storageScope === 'local-private';

export const markTasksAsLocalPrivate = (
  tasks: StudyTask[],
  now: () => string = () => new Date().toISOString(),
) =>
  tasks.map((task) => ({
    ...task,
    storageScope: 'local-private' as const,
    updatedAt: task.updatedAt || now(),
  }));

export const migrateMatchingTasksToLocalPrivate = (
  currentTasks: StudyTask[],
  incomingTasks: StudyTask[],
  now: () => string = () => new Date().toISOString(),
) => {
  const incomingIds = new Set(incomingTasks.map((task) => task.id));
  return currentTasks.map((task) =>
    incomingIds.has(task.id)
      ? markTasksAsLocalPrivate([task], now)[0]
      : task,
  );
};

const mergeQuestionProgress = (
  incomingQuestion: Question,
  existingQuestion: Question | undefined,
): Question => {
  if (!existingQuestion) return incomingQuestion;
  return {
    ...incomingQuestion,
    answer: existingQuestion.answer,
    isCorrect: existingQuestion.isCorrect,
    hasDoubt: existingQuestion.hasDoubt,
    eliminated: existingQuestion.eliminated ?? incomingQuestion.eliminated,
    observations: existingQuestion.observations ?? incomingQuestion.observations,
    doubtedAlts: existingQuestion.doubtedAlts ?? incomingQuestion.doubtedAlts,
    favorite: existingQuestion.favorite ?? incomingQuestion.favorite,
    attempts: existingQuestion.attempts ?? incomingQuestion.attempts,
  };
};

export const mergeLocalPrivatePackageTasks = (
  currentTasks: StudyTask[],
  incomingTasks: StudyTask[],
  now: () => string = () => new Date().toISOString(),
) => {
  const privateIncomingTasks = markTasksAsLocalPrivate(incomingTasks, now);
  const incomingById = new Map(privateIncomingTasks.map((task) => [task.id, task]));
  const existingIds = new Set(currentTasks.map((task) => task.id));
  let duplicates = 0;

  const refreshedTasks = currentTasks.map((existingTask) => {
    const incomingTask = incomingById.get(existingTask.id);
    if (!incomingTask) return existingTask;
    duplicates += 1;

    const existingBlocks = new Map(
      existingTask.blocks.map((block) => [block.id, block]),
    );
    const blocks = incomingTask.blocks.map((incomingBlock) => {
      const existingBlock = existingBlocks.get(incomingBlock.id);
      if (!existingBlock) return incomingBlock;
      const existingQuestionsById = new Map(
        existingBlock.questions.map((question) => [
          question.localId || `number:${question.number}`,
          question,
        ]),
      );

      return {
        ...incomingBlock,
        isLocked: existingBlock.isLocked ?? incomingBlock.isLocked,
        showStats: existingBlock.showStats ?? incomingBlock.showStats,
        showGabarito: existingBlock.showGabarito ?? incomingBlock.showGabarito,
        layout: existingBlock.layout ?? incomingBlock.layout,
        questions: incomingBlock.questions.map((question) =>
          mergeQuestionProgress(
            question,
            existingQuestionsById.get(question.localId || `number:${question.number}`),
          ),
        ),
      };
    });

    return {
      ...incomingTask,
      blocks,
      status: existingTask.status,
      storageScope: 'local-private' as const,
      updatedAt: now(),
    };
  });

  const addedTasks = privateIncomingTasks.filter((task) => !existingIds.has(task.id));
  return {
    tasks: [...refreshedTasks, ...addedTasks],
    added: addedTasks.length,
    duplicates,
  };
};

export const splitStudyTasksByStorageScope = (tasks: StudyTask[]) => ({
  synced: tasks.filter((task) => !isLocalPrivateTask(task)),
  localPrivate: tasks.filter(isLocalPrivateTask),
});

export const mergeSyncedTasksWithLocalPrivate = (
  syncedTasks: StudyTask[],
  currentTasks: StudyTask[],
) => {
  const localPrivate = currentTasks.filter(isLocalPrivateTask);
  const localIds = new Set(localPrivate.map((task) => task.id));
  return [
    ...syncedTasks.filter((task) => !localIds.has(task.id)),
    ...localPrivate,
  ];
};

export const loadLocalStudyTasks = async (
  store: LocalStudyTaskStore = browserStore,
) => {
  const tasks = (await store.load()).filter(isLocalPrivateTask);
  if (store === browserStore) {
    console.info(`[Diário LS] Loaded ${tasks.length} private local task(s)`);
  }
  return tasks;
};

const upsertLocalStudyTasks = async (
  localPrivate: StudyTask[],
  store: LocalStudyTaskStore,
) => {
  const stored = (await store.load()).filter(isLocalPrivateTask);
  const merged = new Map(stored.map((task) => [task.id, task]));

  for (const task of localPrivate) {
    const existing = merged.get(task.id);
    const existingTime = existing?.updatedAt
      ? new Date(existing.updatedAt).getTime()
      : 0;
    const incomingTime = task.updatedAt
      ? new Date(task.updatedAt).getTime()
      : 0;
    if (!existing || incomingTime >= existingTime) {
      merged.set(task.id, task);
    }
  }

  const nextTasks = Array.from(merged.values());
  await store.save(nextTasks);
  return nextTasks.length;
};

export const saveLocalStudyTasks = (
  tasks: StudyTask[],
  store: LocalStudyTaskStore = browserStore,
) => {
  const localPrivate = tasks.filter(isLocalPrivateTask);
  if (store !== browserStore) return upsertLocalStudyTasks(localPrivate, store);

  browserSaveQueue = browserSaveQueue
    .catch(() => undefined)
    .then(async () => {
      const savedCount = await upsertLocalStudyTasks(localPrivate, browserStore);
      console.info(`[Diário LS] Saved ${savedCount} private local task(s)`);
    });
  return browserSaveQueue;
};
