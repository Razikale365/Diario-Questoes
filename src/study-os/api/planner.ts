import { requestJson } from './client';

export type PlannerPhase = 'pre_edital' | 'pos_edital';
export type CoverageStatus = 'unread' | 'in_progress' | 'covered' | 'stale' | 'weak' | 'strong';
export type TransferKind = 'target_specific' | 'shared' | 'partial';
export type PlannerSourceKind = 'course' | 'tec' | 'ls' | 'trilha' | 'manual' | 'bizu';
export type PlannerBlockKind = 'theory' | 'questions' | 'review';
export type PlannerBlockState = 'pending' | 'active' | 'completed' | 'skipped' | 'failed';
export type PlannerStrategySourceKind = 'course' | 'passo' | 'trilha' | 'ls' | 'andrety' | 'tec' | 'manual';
export type PlannerSourceContentRole = 'primary_theory' | 'review_support' | 'question_practice' | 'schedule_advice' | 'incidence_signal';

export interface PlannerSourceChoiceEvidence {
  algorithmVersion: string;
  sourceId: number;
  sourceItemId: number;
  sourceKind: PlannerStrategySourceKind;
  displayName: string;
  contentRole: PlannerSourceContentRole;
  sourceTargetSlug: string;
  targetFitBp: number;
  transferConfidenceBp: number;
  trustBp: number;
  freshnessBp: number;
  orderReadinessBp: number;
  strategyAlignmentBp: number;
  materialAvailabilityBp: number;
  lowTrustPenaltyBp: number;
  mismatchPenaltyBp: number;
  incidenceBp: number;
  banca: string;
  targetBanca: string;
  bancaFitBp: number;
  choiceContext: Record<string, unknown>;
  edition: string;
  lessonId: number | null;
  materialId: number | null;
  materialKind: string | null;
  externalUrl: string | null;
  externalId: string | null;
  mappingStatus: 'proposed' | 'approved' | 'rejected';
  mappingConfidenceBp: number;
  primaryEligible: boolean;
  manualOverride: boolean;
  transferKind: TransferKind;
  stopReason: string | null;
  finalScore: number;
}

export interface PlannerSourceAlternative {
  choiceRowId: number;
  sourceItemId: number;
  chosen: boolean;
  displacedByRowId: number | null;
  stopReason: string | null;
  finalScore: number;
  evidence: PlannerSourceChoiceEvidence;
}

export interface PlannerChosenSource {
  status: 'chosen';
  choiceRunId: number;
  choiceRowId: number;
  sourceItemId: number;
  sourceKind: PlannerStrategySourceKind;
  displayName: string;
  contentRole: PlannerSourceContentRole;
  sourceTargetSlug: string;
  lessonId: number | null;
  materialId: number | null;
  externalUrl: string | null;
  externalId: string | null;
  finalScore: number;
  evidence: PlannerSourceChoiceEvidence;
  alternatives: PlannerSourceAlternative[];
}

export interface PlannerSourceShortfall {
  status: 'shortfall';
  choiceRunId: number;
  shortfallReason: string | null;
  alternatives: PlannerSourceAlternative[];
}

export type PlannerSourceChoice = PlannerChosenSource | PlannerSourceShortfall;

export interface PlannerTarget {
  targetSlug: string;
  displayName: string;
  institution: string;
  role: string;
  banca: string;
  phase: PlannerPhase;
  deadline: string | null;
  dailyQuota: number;
  priorityScore: number;
  sourceUrls: string[];
  notes: string;
  active: boolean;
  version: number;
}

export interface TargetTopic {
  id: number;
  targetSlug: string;
  discipline: string;
  topic: string;
  coverageStatus: CoverageStatus;
  editalWeight: number;
  incidence: number;
  tier: number;
  bancaFit: number;
  overlapValue: number;
  transferKind: TransferKind;
  sourceKind: PlannerSourceKind;
  lessonId: number | null;
  materialId: number | null;
  tecSourceUrl: string | null;
  tecSourceId: string | null;
  plannedQuestions: number;
  reviewDebt: number;
  notes: string;
  active: boolean;
  version: number;
}

export interface PlannerRun {
  id: number;
  targetSlug: string;
  date: string;
  phase: PlannerPhase;
  dailyQuota: number;
  timeBudgetMinutes: number;
  algorithmVersion: string;
  inputHash: string;
  supersedesRunId: number | null;
  status: 'generated' | 'shortfall';
  shortfallCount: number;
  shortfallReasons: string[];
  generatedAt: string;
}

export interface PlannerWeekRun {
  id: number;
  targetSlug: string;
  weekStart: string;
  phase: PlannerPhase;
  algorithmVersion: string;
  requestHash: string;
  inputHash: string;
  supersedesWeekRunId: number | null;
  status: 'generated' | 'shortfall';
  shortfallCount: number;
  shortfallReasons: string[];
  generatedAt: string;
}

export interface PlannerScoreBreakdown {
  weakness: number;
  incidence: number;
  tier: number;
  coverageNeed: number;
  reviewDebt: number;
  lsAlignment: number;
  targetFit: number;
  overlapValue: number;
  deadlinePressure: number;
  bancaFit: number;
  editalWeight: number;
  balancePenalty: number;
  lowTrustPenalty: number;
  weeklyAlignment: number;
  finalScore: number;
}

export interface PlannerCandidateEvidence {
  targetTopicId: number;
  selectedTargetSlug: string;
  sourceTargetSlug: string;
  transferKind: TransferKind;
  transferConfidence: number;
  coverageStatus: CoverageStatus;
  incidence: number;
  tier: number;
  bancaFit: number;
  overlapValue: number;
  editalWeight: number;
  profileSourceKind: PlannerSourceKind;
  materialMappingPresent: boolean;
  lessonId: number | null;
  materialId: number | null;
  materialKind: string | null;
  materialTrust: number | null;
  progressStatus: CoverageStatus | null;
  cursorPage: number | null;
  pageCount: number | null;
  tecSourceUrl: string | null;
  tecSourceId: string | null;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  failedSessions: number;
  skippedBlocks: number;
  weakProgress: boolean;
  reviewDebt: number;
  stopReason: string | null;
}

export interface PlannerScoreEvidence {
  algorithmVersion: string;
  inputHash: string;
  candidateKey: string;
  targetSlug: string;
  phase: PlannerPhase;
  components: PlannerScoreBreakdown;
  weightsMilli: Record<string, number>;
  penaltyWeightsMilli: Record<string, number>;
}

export interface PlannerEvidence {
  candidateEvidence: PlannerCandidateEvidence;
  scoreEvidence: PlannerScoreEvidence;
}

export interface PlannerCandidate {
  id: number;
  runId: number;
  candidateKey: string;
  targetSlug: string;
  discipline: string;
  topic: string;
  blockKind: PlannerBlockKind;
  sourceKind: PlannerSourceKind;
  targetTopicId: number | null;
  lessonId: number | null;
  materialId: number | null;
  durationMinutes: number;
  plannedQuestions: number;
  scoreBreakdown: PlannerScoreBreakdown;
  chosenPosition: number | null;
  displacedBy: string | null;
  stopReason: string | null;
  evidence: PlannerEvidence;
  sourceChoice?: PlannerSourceChoice | null;
  adaptationReason: string;
}

export interface PlannerBlock {
  id: number;
  runId: number;
  candidateId: number;
  targetSlug: string;
  date: string;
  position: number;
  blockKind: PlannerBlockKind;
  title: string;
  durationMinutes: number;
  plannedQuestions: number;
  state: PlannerBlockState;
  executionSessionId: number | null;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  version: number;
  discipline?: string;
  topic?: string;
  sourceKind?: PlannerSourceKind;
  lessonId?: number | null;
  materialId?: number | null;
  scoreBreakdown?: PlannerScoreBreakdown;
  evidence?: PlannerEvidence;
  sourceChoice?: PlannerSourceChoice | null;
  adaptationReason?: string;
}

export interface PlannerDay {
  run: PlannerRun;
  blocks: PlannerBlock[];
  scoreboard: PlannerCandidate[];
}

export interface PlannerWeekSlotEvidence {
  discipline: string;
  topic: string;
  adaptationReason: string;
  candidateEvidence: Record<string, unknown>;
}

export interface PlannerWeekSlot {
  id: number;
  weekRunId: number;
  targetSlug: string;
  date: string;
  position: number;
  candidateKey: string;
  topicTargetSlug: string;
  targetTopicId: number;
  blockKind: PlannerBlockKind;
  durationMinutes: number;
  plannedQuestions: number;
  score: PlannerScoreBreakdown;
  evidence: PlannerWeekSlotEvidence;
  sourceChoice?: PlannerSourceChoice | null;
  state: 'forecast' | 'materialized' | 'skipped';
  dayRunId: number | null;
  dayBlockId: number | null;
}

export interface PlannerWeek {
  run: PlannerWeekRun;
  slots: PlannerWeekSlot[];
}

export interface PlannerTargetList { items: PlannerTarget[] }
export interface TargetTopicList { items: TargetTopic[] }
export interface PlannerScoreboard { items: PlannerCandidate[] }

export type PlannerTargetUpdate = Partial<Omit<PlannerTarget, 'targetSlug' | 'version'>> & {
  targetSlug: string;
  expectedVersion: number;
};

export type TargetTopicUpdate = Partial<Omit<TargetTopic, 'targetSlug' | 'version'>> & {
  id?: number;
  expectedVersion?: number;
};

export interface GeneratePlannerDayInput {
  targetSlug: string;
  date: string;
  timeBudgetMinutes?: number;
  lsTargetSlug?: string;
}

export interface RefreshPlannerDayInput extends GeneratePlannerDayInput {
  previousRunId: number;
}

export interface GeneratePlannerWeekInput {
  targetSlug: string;
  weekStart: string;
  dailyQuotas?: Record<string, number>;
  dailyTimeBudgets?: Record<string, number>;
}

export interface RefreshPlannerWeekInput extends GeneratePlannerWeekInput {
  previousWeekRunId: number;
}

export interface PlannerBlockResultInput {
  state: Extract<PlannerBlockState, 'completed' | 'skipped' | 'failed'>;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  expectedVersion: number;
}

const phases = ['pre_edital', 'pos_edital'] as const;
const coverageStatuses = ['unread', 'in_progress', 'covered', 'stale', 'weak', 'strong'] as const;
const transferKinds = ['target_specific', 'shared', 'partial'] as const;
const sourceKinds = ['course', 'tec', 'ls', 'trilha', 'manual', 'bizu'] as const;
const blockKinds = ['theory', 'questions', 'review'] as const;
const blockStates = ['pending', 'active', 'completed', 'skipped', 'failed'] as const;
const weekSlotStates = ['forecast', 'materialized', 'skipped'] as const;
const strategySourceKinds = ['course', 'passo', 'trilha', 'ls', 'andrety', 'tec', 'manual'] as const;
const sourceContentRoles = ['primary_theory', 'review_support', 'question_practice', 'schedule_advice', 'incidence_signal'] as const;
const mappingStatuses = ['proposed', 'approved', 'rejected'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => isString(value) && Boolean(value.trim());
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isPositiveInteger = (value: unknown): value is number => isInteger(value) && value > 0;
const isNonNegativeInteger = (value: unknown): value is number => isInteger(value) && value >= 0;
const isNullablePositiveInteger = (value: unknown): value is number | null =>
  value === null || isPositiveInteger(value);
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);
const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isNullableIsoDate = (value: unknown): value is string | null => value === null || isIsoDate(value);

const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS planner ${label} response`);
};

const parseNumberRecord = (value: unknown, label: string): Record<string, number> => {
  if (!isRecord(value) || !Object.values(value).every((item) => isInteger(item))) invalid(label);
  return value as Record<string, number>;
};

export function parsePlannerTarget(value: unknown): PlannerTarget {
  if (!isRecord(value)
    || !isNonEmptyString(value.targetSlug)
    || !isNonEmptyString(value.displayName)
    || !isNonEmptyString(value.institution)
    || !isNonEmptyString(value.role)
    || !isNonEmptyString(value.banca)
    || !oneOf(value.phase, phases)
    || !isNullableIsoDate(value.deadline)
    || !isPositiveInteger(value.dailyQuota)
    || value.dailyQuota > 8
    || !isFiniteInRange(value.priorityScore, 0, 100)
    || !Array.isArray(value.sourceUrls)
    || !value.sourceUrls.every(isNonEmptyString)
    || !isString(value.notes)
    || typeof value.active !== 'boolean'
    || !isPositiveInteger(value.version)) invalid('target');
  return value as unknown as PlannerTarget;
}

export function parsePlannerTargetList(value: unknown): PlannerTargetList {
  const record = isRecord(value) ? value : invalid('target list');
  const items = record.items;
  if (!Array.isArray(items)) invalid('target list');
  return { items: (items as unknown[]).map(parsePlannerTarget) };
}

export function parseTargetTopic(value: unknown): TargetTopic {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isNonEmptyString(value.targetSlug)
    || !isNonEmptyString(value.discipline)
    || !isNonEmptyString(value.topic)
    || !oneOf(value.coverageStatus, coverageStatuses)
    || !isFiniteInRange(value.editalWeight, 0, 10)
    || !isFiniteInRange(value.incidence, 0, 100)
    || !isInteger(value.tier)
    || value.tier < 1
    || value.tier > 5
    || !isFiniteInRange(value.bancaFit, 0, 100)
    || !isFiniteInRange(value.overlapValue, 0, 100)
    || !oneOf(value.transferKind, transferKinds)
    || !oneOf(value.sourceKind, sourceKinds)
    || !isNullablePositiveInteger(value.lessonId)
    || !isNullablePositiveInteger(value.materialId)
    || (value.materialId !== null && value.lessonId === null)
    || !isNullableString(value.tecSourceUrl)
    || !isNullableString(value.tecSourceId)
    || !isNonNegativeInteger(value.plannedQuestions)
    || !isFiniteInRange(value.reviewDebt, 0, 100)
    || !isString(value.notes)
    || typeof value.active !== 'boolean'
    || !isPositiveInteger(value.version)) invalid('topic');
  return value as unknown as TargetTopic;
}

export function parseTargetTopicList(value: unknown): TargetTopicList {
  const record = isRecord(value) ? value : invalid('topic list');
  const items = record.items;
  if (!Array.isArray(items)) invalid('topic list');
  return { items: (items as unknown[]).map(parseTargetTopic) };
}

export function parsePlannerRun(value: unknown): PlannerRun {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isNonEmptyString(value.targetSlug)
    || !isIsoDate(value.date)
    || !oneOf(value.phase, phases)
    || !isPositiveInteger(value.dailyQuota)
    || !isPositiveInteger(value.timeBudgetMinutes)
    || !isNonEmptyString(value.algorithmVersion)
    || !isNonEmptyString(value.inputHash)
    || !isNullablePositiveInteger(value.supersedesRunId)
    || !oneOf(value.status, ['generated', 'shortfall'] as const)
    || !isNonNegativeInteger(value.shortfallCount)
    || !Array.isArray(value.shortfallReasons)
    || !value.shortfallReasons.every(isNonEmptyString)
    || value.shortfallReasons.length !== value.shortfallCount
    || (value.status === 'generated' && value.shortfallCount !== 0)
    || (value.status === 'shortfall' && value.shortfallCount < 1)
    || !isNonEmptyString(value.generatedAt)) invalid('run');
  return value as unknown as PlannerRun;
}

export function parsePlannerScore(value: unknown): PlannerScoreBreakdown {
  const record = isRecord(value) ? value : invalid('score');
  const boundedKeys = [
    'weakness', 'incidence', 'tier', 'coverageNeed', 'reviewDebt', 'lsAlignment',
    'targetFit', 'overlapValue', 'deadlinePressure', 'bancaFit', 'editalWeight',
    'balancePenalty', 'lowTrustPenalty', 'weeklyAlignment',
  ];
  if (!boundedKeys.every((key) => isInteger(record[key]) && Number(record[key]) >= 0 && Number(record[key]) <= 10000)
    || !isInteger(record.finalScore)) invalid('score');
  return record as unknown as PlannerScoreBreakdown;
}

function parseCandidateEvidence(value: unknown): PlannerCandidateEvidence {
  const record = isRecord(value) ? value : invalid('evidence');
  if (!isPositiveInteger(record.targetTopicId)
    || !isNonEmptyString(record.selectedTargetSlug)
    || !isNonEmptyString(record.sourceTargetSlug)
    || !oneOf(record.transferKind, transferKinds)
    || !isFiniteInRange(record.transferConfidence, 0, 100)
    || !oneOf(record.coverageStatus, coverageStatuses)
    || !isFiniteInRange(record.incidence, 0, 100)
    || !isInteger(record.tier)
    || !isFiniteInRange(record.bancaFit, 0, 100)
    || !isFiniteInRange(record.overlapValue, 0, 100)
    || !isFiniteInRange(record.editalWeight, 0, 10)
    || !oneOf(record.profileSourceKind, sourceKinds)
    || typeof record.materialMappingPresent !== 'boolean'
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId)
    || !isNullableString(record.materialKind)
    || !(record.materialTrust === null || isFiniteInRange(record.materialTrust, 0, 10))
    || !(record.progressStatus === null || oneOf(record.progressStatus, coverageStatuses))
    || !isNullablePositiveInteger(record.cursorPage)
    || !isNullablePositiveInteger(record.pageCount)
    || !isNullableString(record.tecSourceUrl)
    || !isNullableString(record.tecSourceId)
    || !isNonNegativeInteger(record.wrongCount)
    || !isNonNegativeInteger(record.doubtCount)
    || !isNonNegativeInteger(record.favoriteCount)
    || !isNonNegativeInteger(record.failedSessions)
    || !isNonNegativeInteger(record.skippedBlocks)
    || typeof record.weakProgress !== 'boolean'
    || !isFiniteInRange(record.reviewDebt, 0, 100)
    || !isNullableString(record.stopReason)) invalid('evidence');
  return record as unknown as PlannerCandidateEvidence;
}

function parseScoreEvidence(value: unknown): PlannerScoreEvidence {
  const record = isRecord(value) ? value : invalid('evidence');
  if (!isNonEmptyString(record.algorithmVersion)
    || !isNonEmptyString(record.inputHash)
    || !isNonEmptyString(record.candidateKey)
    || !isNonEmptyString(record.targetSlug)
    || !oneOf(record.phase, phases)) invalid('evidence');
  return {
    algorithmVersion: record.algorithmVersion as string,
    inputHash: record.inputHash as string,
    candidateKey: record.candidateKey as string,
    targetSlug: record.targetSlug as string,
    phase: record.phase as PlannerPhase,
    components: parsePlannerScore(record.components),
    weightsMilli: parseNumberRecord(record.weightsMilli, 'evidence'),
    penaltyWeightsMilli: parseNumberRecord(record.penaltyWeightsMilli, 'evidence'),
  };
}

export function parsePlannerEvidence(value: unknown): PlannerEvidence {
  const record = isRecord(value) ? value : invalid('evidence');
  return {
    candidateEvidence: parseCandidateEvidence(record.candidateEvidence),
    scoreEvidence: parseScoreEvidence(record.scoreEvidence),
  };
}

function parseSourceChoiceEvidence(value: unknown): PlannerSourceChoiceEvidence {
  const record = isRecord(value) ? value : invalid('source choice evidence');
  const basisPointKeys = [
    'targetFitBp', 'transferConfidenceBp', 'trustBp', 'freshnessBp',
    'orderReadinessBp', 'strategyAlignmentBp', 'materialAvailabilityBp',
    'lowTrustPenaltyBp', 'mismatchPenaltyBp', 'incidenceBp', 'bancaFitBp',
    'mappingConfidenceBp',
  ];
  if (!isNonEmptyString(record.algorithmVersion)
    || !isPositiveInteger(record.sourceId)
    || !isPositiveInteger(record.sourceItemId)
    || !oneOf(record.sourceKind, strategySourceKinds)
    || !isNonEmptyString(record.displayName)
    || !oneOf(record.contentRole, sourceContentRoles)
    || !isNonEmptyString(record.sourceTargetSlug)
    || !basisPointKeys.every((key) => isInteger(record[key]) && Number(record[key]) >= 0 && Number(record[key]) <= 10000)
    || !isString(record.banca)
    || !isString(record.targetBanca)
    || !isRecord(record.choiceContext)
    || !isString(record.edition)
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId)
    || !isNullableString(record.materialKind)
    || !isNullableString(record.externalUrl)
    || !isNullableString(record.externalId)
    || !oneOf(record.mappingStatus, mappingStatuses)
    || typeof record.primaryEligible !== 'boolean'
    || typeof record.manualOverride !== 'boolean'
    || !oneOf(record.transferKind, transferKinds)
    || !isNullableString(record.stopReason)
    || !isInteger(record.finalScore)) invalid('source choice evidence');
  return record as unknown as PlannerSourceChoiceEvidence;
}

function parseSourceAlternative(value: unknown): PlannerSourceAlternative {
  const record = isRecord(value) ? value : invalid('source alternative');
  if (!isPositiveInteger(record.choiceRowId)
    || !isPositiveInteger(record.sourceItemId)
    || typeof record.chosen !== 'boolean'
    || !isNullablePositiveInteger(record.displacedByRowId)
    || !isNullableString(record.stopReason)
    || !isInteger(record.finalScore)) invalid('source alternative');
  const evidence = parseSourceChoiceEvidence(record.evidence);
  if (evidence.sourceItemId !== record.sourceItemId || evidence.finalScore !== record.finalScore) {
    invalid('source alternative');
  }
  return { ...record, evidence } as unknown as PlannerSourceAlternative;
}

export function parsePlannerSourceChoice(value: unknown): PlannerSourceChoice | null {
  if (value === null) return null;
  const record = isRecord(value) ? value : invalid('source choice');
  if (!isPositiveInteger(record.choiceRunId) || !Array.isArray(record.alternatives)) {
    invalid('source choice');
  }
  const alternatives = (record.alternatives as unknown[]).map(parseSourceAlternative);
  if (record.status === 'shortfall') {
    if (!isNullableString(record.shortfallReason)) invalid('source choice');
    return { ...record, alternatives } as unknown as PlannerSourceShortfall;
  }
  if (record.status !== 'chosen'
    || !isPositiveInteger(record.choiceRowId)
    || !isPositiveInteger(record.sourceItemId)
    || !oneOf(record.sourceKind, strategySourceKinds)
    || !isNonEmptyString(record.displayName)
    || !oneOf(record.contentRole, sourceContentRoles)
    || !isNonEmptyString(record.sourceTargetSlug)
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId)
    || !isNullableString(record.externalUrl)
    || !isNullableString(record.externalId)
    || !isInteger(record.finalScore)) invalid('source choice');
  const evidence = parseSourceChoiceEvidence(record.evidence);
  if (evidence.sourceItemId !== record.sourceItemId || evidence.finalScore !== record.finalScore) {
    invalid('source choice');
  }
  return { ...record, evidence, alternatives } as unknown as PlannerChosenSource;
}

export function parsePlannerCandidate(value: unknown): PlannerCandidate {
  const record = isRecord(value) ? value : invalid('candidate');
  if (!isPositiveInteger(record.id)
    || !isPositiveInteger(record.runId)
    || !isNonEmptyString(record.candidateKey)
    || !isNonEmptyString(record.targetSlug)
    || !isNonEmptyString(record.discipline)
    || !isNonEmptyString(record.topic)
    || !oneOf(record.blockKind, blockKinds)
    || !oneOf(record.sourceKind, sourceKinds)
    || !isNullablePositiveInteger(record.targetTopicId)
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId)
    || !isPositiveInteger(record.durationMinutes)
    || record.durationMinutes < 45
    || record.durationMinutes > 75
    || !isNonNegativeInteger(record.plannedQuestions)
    || (record.blockKind === 'theory' && record.plannedQuestions !== 0)
    || (record.blockKind !== 'theory' && record.plannedQuestions < 1)
    || !isNullablePositiveInteger(record.chosenPosition)
    || !isNullableString(record.displacedBy)
    || !isNullableString(record.stopReason)
    || !isNonEmptyString(record.adaptationReason)
    || (record.chosenPosition !== null && (record.displacedBy !== null || record.stopReason !== null))) invalid('candidate');
  const score = parsePlannerScore(record.scoreBreakdown);
  const evidence = parsePlannerEvidence(record.evidence);
  if (evidence.scoreEvidence.candidateKey !== record.candidateKey
    || evidence.scoreEvidence.components.finalScore !== score.finalScore) invalid('evidence');
  const sourceChoice = record.sourceChoice === undefined
    ? undefined
    : parsePlannerSourceChoice(record.sourceChoice);
  return {
    ...record,
    scoreBreakdown: score,
    evidence,
    ...(sourceChoice === undefined ? {} : { sourceChoice }),
  } as unknown as PlannerCandidate;
}

export function parsePlannerBlock(value: unknown, requireCandidate = false): PlannerBlock {
  const record = isRecord(value) ? value : invalid('block');
  if (!isPositiveInteger(record.id)
    || !isPositiveInteger(record.runId)
    || !isPositiveInteger(record.candidateId)
    || !isNonEmptyString(record.targetSlug)
    || !isIsoDate(record.date)
    || !isPositiveInteger(record.position)
    || !oneOf(record.blockKind, blockKinds)
    || !isNonEmptyString(record.title)
    || !isPositiveInteger(record.durationMinutes)
    || !isNonNegativeInteger(record.plannedQuestions)
    || !oneOf(record.state, blockStates)
    || !isNullablePositiveInteger(record.executionSessionId)
    || !isNonNegativeInteger(record.questionsDone)
    || !isNonNegativeInteger(record.correctCount)
    || !isNonNegativeInteger(record.wrongCount)
    || !isNonNegativeInteger(record.doubtCount)
    || !isNonNegativeInteger(record.favoriteCount)
    || Number(record.correctCount) + Number(record.wrongCount) > Number(record.questionsDone)
    || !isPositiveInteger(record.version)) invalid('block');
  if (requireCandidate && (!isNonEmptyString(record.discipline)
    || !isNonEmptyString(record.topic)
    || !oneOf(record.sourceKind, sourceKinds)
    || !isNonEmptyString(record.adaptationReason)
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId))) invalid('block');
  const parsed = { ...record };
  if (requireCandidate) {
    parsed.scoreBreakdown = parsePlannerScore(record.scoreBreakdown);
    parsed.evidence = parsePlannerEvidence(record.evidence);
    if (record.sourceChoice !== undefined) parsed.sourceChoice = parsePlannerSourceChoice(record.sourceChoice);
  }
  return parsed as unknown as PlannerBlock;
}

export function parsePlannerDay(value: unknown): PlannerDay {
  const record = isRecord(value) ? value : invalid('day');
  const blockItems = record.blocks;
  const scoreboardItems = record.scoreboard;
  if (!Array.isArray(blockItems) || !Array.isArray(scoreboardItems)) invalid('day');
  const run = parsePlannerRun(record.run);
  const blocks = (blockItems as unknown[]).map((item) => parsePlannerBlock(item, true));
  const scoreboard = (scoreboardItems as unknown[]).map(parsePlannerCandidate);
  if (!blocks.every((item) => item.runId === run.id && item.targetSlug === run.targetSlug)
    || !scoreboard.every((item) => item.runId === run.id && item.targetSlug === run.targetSlug)) invalid('day');
  return { run, blocks, scoreboard };
}

export function parsePlannerScoreboard(value: unknown): PlannerScoreboard {
  const record = isRecord(value) ? value : invalid('scoreboard');
  const items = record.items;
  if (!Array.isArray(items)) invalid('scoreboard');
  return { items: (items as unknown[]).map(parsePlannerCandidate) };
}

function parsePlannerWeekRun(value: unknown): PlannerWeekRun {
  const record = isRecord(value) ? value : invalid('week run');
  if (!isPositiveInteger(record.id)
    || !isNonEmptyString(record.targetSlug)
    || !isIsoDate(record.weekStart)
    || new Date(`${record.weekStart}T00:00:00Z`).getUTCDay() !== 1
    || !oneOf(record.phase, phases)
    || !isNonEmptyString(record.algorithmVersion)
    || !isNonEmptyString(record.requestHash)
    || !isNonEmptyString(record.inputHash)
    || !isNullablePositiveInteger(record.supersedesWeekRunId)
    || !oneOf(record.status, ['generated', 'shortfall'] as const)
    || !isNonNegativeInteger(record.shortfallCount)
    || !Array.isArray(record.shortfallReasons)
    || !record.shortfallReasons.every(isNonEmptyString)
    || record.shortfallReasons.length !== record.shortfallCount
    || (record.status === 'generated' && record.shortfallCount !== 0)
    || (record.status === 'shortfall' && record.shortfallCount < 1)
    || !isNonEmptyString(record.generatedAt)) invalid('week run');
  return record as unknown as PlannerWeekRun;
}

function parsePlannerWeekSlot(value: unknown): PlannerWeekSlot {
  const record = isRecord(value) ? value : invalid('week slot');
  const evidence = isRecord(record.evidence) ? record.evidence : invalid('week slot evidence');
  if (!isPositiveInteger(record.id)
    || !isPositiveInteger(record.weekRunId)
    || !isNonEmptyString(record.targetSlug)
    || !isIsoDate(record.date)
    || !isPositiveInteger(record.position)
    || !isNonEmptyString(record.candidateKey)
    || !isNonEmptyString(record.topicTargetSlug)
    || !isPositiveInteger(record.targetTopicId)
    || !oneOf(record.blockKind, blockKinds)
    || !isPositiveInteger(record.durationMinutes)
    || record.durationMinutes < 45
    || record.durationMinutes > 75
    || !isNonNegativeInteger(record.plannedQuestions)
    || (record.blockKind === 'theory' && record.plannedQuestions !== 0)
    || (record.blockKind !== 'theory' && record.plannedQuestions < 1)
    || !isNonEmptyString(evidence.discipline)
    || !isNonEmptyString(evidence.topic)
    || !isNonEmptyString(evidence.adaptationReason)
    || !isRecord(evidence.candidateEvidence)
    || !oneOf(record.state, weekSlotStates)
    || !isNullablePositiveInteger(record.dayRunId)
    || !isNullablePositiveInteger(record.dayBlockId)
    || ((record.dayRunId === null) !== (record.dayBlockId === null))) invalid('week slot');
  return {
    ...record,
    score: parsePlannerScore(record.score),
    evidence: evidence as unknown as PlannerWeekSlotEvidence,
    ...(record.sourceChoice === undefined ? {} : { sourceChoice: parsePlannerSourceChoice(record.sourceChoice) }),
  } as unknown as PlannerWeekSlot;
}

export function parsePlannerWeek(value: unknown): PlannerWeek {
  const record = isRecord(value) ? value : invalid('week');
  if (!Array.isArray(record.slots)) invalid('week');
  const run = parsePlannerWeekRun(record.run);
  const slots = (record.slots as unknown[]).map(parsePlannerWeekSlot);
  if (!slots.every((slot) => slot.weekRunId === run.id && slot.targetSlug === run.targetSlug)) invalid('week');
  return { run, slots };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchPlannerTargets(signal?: AbortSignal): Promise<PlannerTargetList> {
  return parsePlannerTargetList(await requestJson('/api/v1/planner/targets', { signal }));
}

export async function seedPlannerTargets(targetSlugs: string[]): Promise<{
  targetsSeeded: number;
  topicsSeeded: number;
  targetSlugs: string[];
}> {
  const value = await requestJson('/api/v1/planner/targets/seed', {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetSlugs }),
  });
  if (!isRecord(value)
    || !isNonNegativeInteger(value.targetsSeeded)
    || !isNonNegativeInteger(value.topicsSeeded)
    || !Array.isArray(value.targetSlugs)
    || !value.targetSlugs.every(isNonEmptyString)) invalid('seed');
  return value as { targetsSeeded: number; topicsSeeded: number; targetSlugs: string[] };
}

export async function updatePlannerTarget(input: PlannerTargetUpdate): Promise<PlannerTarget> {
  return parsePlannerTarget(await requestJson('/api/v1/planner/targets', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify(input),
  }));
}

export async function fetchTargetTopics(targetSlug: string, signal?: AbortSignal): Promise<TargetTopicList> {
  const query = new URLSearchParams({ targetSlug });
  return parseTargetTopicList(await requestJson(`/api/v1/planner/topics?${query}`, { signal }));
}

export async function updateTargetTopics(targetSlug: string, items: TargetTopicUpdate[]): Promise<TargetTopicList> {
  const query = new URLSearchParams({ targetSlug });
  return parseTargetTopicList(await requestJson(`/api/v1/planner/topics?${query}`, {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ items }),
  }));
}

export async function generatePlannerDay(input: GeneratePlannerDayInput, idempotencyKey: string): Promise<PlannerDay> {
  return parsePlannerDay(await requestJson('/api/v1/planner/generate-day', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function refreshPlannerDay(input: RefreshPlannerDayInput, idempotencyKey: string): Promise<PlannerDay> {
  return parsePlannerDay(await requestJson('/api/v1/planner/refresh-day', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function fetchPlannerDay(targetSlug: string, dateValue: string, signal?: AbortSignal): Promise<PlannerDay> {
  const query = new URLSearchParams({ targetSlug, date: dateValue });
  return parsePlannerDay(await requestJson(`/api/v1/planner/day?${query}`, { signal }));
}

export async function fetchOptionalPlannerDay(targetSlug: string, dateValue: string, signal?: AbortSignal): Promise<PlannerDay | null> {
  const query = new URLSearchParams({ targetSlug, date: dateValue, allowMissing: 'true' });
  const value = await requestJson(`/api/v1/planner/day?${query}`, { signal });
  return value === null ? null : parsePlannerDay(value);
}

export async function generatePlannerWeek(input: GeneratePlannerWeekInput, idempotencyKey: string): Promise<PlannerWeek> {
  return parsePlannerWeek(await requestJson('/api/v1/planner/generate-week', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function refreshPlannerWeek(input: RefreshPlannerWeekInput, idempotencyKey: string): Promise<PlannerWeek> {
  return parsePlannerWeek(await requestJson('/api/v1/planner/refresh-week', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function fetchPlannerWeek(targetSlug: string, weekStart: string, signal?: AbortSignal): Promise<PlannerWeek> {
  const query = new URLSearchParams({ targetSlug, weekStart });
  return parsePlannerWeek(await requestJson(`/api/v1/planner/week?${query}`, { signal }));
}

export async function fetchOptionalPlannerWeek(targetSlug: string, weekStart: string, signal?: AbortSignal): Promise<PlannerWeek | null> {
  const query = new URLSearchParams({ targetSlug, weekStart, allowMissing: 'true' });
  const value = await requestJson(`/api/v1/planner/week?${query}`, { signal });
  return value === null ? null : parsePlannerWeek(value);
}

export async function fetchPlannerScoreboard(runId: number, signal?: AbortSignal): Promise<PlannerScoreboard> {
  const query = new URLSearchParams({ runId: String(runId) });
  return parsePlannerScoreboard(await requestJson(`/api/v1/planner/scoreboard?${query}`, { signal }));
}

export async function submitPlannerBlockResult(blockId: number, input: PlannerBlockResultInput): Promise<PlannerBlock> {
  return parsePlannerBlock(await requestJson(`/api/v1/planner/blocks/${blockId}/result`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify(input),
  }));
}
