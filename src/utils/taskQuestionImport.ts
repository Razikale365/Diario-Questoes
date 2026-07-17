import { ActivityBlock, Question, QuestionBankItem, StudyTask } from '../types';
import { DEFAULT_ACTIVITY_LAYOUT, DEFAULT_SECTION_LAYOUT } from './layout';
import { ImportedObjectiveQuestion } from './objectiveQuestionParser';
import { questionBankItemToQuestion } from './questionBank';

export type TaskQuestionImportDestination =
  | { kind: 'new_section'; sectionTitle: string }
  | { kind: 'new_block'; sectionTitle: string }
  | { kind: 'existing_block'; blockId: string };

export interface TaskQuestionImportBlockDefaults {
  title: string;
  lesson: string;
  pages: string;
  bank: string;
}

export interface TaskQuestionImportConflict {
  kind: 'content' | 'answer_key';
  sourceQuestionNumber?: number;
  existingQuestionNumber: number;
}

export interface TaskQuestionImportSummary {
  detected: number;
  enriched: number;
  appended: number;
  duplicates: number;
  contentConflicts: number;
  answerKeyConflicts: number;
  conflicts: TaskQuestionImportConflict[];
}

export type TaskQuestionImportFailureCode =
  | 'empty_batch'
  | 'batch_mismatch'
  | 'missing_block'
  | 'missing_section'
  | 'locked_destination'
  | 'duplicate_section';

export type TaskQuestionImportResult =
  | { ok: true; task: StudyTask; summary: TaskQuestionImportSummary; changed: boolean }
  | { ok: false; code: TaskQuestionImportFailureCode; message: string; summary: TaskQuestionImportSummary };

export interface PlanTaskQuestionImportInput {
  task: StudyTask;
  sourceQuestions: ImportedObjectiveQuestion[];
  canonicalItems: QuestionBankItem[];
  destination: TaskQuestionImportDestination;
  blockDefaults: TaskQuestionImportBlockDefaults;
  idFactory?: () => string;
  now?: () => string;
}

const normalized = (value: string | undefined) =>
  (value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

const emptySummary = (detected: number): TaskQuestionImportSummary => ({
  detected,
  enriched: 0,
  appended: 0,
  duplicates: 0,
  contentConflicts: 0,
  answerKeyConflicts: 0,
  conflicts: [],
});

const failureMessages: Record<TaskQuestionImportFailureCode, string> = {
  empty_batch: 'Nenhuma questão objetiva foi detectada.',
  batch_mismatch: 'O lote processado não corresponde aos itens canônicos do banco.',
  missing_block: 'Selecione um bloco existente para receber as questões.',
  missing_section: 'Selecione uma seção existente para criar a atividade.',
  locked_destination: 'Desbloqueie o bloco ou a seção antes de importar.',
  duplicate_section: 'Já existe uma seção com este título; escolha Nova atividade para acrescentar outro lote.',
};

const failure = (
  code: TaskQuestionImportFailureCode,
  summary: TaskQuestionImportSummary,
): TaskQuestionImportResult => ({ ok: false, code, message: failureMessages[code], summary });

const hasCompleteContent = (question: Question) => Boolean(
  question.statement?.trim()
  && question.alternatives
  && question.alternatives.length >= 2
  && question.alternatives.every((alternative) => alternative.label.trim() && alternative.text.trim()),
);

const hasSameContent = (question: Question, item: QuestionBankItem) =>
  normalized(question.statement) === normalized(item.statement)
  && JSON.stringify((question.alternatives || []).map((alternative) => [
    normalized(alternative.label),
    normalized(alternative.text),
  ])) === JSON.stringify(item.alternatives.map((alternative) => [
    normalized(alternative.label),
    normalized(alternative.text),
  ]));

const findMatchIndex = (questions: Question[], item: QuestionBankItem) => {
  const localId = questions.findIndex((question) => Boolean(question.localId) && question.localId === item.id);
  if (localId >= 0) return localId;
  const sourceNumber = questions.findIndex((question) => (
    question.sourceQuestionNumber !== undefined
    && question.sourceQuestionNumber === item.sourceQuestionNumber
  ));
  if (sourceNumber >= 0) return sourceNumber;
  return questions.findIndex((question) => (
    !hasCompleteContent(question)
    && item.sourceQuestionNumber !== undefined
    && question.number === item.sourceQuestionNumber
  ));
};

const preserveProgress = (existing: Question, item: QuestionBankItem): Question => {
  const imported = questionBankItemToQuestion(item, 0);
  return {
    ...imported,
    number: existing.number,
    answer: existing.answer,
    isCorrect: existing.isCorrect,
    hasDoubt: existing.hasDoubt,
    favorite: existing.favorite !== undefined ? existing.favorite : imported.favorite,
    observations: existing.observations !== undefined ? existing.observations : imported.observations,
    eliminated: existing.eliminated !== undefined ? existing.eliminated : imported.eliminated,
    doubtedAlts: existing.doubtedAlts !== undefined ? existing.doubtedAlts : imported.doubtedAlts,
    attempts: existing.attempts !== undefined ? existing.attempts : imported.attempts,
    correctAnswer: existing.correctAnswer || imported.correctAnswer,
  };
};

const isCanonicalQuestion = (question: Question, item: QuestionBankItem) => (
  question.localId === item.id
  && question.sourceQuestionNumber === item.sourceQuestionNumber
  && hasSameContent(question, item)
);

const importIntoQuestions = (
  current: Question[],
  items: QuestionBankItem[],
  summary: TaskQuestionImportSummary,
) => {
  const questions = [...current];
  let changed = false;
  let nextNumber = questions.reduce((maximum, question) => Math.max(maximum, question.number), 0) + 1;

  for (const item of items) {
    const matchIndex = findMatchIndex(questions, item);
    if (matchIndex < 0) {
      questions.push({ ...questionBankItemToQuestion(item, nextNumber - 1), number: nextNumber });
      nextNumber += 1;
      summary.appended += 1;
      changed = true;
      continue;
    }

    const existing = questions[matchIndex];
    if (hasCompleteContent(existing) && !hasSameContent(existing, item)) {
      summary.contentConflicts += 1;
      summary.conflicts.push({
        kind: 'content',
        sourceQuestionNumber: item.sourceQuestionNumber,
        existingQuestionNumber: existing.number,
      });
      continue;
    }

    const keyConflict = Boolean(
      existing.correctAnswer
      && item.correctAnswer
      && normalized(existing.correctAnswer) !== normalized(item.correctAnswer),
    );
    if (keyConflict) {
      summary.answerKeyConflicts += 1;
      summary.conflicts.push({
        kind: 'answer_key',
        sourceQuestionNumber: item.sourceQuestionNumber,
        existingQuestionNumber: existing.number,
      });
    }

    if (isCanonicalQuestion(existing, item)) {
      summary.duplicates += 1;
      continue;
    }

    questions[matchIndex] = preserveProgress(existing, item);
    summary.enriched += 1;
    changed = true;
  }

  return { questions, changed };
};

const sectionMatches = (block: ActivityBlock, title: string) => (
  Boolean(block.isSection) && normalized(block.title) === normalized(title)
);

const childMatches = (block: ActivityBlock, title: string) => (
  !block.isSection && normalized(block.lesson) === normalized(title)
);

const containsWholeBatch = (block: ActivityBlock, items: QuestionBankItem[]) => (
  items.every((item) => block.questions.some((question) => question.localId === item.id))
);

const makeActivityBlock = (
  id: string,
  defaults: TaskQuestionImportBlockDefaults,
  questions: Question[],
): ActivityBlock => ({
  id,
  title: defaults.title,
  lesson: defaults.lesson,
  pages: defaults.pages,
  bank: defaults.bank,
  questions,
  showStats: true,
  showGabarito: false,
  layout: {
    ...DEFAULT_ACTIVITY_LAYOUT,
    columns: 1,
    rows: Math.min(Math.max(questions.length, 1), 8),
    type: 'grid',
    width: 12,
    rowSpan: 4,
  },
});

const makeSection = (id: string, title: string): ActivityBlock => ({
  id,
  title,
  lesson: title,
  pages: '',
  questions: [],
  isSection: true,
  layout: DEFAULT_SECTION_LAYOUT,
});

const withUpdatedTask = (task: StudyTask, blocks: ActivityBlock[], now: () => string): StudyTask => ({
  ...task,
  blocks,
  updatedAt: now(),
});

export const planTaskQuestionImport = (input: PlanTaskQuestionImportInput): TaskQuestionImportResult => {
  const summary = emptySummary(input.sourceQuestions.length);
  if (input.sourceQuestions.length === 0) {
    return failure('empty_batch', summary);
  }
  if (
    input.canonicalItems.length === 0
    || input.sourceQuestions.length !== input.canonicalItems.length
    || input.sourceQuestions.some((question, index) => (
      input.canonicalItems[index].sourceQuestionNumber !== undefined
      && input.canonicalItems[index].sourceQuestionNumber !== question.number
    ))
  ) {
    return failure('batch_mismatch', summary);
  }

  const idFactory = input.idFactory || (() => crypto.randomUUID());
  const now = input.now || (() => new Date().toISOString());
  const { task, destination, canonicalItems } = input;

  if (destination.kind === 'existing_block') {
    const index = task.blocks.findIndex((block) => block.id === destination.blockId && !block.isSection);
    if (index < 0) return failure('missing_block', summary);
    if (task.blocks[index].isLocked) {
      return failure('locked_destination', summary);
    }
    const imported = importIntoQuestions(task.blocks[index].questions, canonicalItems, summary);
    if (!imported.changed) return { ok: true, task, summary, changed: false };
    const blocks = task.blocks.map((block, blockIndex) => (
      blockIndex === index ? { ...block, questions: imported.questions } : block
    ));
    return { ok: true, task: withUpdatedTask(task, blocks, now), summary, changed: true };
  }

  const sectionTitle = destination.sectionTitle.trim() || input.blockDefaults.lesson.trim();
  const sectionIndex = task.blocks.findIndex((block) => sectionMatches(block, sectionTitle));

  if (destination.kind === 'new_block') {
    if (sectionIndex < 0) return failure('missing_section', summary);
    if (task.blocks[sectionIndex].isLocked) {
      return failure('locked_destination', summary);
    }
    const repeatedIndex = task.blocks.findIndex((block) => (
      childMatches(block, sectionTitle) && containsWholeBatch(block, canonicalItems)
    ));
    if (repeatedIndex >= 0) {
      if (task.blocks[repeatedIndex].isLocked) {
        return failure('locked_destination', summary);
      }
      summary.duplicates = canonicalItems.length;
      return { ok: true, task, summary, changed: false };
    }
    const imported = importIntoQuestions([], canonicalItems, summary);
    const block = makeActivityBlock(idFactory(), { ...input.blockDefaults, lesson: sectionTitle }, imported.questions);
    return {
      ok: true,
      task: withUpdatedTask(task, [...task.blocks, block], now),
      summary,
      changed: true,
    };
  }

  if (sectionIndex >= 0) {
    const section = task.blocks[sectionIndex];
    if (section.isLocked) {
      return failure('locked_destination', summary);
    }
    const repeatedIndex = task.blocks.findIndex((block) => (
      childMatches(block, sectionTitle) && containsWholeBatch(block, canonicalItems)
    ));
    if (repeatedIndex < 0) {
      return failure('duplicate_section', summary);
    }
    if (task.blocks[repeatedIndex].isLocked) {
      return failure('locked_destination', summary);
    }
    summary.duplicates = canonicalItems.length;
    return { ok: true, task, summary, changed: false };
  }

  const imported = importIntoQuestions([], canonicalItems, summary);
  const section = makeSection(idFactory(), sectionTitle);
  const block = makeActivityBlock(
    idFactory(),
    { ...input.blockDefaults, lesson: sectionTitle },
    imported.questions,
  );
  return {
    ok: true,
    task: withUpdatedTask(task, [...task.blocks, section, block], now),
    summary,
    changed: true,
  };
};
