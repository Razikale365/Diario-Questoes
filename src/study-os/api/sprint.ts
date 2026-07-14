import { requestJson, StudyOsApiError } from './client';


export type SprintRecommendation = 'execute' | 'compress' | 'defer' | 'extra';
export type SprintActionState = 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
export type SprintDecision = 'pending' | 'accepted' | 'rejected';
export type SprintSourceKind = 'ls' | 'trilha' | 'manual';
export type SprintSourceTaskKind = 'theory' | 'questions' | 'review' | 'simulation' | 'discursive' | 'mixed';
export type SprintSourceTaskStatus = 'pending' | 'started' | 'completed' | 'ignored' | 'archived';

export interface SprintSubjectProfile {
  id: number;
  targetSlug: string;
  subjectKey: string;
  displayName: string;
  aliases: string[];
  paper: 'P1' | 'P2';
  questionCount: number;
  questionWeight: number;
  discursiveEligible: boolean;
  baselineAccuracyBp: number | null;
  targetLowBp: number;
  targetHighBp: number;
  baselineConfidenceBp: number;
  focusBand: 'focus' | 'maintenance' | 'survival';
  baselineSource: string;
  notes: string;
  active: boolean;
  version: number;
}

export interface SprintGoals {
  p1Floor: number;
  p1Low: number;
  p1High: number;
  p2Low: number;
  p2High: number;
  discursiveLow: number;
  discursiveHigh: number;
}

export interface SprintConfig {
  targetSlug: string;
  startDate: string;
  objectiveDate: string;
  examEndDate: string;
  lsBudgetMinutes: number;
  extraBudgetMinutes: number;
  triageMode: 'suggest_only';
  state: 'active' | 'paused' | 'completed';
  goals: SprintGoals;
  subjects: SprintSubjectProfile[];
  version: number;
  replayed?: boolean;
}

export interface SprintQuestionRef {
  questionFingerprint: string;
  sourceTaskId: string | null;
  reason: 'wrong' | 'doubt' | 'favorite';
}

export interface SprintAction {
  id: number;
  runId: number;
  position: number;
  actionKind: 'ls_execute' | 'ls_compress' | 'ls_defer' | 'microblock' | 'review' | 'simulation' | 'discursive' | 'minimum_viable';
  recommendation: SprintRecommendation;
  sourcePlanTaskId: number | null;
  externalTaskId: string | null;
  planLabel: string | null;
  subjectProfileId: number;
  subjectKey: string;
  subjectName: string;
  paper: 'P1' | 'P2';
  topicHint: string;
  title: string;
  durationMinutes: number;
  plannedQuestions: number;
  expectedGainMilli: number;
  confidenceBp: number;
  whyNow: string;
  rationale: string[];
  scoreDetails: Record<string, unknown>;
  decision: SprintDecision;
  state: SprintActionState;
  actualMinutes: number | null;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  energyAfter: number | null;
  linkedStudyTaskId: string | null;
  materialHint: string;
  questionRefs: SprintQuestionRef[];
  version: number;
  replayed?: boolean;
}

export interface SprintDay {
  runId: number;
  targetSlug: string;
  date: string;
  daysRemaining: number;
  modeLabel: string;
  capacity: { lsBudgetMinutes: number; extraBudgetMinutes: number; energyLevel: number };
  projections: { p1: number; p2: number };
  actions: SprintAction[];
  minimumViable: { actionIds: number[]; minutes: number };
  supersedesRunId: number | null;
  status: 'generated' | 'shortfall';
  algorithmVersion: string;
  generatedAt: string;
  version: number;
  replayed: boolean;
}

export interface GenerateSprintDayInput {
  targetSlug: string;
  date: string;
  energyLevel: number;
  p1Projection?: number;
  p2Projection?: number;
  lsBudgetMinutes?: number;
  extraBudgetMinutes?: number;
}

export interface SprintActionResultInput {
  expectedVersion: number;
  decision: SprintDecision;
  state: SprintActionState;
  actualMinutes?: number | null;
  questionsDone?: number;
  correctCount?: number;
  wrongCount?: number;
  doubtCount?: number;
  energyAfter?: number | null;
  questionRefs?: SprintQuestionRef[];
}

export interface SourcePlanTaskInput {
  externalTaskId: string;
  scheduledDate?: string | null;
  sourceOrder: number;
  discipline: string;
  topicHint?: string;
  taskKind: SprintSourceTaskKind;
  description: string;
  details?: string;
  materialHint?: string;
  estimatedMinutes: number;
  spentMinutes?: number;
  relevance?: number;
  status: SprintSourceTaskStatus;
  performanceBp?: number | null;
  linkedStudyTaskId?: string | null;
  provenance?: Record<string, unknown>;
}

export interface SourcePlanTask extends SourcePlanTaskInput {
  id: number;
  targetSlug: string;
  sourceKind: SprintSourceKind;
  planLabel: string;
  metaNumber: number | null;
  scheduledDate: string | null;
  subjectKey: string | null;
  mappingStatus: 'matched' | 'transversal' | 'unresolved';
  topicHint: string;
  details: string;
  materialHint: string;
  spentMinutes: number;
  relevance: number;
  performanceBp: number | null;
  linkedStudyTaskId: string | null;
  provenance: Record<string, unknown>;
  version: number;
}

export interface SourcePlanTaskList {
  targetSlug: string;
  date: string | null;
  items: SourcePlanTask[];
  unresolvedCount: number;
}

export interface ImportSourcePlanInput {
  targetSlug: string;
  sourceKind: SprintSourceKind;
  planLabel: string;
  metaNumber?: number;
  tasks: SourcePlanTaskInput[];
}

export interface SourcePlanImportResult {
  targetSlug: string;
  sourceKind: SprintSourceKind;
  planLabel: string;
  createdCount: number;
  updatedCount: number;
  unresolvedCount: number;
  taskIds: number[];
  replayed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isText = (value: unknown): value is string => isString(value) && Boolean(value.trim());
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const isPositive = (value: unknown): value is number => isInteger(value) && Number(value) > 0;
const isNonNegative = (value: unknown): value is number => isInteger(value) && Number(value) >= 0;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const inRange = (value: unknown, minimum: number, maximum: number): value is number =>
  isNumber(value) && value >= minimum && value <= maximum;
const isDate = (value: unknown): value is string =>
  isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isNullableText = (value: unknown): value is string | null => value === null || isString(value);
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  isString(value) && choices.includes(value as T);
const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS ${label} response`);
};

const parseSubject = (value: unknown): SprintSubjectProfile => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !isText(value.targetSlug)
    || !isText(value.subjectKey)
    || !isText(value.displayName)
    || !Array.isArray(value.aliases)
    || !value.aliases.every(isText)
    || !oneOf(value.paper, ['P1', 'P2'] as const)
    || !isPositive(value.questionCount)
    || !inRange(value.questionWeight, 0.1, 10)
    || typeof value.discursiveEligible !== 'boolean'
    || !(value.baselineAccuracyBp === null || inRange(value.baselineAccuracyBp, 0, 10000))
    || !inRange(value.targetLowBp, 0, 10000)
    || !inRange(value.targetHighBp, 0, 10000)
    || !inRange(value.baselineConfidenceBp, 0, 10000)
    || !oneOf(value.focusBand, ['focus', 'maintenance', 'survival'] as const)
    || !isText(value.baselineSource)
    || !isString(value.notes)
    || typeof value.active !== 'boolean'
    || !isPositive(value.version)) invalid('sprint subject');
  return value as unknown as SprintSubjectProfile;
};

export const parseSprintConfig = (value: unknown): SprintConfig => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !isDate(value.startDate)
    || !isDate(value.objectiveDate)
    || !isDate(value.examEndDate)
    || !inRange(value.lsBudgetMinutes, 15, 720)
    || !inRange(value.extraBudgetMinutes, 0, 240)
    || value.triageMode !== 'suggest_only'
    || !oneOf(value.state, ['active', 'paused', 'completed'] as const)
    || !isRecord(value.goals)
    || !inRange(value.goals.p1Floor, 0, 80)
    || !inRange(value.goals.p1Low, 0, 80)
    || !inRange(value.goals.p1High, 0, 80)
    || !inRange(value.goals.p2Low, 0, 80)
    || !inRange(value.goals.p2High, 0, 80)
    || !inRange(value.goals.discursiveLow, 0, 100)
    || !inRange(value.goals.discursiveHigh, 0, 100)
    || !Array.isArray(value.subjects)
    || !isPositive(value.version)
    || !(value.replayed === undefined || typeof value.replayed === 'boolean')) invalid('sprint config');
  return {
    ...(value as unknown as SprintConfig),
    subjects: ((value as Record<string, unknown>).subjects as unknown[]).map(parseSubject),
  };
};

const parseQuestionRef = (value: unknown): SprintQuestionRef => {
  if (!isRecord(value)
    || !isText(value.questionFingerprint)
    || !isNullableText(value.sourceTaskId)
    || !oneOf(value.reason, ['wrong', 'doubt', 'favorite'] as const)) invalid('sprint question ref');
  return value as unknown as SprintQuestionRef;
};

export const parseSprintAction = (value: unknown): SprintAction => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !isPositive(value.runId)
    || !isPositive(value.position)
    || !oneOf(value.actionKind, ['ls_execute', 'ls_compress', 'ls_defer', 'microblock', 'review', 'simulation', 'discursive', 'minimum_viable'] as const)
    || !oneOf(value.recommendation, ['execute', 'compress', 'defer', 'extra'] as const)
    || !(value.sourcePlanTaskId === null || isPositive(value.sourcePlanTaskId))
    || !isNullableText(value.externalTaskId)
    || !isNullableText(value.planLabel)
    || !isPositive(value.subjectProfileId)
    || !isText(value.subjectKey)
    || !isText(value.subjectName)
    || !oneOf(value.paper, ['P1', 'P2'] as const)
    || !isString(value.topicHint)
    || !isText(value.title)
    || !inRange(value.durationMinutes, 5, 240)
    || !isNonNegative(value.plannedQuestions)
    || !isNonNegative(value.expectedGainMilli)
    || !inRange(value.confidenceBp, 0, 10000)
    || !isString(value.whyNow)
    || !Array.isArray(value.rationale)
    || !value.rationale.every(isText)
    || !isRecord(value.scoreDetails)
    || !oneOf(value.decision, ['pending', 'accepted', 'rejected'] as const)
    || !oneOf(value.state, ['pending', 'active', 'completed', 'skipped', 'failed'] as const)
    || !(value.actualMinutes === null || isNonNegative(value.actualMinutes))
    || !isNonNegative(value.questionsDone)
    || !isNonNegative(value.correctCount)
    || !isNonNegative(value.wrongCount)
    || !isNonNegative(value.doubtCount)
    || !(value.energyAfter === null || inRange(value.energyAfter, 1, 5))
    || !isNullableText(value.linkedStudyTaskId)
    || !isString(value.materialHint)
    || !Array.isArray(value.questionRefs)
    || !isPositive(value.version)
    || !(value.replayed === undefined || typeof value.replayed === 'boolean')) invalid('sprint action');
  return {
    ...(value as unknown as SprintAction),
    questionRefs: ((value as Record<string, unknown>).questionRefs as unknown[]).map(parseQuestionRef),
  };
};

export const parseSprintDay = (value: unknown): SprintDay => {
  if (!isRecord(value)
    || !isPositive(value.runId)
    || !isText(value.targetSlug)
    || !isDate(value.date)
    || !isNonNegative(value.daysRemaining)
    || !isText(value.modeLabel)
    || !isRecord(value.capacity)
    || !inRange(value.capacity.lsBudgetMinutes, 15, 720)
    || !inRange(value.capacity.extraBudgetMinutes, 0, 240)
    || !inRange(value.capacity.energyLevel, 1, 5)
    || !isRecord(value.projections)
    || !inRange(value.projections.p1, 0, 80)
    || !inRange(value.projections.p2, 0, 80)
    || !Array.isArray(value.actions)
    || !isRecord(value.minimumViable)
    || !Array.isArray(value.minimumViable.actionIds)
    || !value.minimumViable.actionIds.every(isPositive)
    || !isNonNegative(value.minimumViable.minutes)
    || !(value.supersedesRunId === null || isPositive(value.supersedesRunId))
    || !oneOf(value.status, ['generated', 'shortfall'] as const)
    || !isText(value.algorithmVersion)
    || !isText(value.generatedAt)
    || !isPositive(value.version)
    || typeof value.replayed !== 'boolean') invalid('sprint day');
  return {
    ...(value as unknown as SprintDay),
    actions: ((value as Record<string, unknown>).actions as unknown[]).map(parseSprintAction),
  };
};

const parseImportResult = (value: unknown): SourcePlanImportResult => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !oneOf(value.sourceKind, ['ls', 'trilha', 'manual'] as const)
    || !isText(value.planLabel)
    || !isNonNegative(value.createdCount)
    || !isNonNegative(value.updatedCount)
    || !isNonNegative(value.unresolvedCount)
    || !Array.isArray(value.taskIds)
    || !value.taskIds.every(isPositive)
    || typeof value.replayed !== 'boolean') invalid('source plan import');
  return value as unknown as SourcePlanImportResult;
};

const parseSourcePlanTask = (value: unknown): SourcePlanTask => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !isText(value.targetSlug)
    || !oneOf(value.sourceKind, ['ls', 'trilha', 'manual'] as const)
    || !isText(value.externalTaskId)
    || !isText(value.planLabel)
    || !(value.metaNumber === null || isNonNegative(value.metaNumber))
    || !(value.scheduledDate === null || isDate(value.scheduledDate))
    || !isNonNegative(value.sourceOrder)
    || !isText(value.discipline)
    || !isNullableText(value.subjectKey)
    || !oneOf(value.mappingStatus, ['matched', 'transversal', 'unresolved'] as const)
    || !isString(value.topicHint)
    || !oneOf(value.taskKind, ['theory', 'questions', 'review', 'simulation', 'discursive', 'mixed'] as const)
    || !isText(value.description)
    || !isString(value.details)
    || !isString(value.materialHint)
    || !isPositive(value.estimatedMinutes)
    || !isNonNegative(value.spentMinutes)
    || !inRange(value.relevance, 0, 10)
    || !oneOf(value.status, ['pending', 'started', 'completed', 'ignored', 'archived'] as const)
    || !(value.performanceBp === null || inRange(value.performanceBp, 0, 10000))
    || !isNullableText(value.linkedStudyTaskId)
    || !isRecord(value.provenance)
    || !isPositive(value.version)) invalid('source-plan task');
  return value as unknown as SourcePlanTask;
};

export const parseSourcePlanTaskList = (value: unknown): SourcePlanTaskList => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !(value.date === null || isDate(value.date))
    || !Array.isArray(value.items)
    || !isNonNegative(value.unresolvedCount)) invalid('source-plan task list');
  return {
    ...(value as unknown as SourcePlanTaskList),
    items: ((value as Record<string, unknown>).items as unknown[]).map(parseSourcePlanTask),
  };
};

const jsonMutation = (method: string, body: object, idempotencyKey: string): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify(body),
});

export const fetchSprintConfig = async (targetSlug: string, signal?: AbortSignal): Promise<SprintConfig> => {
  const query = new URLSearchParams({ targetSlug });
  return parseSprintConfig(await requestJson(`/api/v1/sprints/config?${query}`, { signal }));
};

export const generateSprintDay = async (
  input: GenerateSprintDayInput,
  idempotencyKey: string,
): Promise<SprintDay> => parseSprintDay(await requestJson(
  '/api/v1/sprints/generate-day', jsonMutation('POST', input, idempotencyKey),
));

export const refreshSprintDay = async (
  input: GenerateSprintDayInput,
  idempotencyKey: string,
): Promise<SprintDay> => parseSprintDay(await requestJson(
  '/api/v1/sprints/refresh-day', jsonMutation('POST', input, idempotencyKey),
));

export const fetchSprintDay = async (
  targetSlug: string,
  date: string,
  signal?: AbortSignal,
): Promise<SprintDay> => {
  const query = new URLSearchParams({ targetSlug, date });
  return parseSprintDay(await requestJson(`/api/v1/sprints/day?${query}`, { signal }));
};

export const fetchOptionalSprintDay = async (
  targetSlug: string,
  date: string,
  signal?: AbortSignal,
): Promise<SprintDay | null> => {
  try {
    return await fetchSprintDay(targetSlug, date, signal);
  } catch (error) {
    if (error instanceof StudyOsApiError && error.status === 404 && error.code === 'sprint_day_not_found') return null;
    throw error;
  }
};

export const updateSprintAction = async (
  actionId: number,
  input: SprintActionResultInput,
  idempotencyKey: string,
): Promise<SprintAction> => parseSprintAction(await requestJson(
  `/api/v1/sprints/actions/${actionId}`, jsonMutation('PUT', input, idempotencyKey),
));

export const importSourcePlan = async (
  input: ImportSourcePlanInput,
  idempotencyKey: string,
): Promise<SourcePlanImportResult> => parseImportResult(await requestJson(
  '/api/v1/source-plans/import', jsonMutation('POST', input, idempotencyKey),
));

export const fetchSourcePlanTasks = async (
  targetSlug: string,
  date?: string,
  signal?: AbortSignal,
): Promise<SourcePlanTaskList> => {
  const query = new URLSearchParams({ targetSlug });
  if (date) query.set('date', date);
  return parseSourcePlanTaskList(await requestJson(`/api/v1/source-plans/tasks?${query}`, { signal }));
};
