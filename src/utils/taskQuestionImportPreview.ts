import { QuestionBankItem, StudyTask } from '../types';
import { ImportedObjectiveQuestion } from './objectiveQuestionParser';
import {
  buildQuestionBankItems,
  mergeQuestionBankItems,
  QuestionBankImportContext,
  resolveMergedQuestionBankItems,
} from './questionBank';
import {
  planTaskQuestionImport,
  TaskQuestionImportBlockDefaults,
  TaskQuestionImportDestination,
  TaskQuestionImportResult,
} from './taskQuestionImport';

export interface TaskQuestionImportParsedBatch {
  questions: ImportedObjectiveQuestion[];
  rejectedBlocks: number;
  fileName: string;
  pageCount: number;
}

export interface BuildTaskQuestionImportPreviewInput {
  task: StudyTask;
  currentQuestionBank: QuestionBankItem[];
  parsed: TaskQuestionImportParsedBatch;
  context: QuestionBankImportContext;
  destination: TaskQuestionImportDestination;
  blockDefaults: TaskQuestionImportBlockDefaults;
  idFactory?: () => string;
  now?: () => string;
}

export interface TaskQuestionImportPreview {
  plan: TaskQuestionImportResult;
  canonicalItems: QuestionBankItem[];
  nextQuestionBank: QuestionBankItem[];
  bankAdded: number;
  bankDuplicates: number;
  rejectedBlocks: number;
}

export const buildTaskQuestionImportPreview = (
  input: BuildTaskQuestionImportPreviewInput,
): TaskQuestionImportPreview => {
  const incomingItems = buildQuestionBankItems(input.parsed.questions, input.context);
  const merged = mergeQuestionBankItems(input.currentQuestionBank, incomingItems);
  const canonicalItems = resolveMergedQuestionBankItems(incomingItems, merged.items);
  const plan = planTaskQuestionImport({
    task: input.task,
    sourceQuestions: input.parsed.questions,
    canonicalItems,
    destination: input.destination,
    blockDefaults: input.blockDefaults,
    idFactory: input.idFactory,
    now: input.now,
  });

  return {
    plan,
    canonicalItems,
    nextQuestionBank: merged.items,
    bankAdded: merged.added,
    bankDuplicates: merged.duplicates,
    rejectedBlocks: input.parsed.rejectedBlocks,
  };
};
