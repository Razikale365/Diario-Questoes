import type { ActivityBlock, Question, QuestionAttempt, StudyTask } from '../types';

export interface StudyTaskSyncMergeResult {
  readonly tasks: StudyTask[];
  readonly differsFromRemote: boolean;
}

export interface StudyTaskDeduplicationResult {
  readonly tasks: StudyTask[];
  readonly removedIds: string[];
}

const timestampOf = (task: StudyTask): number => {
  const timestamp = task.updatedAt ? Date.parse(task.updatedAt) : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const questionKey = (question: Question): string => {
  if (question.localId) return `local:${question.localId}`;
  if (question.sourceQuestionNumber !== undefined) return `source:${question.sourceQuestionNumber}`;
  return `number:${question.number}`;
};

const unionStrings = (
  primary: readonly string[] | undefined,
  secondary: readonly string[] | undefined,
): string[] | undefined => {
  const values = [...new Set([...(primary ?? []), ...(secondary ?? [])])];
  return values.length > 0 ? values : undefined;
};

const mergeAttempts = (
  primary: readonly QuestionAttempt[] | undefined,
  secondary: readonly QuestionAttempt[] | undefined,
): QuestionAttempt[] | undefined => {
  const attempts = new Map<string, QuestionAttempt>();
  for (const attempt of [...(secondary ?? []), ...(primary ?? [])]) {
    attempts.set(
      `${attempt.attemptedAt}:${attempt.answer}:${String(attempt.isCorrect)}`,
      attempt,
    );
  }
  const merged = [...attempts.values()];
  return merged.length > 0 ? merged : undefined;
};

const mergeQuestion = (primary: Question, secondary: Question): Question => ({
  ...secondary,
  ...primary,
  answer: primary.answer || secondary.answer,
  isCorrect: primary.isCorrect ?? secondary.isCorrect,
  hasDoubt: primary.hasDoubt || secondary.hasDoubt,
  correctAnswer: primary.correctAnswer || secondary.correctAnswer,
  eliminated: unionStrings(primary.eliminated, secondary.eliminated),
  observations: primary.observations?.trim()
    ? primary.observations
    : secondary.observations,
  doubtedAlts: unionStrings(primary.doubtedAlts, secondary.doubtedAlts),
  favorite: primary.favorite || secondary.favorite,
  attempts: mergeAttempts(primary.attempts, secondary.attempts),
  statement: primary.statement?.trim() ? primary.statement : secondary.statement,
  alternatives: primary.alternatives?.length
    ? primary.alternatives
    : secondary.alternatives,
});

const mergeQuestions = (
  primary: readonly Question[],
  secondary: readonly Question[],
): Question[] => {
  const secondaryByKey = new Map(secondary.map((question) => [questionKey(question), question]));
  const primaryKeys = new Set(primary.map(questionKey));
  return [
    ...primary.map((question) => {
      const other = secondaryByKey.get(questionKey(question));
      return other ? mergeQuestion(question, other) : question;
    }),
    ...secondary.filter((question) => !primaryKeys.has(questionKey(question))),
  ];
};

const mergeBlocks = (
  primary: readonly ActivityBlock[],
  secondary: readonly ActivityBlock[],
): ActivityBlock[] => {
  const secondaryById = new Map(secondary.map((block) => [block.id, block]));
  const primaryIds = new Set(primary.map((block) => block.id));
  return [
    ...primary.map((block) => {
      const other = secondaryById.get(block.id);
      return other
        ? { ...other, ...block, questions: mergeQuestions(block.questions, other.questions) }
        : block;
    }),
    ...secondary.filter((block) => !primaryIds.has(block.id)),
  ];
};

const mergeSameTask = (remote: StudyTask, local: StudyTask): StudyTask => {
  const localIsNewer = timestampOf(local) > timestampOf(remote);
  const primary = localIsNewer ? local : remote;
  const secondary = localIsNewer ? remote : local;
  return {
    ...secondary,
    ...primary,
    blocks: mergeBlocks(primary.blocks, secondary.blocks),
  };
};

const normalizeIdentityPart = (value: string | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');

const plannerTaskIdentity = (task: StudyTask): string | null => {
  const requiredParts = [
    task.planejamento,
    task.meta,
    task.tarefa,
    task.discipline,
    task.assunto,
  ].map(normalizeIdentityPart);
  const date = task.date.slice(0, 10);
  if (!date || requiredParts.some((part) => !part)) return null;
  return [date, normalizeIdentityPart(task.targetSlug), ...requiredParts].join('|');
};

const hasQuestionProgress = (question: Question): boolean =>
  Boolean(
    question.answer
    || question.isCorrect !== null
    || question.hasDoubt
    || question.observations?.trim()
    || question.favorite
    || question.eliminated?.length
    || question.doubtedAlts?.length
    || question.attempts?.length,
  );

const progressCount = (task: StudyTask): number =>
  task.blocks.reduce(
    (total, block) => total + block.questions.filter(hasQuestionProgress).length,
    0,
  );

const questionCount = (task: StudyTask): number =>
  task.blocks.reduce((total, block) => total + block.questions.length, 0);

const progressFingerprint = (question: Question): string | null => {
  const statement = normalizeIdentityPart(question.statement);
  if (statement) return `statement:${statement}`;
  if (question.localId) return `local:${question.localId}`;
  if (question.sourceName && question.sourceQuestionNumber !== undefined) {
    return `source:${normalizeIdentityPart(question.sourceName)}:${question.sourceQuestionNumber}`;
  }
  return null;
};

const stringSubset = (
  subset: readonly string[] | undefined,
  superset: readonly string[] | undefined,
): boolean => (subset ?? []).every((value) => superset?.includes(value));

const questionProgressIsCovered = (canonical: Question, duplicate: Question): boolean => {
  return (
    !duplicate.answer
    || canonical.answer === duplicate.answer
  )
  && (duplicate.isCorrect === null || canonical.isCorrect === duplicate.isCorrect)
  && (!duplicate.hasDoubt || Boolean(canonical.hasDoubt))
  && (!duplicate.observations?.trim() || canonical.observations === duplicate.observations)
  && (!duplicate.favorite || Boolean(canonical.favorite))
  && stringSubset(duplicate.eliminated, canonical.eliminated)
  && stringSubset(duplicate.doubtedAlts, canonical.doubtedAlts)
  && (duplicate.attempts ?? []).every((attempt) => Boolean(canonical.attempts?.some(
    (other) => other.attemptedAt === attempt.attemptedAt
      && other.answer === attempt.answer
      && other.isCorrect === attempt.isCorrect,
  )));
};

const questionContentIsCovered = (canonical: Question, duplicate: Question): boolean => (
  (!duplicate.correctAnswer || canonical.correctAnswer === duplicate.correctAnswer)
  && (
    duplicate.isMultipleChoice === undefined
    || canonical.isMultipleChoice === duplicate.isMultipleChoice
  )
  && (!duplicate.sourceKind || canonical.sourceKind === duplicate.sourceKind)
  && (!duplicate.sourceName || canonical.sourceName === duplicate.sourceName)
  && (!duplicate.year || canonical.year === duplicate.year)
  && (!duplicate.exam || canonical.exam === duplicate.exam)
  && (!duplicate.institution || canonical.institution === duplicate.institution)
  && (
    !duplicate.sourcePage
    || (
      canonical.sourcePage?.documentId === duplicate.sourcePage.documentId
      && canonical.sourcePage.pageNumber === duplicate.sourcePage.pageNumber
      && canonical.sourcePage.likelyVisual === duplicate.sourcePage.likelyVisual
    )
  )
  && (duplicate.alternatives ?? []).every((alternative) => canonical.alternatives?.some(
    (other) => other.label === alternative.label && other.text === alternative.text,
  ))
);

const blockIdentity = (block: ActivityBlock): string => [
  normalizeIdentityPart(block.title),
  normalizeIdentityPart(block.lesson),
  normalizeIdentityPart(block.pages),
  normalizeIdentityPart(block.bank),
  String(Boolean(block.isSection)),
].join('|');

const matchingCanonicalQuestions = (
  canonical: ActivityBlock,
  duplicate: Question,
): Question[] => {
  const fingerprint = progressFingerprint(duplicate);
  if (!fingerprint) return [];
  return canonical.questions.filter(
    (question) => progressFingerprint(question) === fingerprint,
  );
};

const taskContentIsCovered = (canonical: StudyTask, duplicate: StudyTask): boolean => (
  duplicate.blocks.every((duplicateBlock) => canonical.blocks.some((canonicalBlock) => (
    blockIdentity(canonicalBlock) === blockIdentity(duplicateBlock)
    && duplicateBlock.questions.every((question) => matchingCanonicalQuestions(
      canonicalBlock,
      question,
    ).some((candidate) => questionContentIsCovered(candidate, question)))
  )))
);

const taskProgressIsCovered = (canonical: StudyTask, duplicate: StudyTask): boolean => {
  return duplicate.blocks.every((duplicateBlock) => duplicateBlock.questions.every((question) => {
    if (!hasQuestionProgress(question)) return true;
    return canonical.blocks.some((canonicalBlock) => (
      blockIdentity(canonicalBlock) === blockIdentity(duplicateBlock)
      && matchingCanonicalQuestions(canonicalBlock, question).some(
        (candidate) => questionProgressIsCovered(candidate, question),
      )
    ));
  }));
};

const compareCanonicalCandidates = (left: StudyTask, right: StudyTask): number =>
  progressCount(right) - progressCount(left)
  || questionCount(right) - questionCount(left)
  || right.blocks.length - left.blocks.length
  || Date.parse(left.date) - Date.parse(right.date);

export const deduplicateStudyTaskCollections = (
  tasks: readonly StudyTask[],
): StudyTaskDeduplicationResult => {
  const groups = new Map<string, StudyTask[]>();
  for (const task of tasks) {
    const identity = plannerTaskIdentity(task);
    if (!identity) continue;
    groups.set(identity, [...(groups.get(identity) ?? []), task]);
  }

  const removedIds = new Set<string>();
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue;
    const canonical = [...duplicates].sort(compareCanonicalCandidates)[0];
    for (const duplicate of duplicates) {
      if (duplicate.id === canonical.id) continue;
      const duplicateProgress = progressCount(duplicate);
      if (
        taskContentIsCovered(canonical, duplicate)
        && (
          duplicateProgress === 0
          || taskProgressIsCovered(canonical, duplicate)
        )
      ) {
        removedIds.add(duplicate.id);
      }
    }
  }

  return {
    tasks: tasks.filter((task) => !removedIds.has(task.id)),
    removedIds: [...removedIds],
  };
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

export const areStudyTaskCollectionsEqual = (
  left: readonly StudyTask[],
  right: readonly StudyTask[],
): boolean => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

export const mergeStudyTaskCollections = (
  remote: readonly StudyTask[],
  local: readonly StudyTask[],
): StudyTaskSyncMergeResult => {
  const localById = new Map(local.map((task) => [task.id, task]));
  const remoteIds = new Set(remote.map((task) => task.id));
  const mergedTasks = [
    ...remote.map((remoteTask) => {
      const localTask = localById.get(remoteTask.id);
      return localTask ? mergeSameTask(remoteTask, localTask) : remoteTask;
    }),
    ...local.filter((task) => !remoteIds.has(task.id)),
  ];
  const { tasks } = deduplicateStudyTaskCollections(mergedTasks);
  return {
    tasks,
    differsFromRemote: !areStudyTaskCollectionsEqual(tasks, remote),
  };
};
