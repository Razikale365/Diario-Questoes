import { PlannerMetaSummary, PlannerTask, QuestionBankItem } from '../types';

export interface StudyImportPackage {
  meta: PlannerMetaSummary;
  tasks: PlannerTask[];
  questionBankItems: QuestionBankItem[];
}

export interface WeekScheduleEntry {
  number: number;
  date: string;
  startTime: string;
}

export interface WeekScheduleImport {
  schema: 'diario-questoes.week-schedule';
  metaNumber?: number;
  startDate?: string;
  endDate?: string;
  entries: WeekScheduleEntry[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasString = (value: unknown, key: string) =>
  isObject(value) && typeof value[key] === 'string' && value[key].trim().length > 0;

const isPlannerMetaSummary = (value: unknown): value is PlannerMetaSummary =>
  hasString(value, 'id') &&
  hasString(value, 'title') &&
  isObject(value) &&
  typeof value.totalTasks === 'number' &&
  typeof value.totalDisciplines === 'number';

const isPlannerTask = (value: unknown): value is PlannerTask =>
  hasString(value, 'id') &&
  hasString(value, 'discipline') &&
  hasString(value, 'description') &&
  isObject(value) &&
  typeof value.number === 'number';

const isQuestionBankItem = (value: unknown): value is QuestionBankItem =>
  hasString(value, 'id') &&
  hasString(value, 'fingerprint') &&
  hasString(value, 'statement') &&
  hasString(value, 'discipline') &&
  hasString(value, 'sourceName') &&
  isObject(value) &&
  Array.isArray(value.alternatives) &&
  Array.isArray(value.tags);

const isScheduleDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const isStartTime = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);

const isWeekScheduleEntry = (value: unknown): value is WeekScheduleEntry =>
  isObject(value) &&
  typeof value.number === 'number' &&
  Number.isFinite(value.number) &&
  isScheduleDate(value.date) &&
  isStartTime(value.startTime);

export const parseStudyImportPackage = (text: string): StudyImportPackage | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isObject(parsed)) return null;

  const planner = isObject(parsed.planner) ? parsed.planner : {};
  const meta = planner.meta ?? parsed.plannerMeta;
  const tasks = planner.tasks ?? parsed.plannerTasks;
  const questionBankItems = parsed.questionBankItems;

  if (!isPlannerMetaSummary(meta) || !Array.isArray(tasks) || !tasks.every(isPlannerTask)) {
    return null;
  }

  if (!Array.isArray(questionBankItems) || !questionBankItems.every(isQuestionBankItem)) {
    return {
      meta,
      tasks,
      questionBankItems: [],
    };
  }

  return {
    meta,
    tasks,
    questionBankItems,
  };
};

export const parseWeekScheduleImport = (text: string): WeekScheduleImport | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (
    !isObject(parsed) ||
    parsed.schema !== 'diario-questoes.week-schedule' ||
    !Array.isArray(parsed.entries) ||
    !parsed.entries.every(isWeekScheduleEntry)
  ) {
    return null;
  }

  return {
    schema: 'diario-questoes.week-schedule',
    metaNumber: typeof parsed.metaNumber === 'number' ? parsed.metaNumber : undefined,
    startDate: isScheduleDate(parsed.startDate) ? parsed.startDate : undefined,
    endDate: isScheduleDate(parsed.endDate) ? parsed.endDate : undefined,
    entries: parsed.entries,
  };
};
