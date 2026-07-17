import { requestJson, StudyOsApiError } from './client';


export type SprintRecommendation = 'execute' | 'compress' | 'defer' | 'extra';
export type SprintActionState = 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
export type SprintDecision = 'pending' | 'accepted' | 'rejected';
export type SprintSourceKind = 'ls' | 'trilha' | 'manual';
export type SprintSourceTaskKind = 'theory' | 'questions' | 'review' | 'simulation' | 'discursive' | 'mixed';
export type SprintSourceTaskStatus = 'pending' | 'started' | 'completed' | 'ignored' | 'archived';
export type SprintEvidenceMeasurementType =
  | 'full_exam'
  | 'sectional_mock'
  | 'unseen_set'
  | 'mixed_set'
  | 'error_review'
  | 'ls_percentage'
  | 'sprint_action'
  | 'baseline';
export type SprintEvidenceTransferScope = 'content' | 'method' | 'trap_pattern';
export type SprintEvidenceScalar = string | number | boolean | null;

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
  projection: SprintProjection | null;
  projectionOrigin: 'derived' | 'manual' | 'legacy_manual';
  actions: SprintAction[];
  minimumViable: { actionIds: number[]; minutes: number };
  supersedesRunId: number | null;
  status: 'generated' | 'shortfall';
  algorithmVersion: string;
  generatedAt: string;
  version: number;
  replayed: boolean;
}

export interface SprintSubjectProjection {
  subjectProfileId: number;
  subjectKey: string;
  displayName: string;
  paper: 'P1' | 'P2';
  questionCount: number;
  questionWeight: number;
  estimateBp: number;
  lowBp: number;
  highBp: number;
  effectiveSample: number;
  confidenceBp: number;
  fragilityBp: number;
  representativeSetCount: number;
  demotionEligible: boolean;
  dominantOrigin: string;
  warnings: string[];
}

export interface SprintPaperProjection {
  projected: number;
  low: number;
  high: number;
  floor: number;
  stretch: number;
  variance: number | null;
}

export interface SprintProjection {
  targetSlug: string;
  asOf: string;
  formulaVersion: string;
  scoreKind: 'raw_weighted_equivalent_not_fcc_standardized';
  interval: { confidenceBp: 9000; kind: 'normal_approximation_raw_equivalent' };
  p1: SprintPaperProjection;
  p2: SprintPaperProjection;
  weighted: { projected: number; low: number; high: number; target: 204; distanceToTarget: number };
  confidenceBp: number;
  dominantOrigin: string;
  warnings: string[];
  subjects: SprintSubjectProjection[];
}

export interface SprintEvidenceObservation {
  id: number;
  targetSlug: string;
  batchId: string;
  subjectProfileId: number | null;
  subjectKey: string | null;
  discipline: string;
  topicHint: string;
  observedOn: string;
  origin: string;
  sourceRecordId: string;
  sourceRevision: string;
  sourceUpdatedAt: string;
  measurementType: SprintEvidenceMeasurementType;
  examBoard: string;
  correctCount: number | null;
  wrongCount: number | null;
  doubtCount: number;
  percentageBp: number;
  sampleSize: number | null;
  transferScope: SprintEvidenceTransferScope;
  transferabilityBp: number;
  contentHash: string;
  provenance: Record<string, SprintEvidenceScalar>;
}

export interface SprintEvidenceList {
  targetSlug: string;
  items: SprintEvidenceObservation[];
  unresolvedCount: number;
}

export interface SprintTrajectoryRun {
  runId?: number;
  date?: string;
  p1: number;
  p2: number;
  projection: SprintProjection | null;
  projectionOrigin: 'derived' | 'manual' | 'legacy_manual' | null;
  confidenceBp: number | null;
  weightedProjected: number;
  distanceToTarget: number;
  dominantOrigin: string | null;
  formulaVersion: string | null;
  generatedAt?: string;
}

export interface SprintTrajectory {
  targetSlug: string;
  latest: SprintTrajectoryRun;
  runs: SprintTrajectoryRun[];
}

export interface SourcePlanCycle {
  id: number;
  sourceKind: SprintSourceKind;
  planLabel: string;
  metaNumber: number | null;
  releasedAt: string;
  startsOn: string;
  endsOn: string;
  version: number;
}

export interface SourcePlanBacklog {
  id: number;
  reason: 'cycle_closed_pending';
  returnScoreMilli: number;
  state: 'candidate' | 'recovered' | 'dismissed';
  discoveredOn: string;
  recoveredOn: string | null;
}

export interface SourcePlanBacklogList {
  targetSlug: string;
  items: SourcePlanBacklog[];
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
  cycle: SourcePlanCycle | null;
  backlog: SourcePlanBacklog | null;
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
  cycle?: { releasedAt: string; startsOn: string; endsOn: string };
  tasks: SourcePlanTaskInput[];
}

export interface SourcePlanImportResult {
  targetSlug: string;
  sourceKind: SprintSourceKind;
  planLabel: string;
  createdCount: number;
  updatedCount: number;
  unresolvedCount: number;
  cycleOverrunCount: number;
  cycle: SourcePlanCycle | null;
  taskIds: number[];
  replayed: boolean;
}

export type TaskExecutionOutcome = 'started' | 'completed' | 'failed' | 'skipped';

export interface SourceTaskExecutionInput {
  outcome: TaskExecutionOutcome;
  performedOn: string;
  taskMinutes: number;
  exerciseMinutes: number;
  questionsTotal: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  energyAfter: number | null;
  notes: string;
  sprintActionId?: number;
  expectedVersion?: number;
}

export interface TaskExecution {
  id: number;
  outcome: TaskExecutionOutcome;
  performedOn: string;
  taskMinutes: number;
  exerciseMinutes: number;
  questionsTotal: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  performanceBp: number | null;
  energyAfter: number | null;
  notes: string;
  recordedAt: string;
  version: number;
}

export interface TaskExecutionSourceTask {
  id: number;
  targetSlug: string;
  status: SprintSourceTaskStatus;
  spentMinutes: number;
  performanceBp: number | null;
  provenance: Record<string, unknown>;
}

export interface TaskExecutionSprintAction {
  id: number;
  state: SprintActionState;
  decision: SprintDecision;
  version: number;
}

export interface TaskExecutionCalendarItem {
  id: number;
  state: 'pending' | 'active' | 'completed' | 'failed' | 'ignored' | 'archived';
  completedAt: string | null;
  version: number;
}

export interface TaskExecutionResult {
  execution: TaskExecution;
  sourceTask: TaskExecutionSourceTask;
  sprintAction: TaskExecutionSprintAction | null;
  calendarItem: TaskExecutionCalendarItem | null;
  replayed: boolean;
  refreshRequired: boolean;
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
const isDate = (value: unknown): value is string => {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};
const isTimestamp = (value: unknown): value is string =>
  isString(value)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value));
const isNullableText = (value: unknown): value is string | null => value === null || isString(value);
const isNullableNonEmptyText = (value: unknown): value is string | null => value === null || isText(value);
const isBasisPoints = (value: unknown): value is number => isInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
const isScalar = (value: unknown): value is SprintEvidenceScalar =>
  value === null
  || isString(value)
  || typeof value === 'boolean'
  || isNumber(value);
const isScalarRecord = (value: unknown): value is Record<string, SprintEvidenceScalar> =>
  isRecord(value)
  && Object.entries(value).every(([key, item]) => Boolean(key.trim()) && isScalar(item));
const isTextArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
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

const parseSprintSubjectProjection = (value: unknown): SprintSubjectProjection => {
  if (!isRecord(value)
    || !isPositive(value.subjectProfileId)
    || !isText(value.subjectKey)
    || !isText(value.displayName)
    || !oneOf(value.paper, ['P1', 'P2'] as const)
    || !isPositive(value.questionCount)
    || !isNumber(value.questionWeight)
    || value.questionWeight <= 0
    || !isBasisPoints(value.estimateBp)
    || !isBasisPoints(value.lowBp)
    || !isBasisPoints(value.highBp)
    || value.lowBp > value.estimateBp
    || value.estimateBp > value.highBp
    || !isNumber(value.effectiveSample)
    || value.effectiveSample < 0
    || !isBasisPoints(value.confidenceBp)
    || !isBasisPoints(value.fragilityBp)
    || !isNonNegative(value.representativeSetCount)
    || typeof value.demotionEligible !== 'boolean'
    || !isText(value.dominantOrigin)
    || !isTextArray(value.warnings)) invalid('sprint subject projection');
  return value as unknown as SprintSubjectProjection;
};

const parseSprintPaperProjection = (value: unknown): SprintPaperProjection => {
  if (!isRecord(value)
    || !inRange(value.projected, 0, 80)
    || !inRange(value.low, 0, 80)
    || !inRange(value.high, 0, 80)
    || value.low > value.projected
    || value.projected > value.high
    || !isNonNegative(value.floor)
    || value.floor > 80
    || !isNonNegative(value.stretch)
    || value.stretch > 80
    || value.floor > value.stretch
    || !(value.variance === null || (isNumber(value.variance) && value.variance >= 0))) {
    invalid('sprint paper projection');
  }
  return value as unknown as SprintPaperProjection;
};

export const parseSprintProjection = (value: unknown): SprintProjection => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !isDate(value.asOf)
    || !isText(value.formulaVersion)
    || value.scoreKind !== 'raw_weighted_equivalent_not_fcc_standardized'
    || !isRecord(value.interval)
    || value.interval.confidenceBp !== 9000
    || value.interval.kind !== 'normal_approximation_raw_equivalent'
    || !isRecord(value.p1)
    || !isRecord(value.p2)
    || !isRecord(value.weighted)
    || !inRange(value.weighted.projected, 0, 240)
    || !inRange(value.weighted.low, 0, 240)
    || !inRange(value.weighted.high, 0, 240)
    || value.weighted.low > value.weighted.projected
    || value.weighted.projected > value.weighted.high
    || value.weighted.target !== 204
    || !isNumber(value.weighted.distanceToTarget)
    || !isBasisPoints(value.confidenceBp)
    || !isText(value.dominantOrigin)
    || !isTextArray(value.warnings)
    || !Array.isArray(value.subjects)) invalid('sprint projection');
  const record = value as Record<string, unknown>;
  const p1 = parseSprintPaperProjection(record.p1);
  const p2 = parseSprintPaperProjection(record.p2);
  const subjects = (record.subjects as unknown[]).map(parseSprintSubjectProjection);
  if (new Set(subjects.map((subject) => subject.subjectKey)).size !== subjects.length) {
    invalid('sprint projection');
  }
  return {
    ...(value as unknown as SprintProjection),
    p1,
    p2,
    subjects,
  };
};

const parseSprintEvidenceObservation = (value: unknown): SprintEvidenceObservation => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !isText(value.targetSlug)
    || !isText(value.batchId)
    || !(value.subjectProfileId === null || isPositive(value.subjectProfileId))
    || !(value.subjectKey === null || isText(value.subjectKey))
    || !isText(value.discipline)
    || !isString(value.topicHint)
    || !isDate(value.observedOn)
    || !isText(value.origin)
    || !isText(value.sourceRecordId)
    || !isText(value.sourceRevision)
    || !isTimestamp(value.sourceUpdatedAt)
    || !oneOf(value.measurementType, [
      'full_exam', 'sectional_mock', 'unseen_set', 'mixed_set', 'error_review',
      'ls_percentage', 'sprint_action', 'baseline',
    ] as const)
    || !isString(value.examBoard)
    || !(
      (value.correctCount === null && value.wrongCount === null)
      || (isNonNegative(value.correctCount) && isNonNegative(value.wrongCount))
    )
    || !isNonNegative(value.doubtCount)
    || !isBasisPoints(value.percentageBp)
    || !(value.sampleSize === null || isNonNegative(value.sampleSize))
    || !oneOf(value.transferScope, ['content', 'method', 'trap_pattern'] as const)
    || !isBasisPoints(value.transferabilityBp)
    || !isString(value.contentHash)
    || !/^[0-9a-f]{64}$/.test(value.contentHash)
    || !isScalarRecord(value.provenance)) invalid('sprint evidence observation');
  const observation = value as unknown as SprintEvidenceObservation;
  if (observation.correctCount !== null && observation.wrongCount !== null) {
    const sampleSize = observation.correctCount + observation.wrongCount;
    if (observation.sampleSize !== sampleSize || observation.doubtCount > sampleSize) {
      invalid('sprint evidence observation');
    }
  } else if (observation.sampleSize !== null) {
    invalid('sprint evidence observation');
  }
  return observation;
};

export const parseSprintEvidenceList = (value: unknown): SprintEvidenceList => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !Array.isArray(value.items)
    || !isNonNegative(value.unresolvedCount)) invalid('sprint evidence list');
  const list = value as unknown as SprintEvidenceList;
  const items = (list.items as unknown[]).map(parseSprintEvidenceObservation);
  if (items.some((item) => item.targetSlug !== list.targetSlug)
    || items.filter((item) => item.subjectKey === null).length !== list.unresolvedCount) {
    invalid('sprint evidence list');
  }
  return { ...(value as unknown as SprintEvidenceList), items };
};

const parseSprintTrajectoryRun = (value: unknown, requireIdentity: boolean): SprintTrajectoryRun => {
  if (!isRecord(value)
    || !(value.runId === undefined || isPositive(value.runId))
    || !(value.date === undefined || isDate(value.date))
    || !inRange(value.p1, 0, 80)
    || !inRange(value.p2, 0, 80)
    || !(value.projection === null || isRecord(value.projection))
    || !(value.projectionOrigin === null || oneOf(value.projectionOrigin, ['derived', 'manual', 'legacy_manual'] as const))
    || !(value.confidenceBp === null || isBasisPoints(value.confidenceBp))
    || !inRange(value.weightedProjected, 0, 240)
    || !isNumber(value.distanceToTarget)
    || !isNullableNonEmptyText(value.dominantOrigin)
    || !isNullableNonEmptyText(value.formulaVersion)
    || !(value.generatedAt === undefined || isTimestamp(value.generatedAt))) invalid('sprint trajectory run');
  const run = value as unknown as SprintTrajectoryRun;
  if (requireIdentity && (!isPositive(run.runId) || !isDate(run.date) || !isTimestamp(run.generatedAt))) {
    invalid('sprint trajectory run');
  }
  const projection = run.projection === null ? null : parseSprintProjection(run.projection);
  if ((projection === null && run.projectionOrigin !== null && run.projectionOrigin !== 'legacy_manual')
    || (projection !== null && !oneOf(run.projectionOrigin, ['derived', 'manual'] as const))) {
    invalid('sprint trajectory run');
  }
  return { ...(value as unknown as SprintTrajectoryRun), projection };
};

export const parseSprintTrajectory = (value: unknown): SprintTrajectory => {
  if (!isRecord(value)
    || !isText(value.targetSlug)
    || !isRecord(value.latest)
    || !Array.isArray(value.runs)) invalid('sprint trajectory');
  const trajectory = value as unknown as SprintTrajectory;
  const latest = parseSprintTrajectoryRun(trajectory.latest, false);
  const runs = (trajectory.runs as unknown[]).map((run) => parseSprintTrajectoryRun(run, true));
  if ([latest, ...runs].some((run) => run.projection !== null && run.projection.targetSlug !== trajectory.targetSlug)) {
    invalid('sprint trajectory');
  }
  return { ...(value as unknown as SprintTrajectory), latest, runs };
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
    || !(value.projection === null || isRecord(value.projection))
    || !oneOf(value.projectionOrigin, ['derived', 'manual', 'legacy_manual'] as const)
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
  const day = value as unknown as SprintDay;
  const projection = day.projection === null ? null : parseSprintProjection(day.projection);
  if ((projection === null && day.projectionOrigin !== 'legacy_manual')
    || (projection !== null && day.projectionOrigin === 'legacy_manual')
    || (projection !== null && (
      projection.targetSlug !== day.targetSlug
      || projection.asOf !== day.date
      || projection.p1.projected !== day.projections.p1
      || projection.p2.projected !== day.projections.p2
    ))) invalid('sprint day');
  return {
    ...(value as unknown as SprintDay),
    projection,
    actions: ((value as Record<string, unknown>).actions as unknown[]).map(parseSprintAction),
  };
};

export const parseSourcePlanCycle = (value: unknown): SourcePlanCycle => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !oneOf(value.sourceKind, ['ls', 'trilha', 'manual'] as const)
    || !isText(value.planLabel)
    || !(value.metaNumber === null || isNonNegative(value.metaNumber))
    || !isTimestamp(value.releasedAt)
    || !isDate(value.startsOn)
    || !isDate(value.endsOn)
    || value.startsOn > value.endsOn
    || value.releasedAt.slice(0, 10) > value.endsOn
    || !isPositive(value.version)) invalid('source-plan cycle');
  return value as unknown as SourcePlanCycle;
};

export const parseSourcePlanBacklog = (value: unknown): SourcePlanBacklog => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || value.reason !== 'cycle_closed_pending'
    || !isNonNegative(value.returnScoreMilli)
    || !oneOf(value.state, ['candidate', 'recovered', 'dismissed'] as const)
    || !isDate(value.discoveredOn)
    || !(value.recoveredOn === null || isDate(value.recoveredOn))) invalid('source-plan backlog');
  return value as unknown as SourcePlanBacklog;
};

export const parseSourcePlanBacklogList = (value: unknown): SourcePlanBacklogList => {
  if (!isRecord(value) || !isText(value.targetSlug) || !Array.isArray(value.items)) {
    invalid('source-plan backlog list');
  }
  return {
    ...(value as unknown as SourcePlanBacklogList),
    items: ((value as Record<string, unknown>).items as unknown[]).map(parseSourcePlanBacklog),
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
    || !isNonNegative(value.cycleOverrunCount)
    || !(value.cycle === null || isRecord(value.cycle))
    || !Array.isArray(value.taskIds)
    || !value.taskIds.every(isPositive)
    || typeof value.replayed !== 'boolean') invalid('source plan import');
  return {
    ...(value as unknown as SourcePlanImportResult),
    cycle: (value as Record<string, unknown>).cycle === null
      ? null
      : parseSourcePlanCycle((value as Record<string, unknown>).cycle),
  };
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
    || !(value.cycle === null || isRecord(value.cycle))
    || !(value.backlog === null || isRecord(value.backlog))
    || !isPositive(value.version)) invalid('source-plan task');
  return {
    ...(value as unknown as SourcePlanTask),
    cycle: (value as Record<string, unknown>).cycle === null
      ? null
      : parseSourcePlanCycle((value as Record<string, unknown>).cycle),
    backlog: (value as Record<string, unknown>).backlog === null
      ? null
      : parseSourcePlanBacklog((value as Record<string, unknown>).backlog),
  };
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

const executionOutcomes = ['started', 'completed', 'failed', 'skipped'] as const;

export const parseTaskExecution = (value: unknown): TaskExecution => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !oneOf(value.outcome, executionOutcomes)
    || !isDate(value.performedOn)
    || !isNonNegative(value.taskMinutes)
    || !isNonNegative(value.exerciseMinutes)
    || value.exerciseMinutes > value.taskMinutes
    || !isNonNegative(value.questionsTotal)
    || !isNonNegative(value.correctCount)
    || !isNonNegative(value.wrongCount)
    || !isNonNegative(value.doubtCount)
    || value.correctCount + value.wrongCount > value.questionsTotal
    || value.doubtCount > value.questionsTotal
    || !(value.performanceBp === null || isBasisPoints(value.performanceBp))
    || !(value.energyAfter === null || inRange(value.energyAfter, 1, 5))
    || !isString(value.notes)
    || !isTimestamp(value.recordedAt)
    || !isPositive(value.version)) invalid('task execution');
  const execution = value as Record<string, unknown>;
  const expectedPerformanceBp = (execution.correctCount as number) + (execution.wrongCount as number) === 0
    ? null
    : Math.round(((execution.correctCount as number) * 10000) / ((execution.correctCount as number) + (execution.wrongCount as number)));
  if (execution.performanceBp !== expectedPerformanceBp) invalid('task execution');
  return value as unknown as TaskExecution;
};

const parseTaskExecutionSourceTask = (value: unknown): TaskExecutionSourceTask => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !isText(value.targetSlug)
    || !oneOf(value.status, ['pending', 'started', 'completed', 'ignored', 'archived'] as const)
    || !isNonNegative(value.spentMinutes)
    || !(value.performanceBp === null || isBasisPoints(value.performanceBp))
    || !isRecord(value.provenance)) invalid('task execution source task');
  return value as unknown as TaskExecutionSourceTask;
};

const parseTaskExecutionSprintAction = (value: unknown): TaskExecutionSprintAction => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !oneOf(value.state, ['pending', 'active', 'completed', 'skipped', 'failed'] as const)
    || !oneOf(value.decision, ['pending', 'accepted', 'rejected'] as const)
    || !isPositive(value.version)) invalid('task execution sprint action');
  return value as unknown as TaskExecutionSprintAction;
};

const parseTaskExecutionCalendarItem = (value: unknown): TaskExecutionCalendarItem => {
  if (!isRecord(value)
    || !isPositive(value.id)
    || !oneOf(value.state, ['pending', 'active', 'completed', 'failed', 'ignored', 'archived'] as const)
    || !(value.completedAt === null || isTimestamp(value.completedAt))
    || !isPositive(value.version)) invalid('task execution calendar item');
  return value as unknown as TaskExecutionCalendarItem;
};

export const parseTaskExecutionResult = (value: unknown): TaskExecutionResult => {
  if (!isRecord(value)
    || !isRecord(value.execution)
    || !isRecord(value.sourceTask)
    || !(value.sprintAction === null || isRecord(value.sprintAction))
    || !(value.calendarItem === null || isRecord(value.calendarItem))
    || typeof value.replayed !== 'boolean'
    || typeof value.refreshRequired !== 'boolean') invalid('task execution result');
  const result = value as Record<string, unknown>;
  const execution = parseTaskExecution(result.execution);
  const sourceTask = parseTaskExecutionSourceTask(result.sourceTask);
  const sprintAction = result.sprintAction === null ? null : parseTaskExecutionSprintAction(result.sprintAction);
  const calendarItem = result.calendarItem === null ? null : parseTaskExecutionCalendarItem(result.calendarItem);
  if (sourceTask.performanceBp !== execution.performanceBp) invalid('task execution result');
  return { ...(value as unknown as TaskExecutionResult), execution, sourceTask, sprintAction, calendarItem };
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

export const fetchSprintProjection = async (
  targetSlug: string,
  asOf?: string,
  signal?: AbortSignal,
): Promise<SprintProjection> => {
  const query = new URLSearchParams({ targetSlug });
  if (asOf) query.set('asOf', asOf);
  return parseSprintProjection(await requestJson(`/api/v1/sprints/projection?${query}`, { signal }));
};

export const fetchSprintEvidence = async (
  targetSlug: string,
  signal?: AbortSignal,
): Promise<SprintEvidenceList> => {
  const query = new URLSearchParams({ targetSlug });
  return parseSprintEvidenceList(await requestJson(`/api/v1/sprints/evidence?${query}`, { signal }));
};

export const fetchSprintTrajectory = async (
  targetSlug: string,
  signal?: AbortSignal,
): Promise<SprintTrajectory> => {
  const query = new URLSearchParams({ targetSlug });
  return parseSprintTrajectory(await requestJson(`/api/v1/sprints/trajectory?${query}`, { signal }));
};

export const updateSprintAction = async (
  actionId: number,
  input: SprintActionResultInput,
  idempotencyKey: string,
): Promise<SprintAction> => parseSprintAction(await requestJson(
  `/api/v1/sprints/actions/${actionId}`, jsonMutation('PUT', input, idempotencyKey),
));

export const recordSourceTaskExecution = async (
  taskId: number,
  input: SourceTaskExecutionInput,
  idempotencyKey: string,
): Promise<TaskExecutionResult> => parseTaskExecutionResult(await requestJson(
  `/api/v1/source-plans/tasks/${taskId}/executions`, jsonMutation('POST', input, idempotencyKey),
));

export const importSourcePlan = async (
  input: ImportSourcePlanInput,
  idempotencyKey: string,
): Promise<SourcePlanImportResult> => parseImportResult(await requestJson(
  '/api/v1/source-plans/import', jsonMutation('POST', input, idempotencyKey),
));

export function fetchSourcePlanTasks(
  targetSlug: string,
  date?: string,
  signal?: AbortSignal,
): Promise<SourcePlanTaskList>;
export function fetchSourcePlanTasks(
  targetSlug: string,
  date: string | undefined,
  includeInactive: boolean,
  signal?: AbortSignal,
): Promise<SourcePlanTaskList>;
export async function fetchSourcePlanTasks(
  targetSlug: string,
  date?: string,
  includeInactiveOrSignal?: boolean | AbortSignal,
  trailingSignal?: AbortSignal,
): Promise<SourcePlanTaskList> {
  const includeInactive = typeof includeInactiveOrSignal === 'boolean' ? includeInactiveOrSignal : false;
  const signal = typeof includeInactiveOrSignal === 'boolean' ? trailingSignal : includeInactiveOrSignal;
  const query = new URLSearchParams({ targetSlug });
  if (date) query.set('date', date);
  if (includeInactive) query.set('includeInactive', 'true');
  return parseSourcePlanTaskList(await requestJson(`/api/v1/source-plans/tasks?${query}`, { signal }));
}

export const fetchSourcePlanBacklog = async (
  targetSlug: string,
  includeAll = false,
  signal?: AbortSignal,
): Promise<SourcePlanBacklogList> => {
  const query = new URLSearchParams({ targetSlug });
  if (includeAll) query.set('includeAll', 'true');
  return parseSourcePlanBacklogList(await requestJson(`/api/v1/source-plans/backlog?${query}`, { signal }));
};
