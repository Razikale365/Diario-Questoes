import { requestJson } from './client';

export type ProgressStatus = 'unread' | 'in_progress' | 'covered' | 'stale' | 'weak' | 'strong';
export type SessionState = 'active' | 'finished';
export type SessionOutcome = 'partial' | 'completed' | 'failed' | 'skipped' | 'abandoned';
export type SkipReason =
  | 'lack_of_time'
  | 'fatigue'
  | 'wrong_material'
  | 'blocked_prerequisite'
  | 'too_difficult'
  | 'other';

export interface ProgressState {
  id: number;
  lessonId: number;
  materialId: number;
  status: ProgressStatus;
  cursorPage: number;
  furthestPage: number;
  completedAt: string | null;
  lastSeenAt: string | null;
  confidence: number;
  totalSeconds: number;
  sessionCount: number;
  version: number;
}

export interface StudySession {
  id: number;
  idempotencyKey: string;
  targetSlug: string;
  lessonId: number;
  materialId: number;
  state: SessionState;
  startedAt: string;
  endedAt: string | null;
  elapsedSeconds: number;
  startPage: number;
  endPage: number | null;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  outcome: SessionOutcome | null;
  skipReason: SkipReason | null;
  notes: string;
  version: number;
}

export interface MaterialInspection {
  materialId: number;
  pageCount: number;
  pageOffset: number;
}

export interface ReadingRateSummary {
  materialId: number;
  pagesPerHour: number;
  sampleCount: number;
  totalSeconds: number;
  source: 'default' | 'observed';
}

export interface ReadingRateList {
  items: ReadingRateSummary[];
}

export interface SessionStart {
  session: StudySession;
  progress: ProgressState;
  openUrl: string;
}

export interface SessionResult {
  session: StudySession;
  progress: ProgressState;
}

export interface StartStudySessionInput {
  targetSlug: string;
  lessonId: number;
  materialId: number;
  plannerBlockId?: number;
}

export interface CheckpointStudySessionInput {
  endPage: number;
  elapsedSeconds: number;
  expectedVersion: number;
}

export interface FinishStudySessionInput {
  outcome: Exclude<SessionOutcome, 'skipped'>;
  endPage: number | null;
  elapsedSeconds: number;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  notes: string;
  expectedVersion: number;
}

export interface SkipStudySessionInput {
  reason: SkipReason;
  notes: string;
  expectedVersion: number;
}

const progressStatuses = ['unread', 'in_progress', 'covered', 'stale', 'weak', 'strong'] as const;
const sessionStates = ['active', 'finished'] as const;
const sessionOutcomes = ['partial', 'completed', 'failed', 'skipped', 'abandoned'] as const;
const skipReasons = [
  'lack_of_time',
  'fatigue',
  'wrong_material',
  'blocked_prerequisite',
  'too_difficult',
  'other',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isPositiveInteger = (value: unknown): value is number =>
  isInteger(value) && value > 0;
const isNonNegativeInteger = (value: unknown): value is number =>
  isInteger(value) && value >= 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const isNullablePositiveInteger = (value: unknown): value is number | null =>
  value === null || isPositiveInteger(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);

const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS ${label} response`);
};

export function parseProgressState(value: unknown): ProgressState {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.lessonId)
    || !isPositiveInteger(value.materialId)
    || !oneOf(value.status, progressStatuses)
    || !isPositiveInteger(value.cursorPage)
    || !isPositiveInteger(value.furthestPage)
    || value.furthestPage < value.cursorPage
    || !isNullableString(value.completedAt)
    || !isNullableString(value.lastSeenAt)
    || !isFiniteNumber(value.confidence)
    || value.confidence < 0
    || value.confidence > 1
    || !isNonNegativeInteger(value.totalSeconds)
    || !isNonNegativeInteger(value.sessionCount)
    || !isPositiveInteger(value.version)) invalid('progress');
  return value as unknown as ProgressState;
}

export function parseStudySession(value: unknown): StudySession {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isString(value.idempotencyKey)
    || !value.idempotencyKey.trim()
    || !isString(value.targetSlug)
    || !value.targetSlug.trim()
    || !isPositiveInteger(value.lessonId)
    || !isPositiveInteger(value.materialId)
    || !oneOf(value.state, sessionStates)
    || !isString(value.startedAt)
    || !isNullableString(value.endedAt)
    || !isNonNegativeInteger(value.elapsedSeconds)
    || !isPositiveInteger(value.startPage)
    || !isNullablePositiveInteger(value.endPage)
    || (value.endPage !== null && value.endPage < value.startPage)
    || !isNonNegativeInteger(value.questionsDone)
    || !isNonNegativeInteger(value.correctCount)
    || !isNonNegativeInteger(value.wrongCount)
    || !isNonNegativeInteger(value.doubtCount)
    || !isNonNegativeInteger(value.favoriteCount)
    || !(value.outcome === null || oneOf(value.outcome, sessionOutcomes))
    || !(value.skipReason === null || oneOf(value.skipReason, skipReasons))
    || !isString(value.notes)
    || !isPositiveInteger(value.version)) invalid('session');

  const parsed = value as unknown as StudySession;
  const activeIsValid = parsed.state !== 'active'
    || (parsed.endedAt === null && parsed.outcome === null && parsed.skipReason === null);
  const finishedIsValid = parsed.state !== 'finished'
    || (parsed.endedAt !== null && parsed.outcome !== null);
  const skipIsValid = parsed.outcome === 'skipped'
    ? parsed.skipReason !== null
    : parsed.skipReason === null;
  const pageOutcomeIsValid = !['partial', 'completed'].includes(String(parsed.outcome))
    || parsed.endPage !== null;
  if (!activeIsValid || !finishedIsValid || !skipIsValid || !pageOutcomeIsValid) {
    return invalid('session');
  }
  return parsed;
}

export function parseSessionStart(value: unknown): SessionStart {
  if (!isRecord(value) || !isString(value.openUrl)) return invalid('session start');
  return {
    session: parseStudySession(value.session),
    progress: parseProgressState(value.progress),
    openUrl: value.openUrl,
  };
}

export function parseSessionResult(value: unknown): SessionResult {
  if (!isRecord(value)) return invalid('session result');
  return {
    session: parseStudySession(value.session),
    progress: parseProgressState(value.progress),
  };
}

export function parseMaterialInspection(value: unknown): MaterialInspection {
  if (!isRecord(value)
    || !isPositiveInteger(value.materialId)
    || !isPositiveInteger(value.pageCount)
    || !isNonNegativeInteger(value.pageOffset)) invalid('material inspection');
  return value as unknown as MaterialInspection;
}

function parseReadingRate(value: unknown): ReadingRateSummary {
  if (!isRecord(value)
    || !isPositiveInteger(value.materialId)
    || !isFiniteNumber(value.pagesPerHour)
    || value.pagesPerHour <= 0
    || !isNonNegativeInteger(value.sampleCount)
    || !isNonNegativeInteger(value.totalSeconds)
    || !oneOf(value.source, ['default', 'observed'] as const)) invalid('reading rate');
  return value as unknown as ReadingRateSummary;
}

export function parseReadingRateList(value: unknown): ReadingRateList {
  if (!isRecord(value) || !Array.isArray(value.items)) return invalid('reading rate list');
  return { items: value.items.map(parseReadingRate) };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

const materialQuery = (targetSlug: string, lessonId: number, materialId: number) =>
  new URLSearchParams({
    targetSlug,
    lessonId: String(lessonId),
    materialId: String(materialId),
  });

export async function fetchProgress(
  targetSlug: string,
  lessonId: number,
  materialId: number,
  signal?: AbortSignal,
): Promise<ProgressState> {
  const query = materialQuery(targetSlug, lessonId, materialId);
  return parseProgressState(await requestJson(`/api/v1/progress?${query}`, { signal }));
}

export async function inspectMaterial(
  materialId: number,
  targetSlug: string,
): Promise<MaterialInspection> {
  const query = new URLSearchParams({ targetSlug });
  return parseMaterialInspection(await requestJson(
    `/api/v1/materials/${materialId}/inspect?${query}`,
    { method: 'POST' },
  ));
}

export async function fetchReadingRates(
  targetSlug: string,
  signal?: AbortSignal,
): Promise<ReadingRateList> {
  const query = new URLSearchParams({ targetSlug });
  return parseReadingRateList(await requestJson(`/api/v1/reading-rates?${query}`, { signal }));
}

export async function startStudySession(
  input: StartStudySessionInput,
  idempotencyKey: string,
): Promise<SessionStart> {
  return parseSessionStart(await requestJson('/api/v1/sessions', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function fetchActiveStudySession(
  targetSlug: string,
  lessonId: number,
  materialId: number,
  signal?: AbortSignal,
): Promise<StudySession> {
  const query = materialQuery(targetSlug, lessonId, materialId);
  return parseStudySession(await requestJson(`/api/v1/sessions/active?${query}`, { signal }));
}

export async function fetchStudySession(
  sessionId: number,
  targetSlug: string,
  signal?: AbortSignal,
): Promise<StudySession> {
  const query = new URLSearchParams({ targetSlug });
  return parseStudySession(await requestJson(`/api/v1/sessions/${sessionId}?${query}`, { signal }));
}

export async function checkpointStudySession(
  sessionId: number,
  input: CheckpointStudySessionInput,
): Promise<SessionResult> {
  return parseSessionResult(await requestJson(`/api/v1/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }));
}

export async function finishStudySession(
  sessionId: number,
  input: FinishStudySessionInput,
): Promise<SessionResult> {
  return parseSessionResult(await requestJson(`/api/v1/sessions/${sessionId}/finish`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }));
}

export async function skipStudySession(
  sessionId: number,
  input: SkipStudySessionInput,
): Promise<SessionResult> {
  return parseSessionResult(await requestJson(`/api/v1/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }));
}
