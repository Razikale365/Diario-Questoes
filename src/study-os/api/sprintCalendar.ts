import { requestJson, StudyOsApiError } from './client';


export type CalendarPrecision = 'exact' | 'provisional' | 'protected';
export type CalendarDecision = 'draft' | 'applied' | 'rejected';
export type CalendarPriorityTier = 'critical' | 'high' | 'maintenance' | 'protected';
export type CalendarPreviewMode = 'reflow_open' | 'fill_open' | 'restore_run';
export type CalendarItemState = 'pending' | 'active' | 'completed' | 'failed' | 'ignored' | 'archived';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SprintCalendarRun {
  id: number;
  targetSlug: string;
  windowStart: string;
  windowEnd: string;
  planningCutoff: string;
  exactThrough: string;
  algorithmVersion: string;
  requestHash: string;
  inputHash: string;
  baseAppliedRunId: number | null;
  supersedesRunId: number | null;
  decision: CalendarDecision;
  status: 'generated' | 'shortfall';
  warnings: string[];
  shortfalls: string[];
  version: number;
  generatedAt: string;
  appliedAt: string | null;
}

export interface SprintCalendarDay {
  id: number;
  date: string;
  precision: CalendarPrecision;
  availabilitySource: 'manual_date' | 'manual_weekday' | 'manual_global' | 'learned' | 'default';
  available: boolean;
  availableMinutes: number;
  lsMinutes: number;
  extraMinutes: number;
  reservedMinutes: number;
  overageMinutes: number;
  energyLevel: number;
  confidenceBp: number;
  warnings: string[];
}

export interface SprintCalendarItem {
  id: number;
  itemKey: string;
  origin: 'source' | 'manual' | 'system';
  kind: 'source_task' | 'manual' | 'intervention' | 'future_cycle_capacity';
  sourcePlanTaskId: number | null;
  subjectProfileId: number | null;
  title: string;
  expectedMetaNumber: number | null;
  state: CalendarItemState;
  result: Record<string, JsonValue>;
  completedAt: string | null;
  version: number;
}

export interface SprintCalendarAssignment {
  id: number;
  itemId: number;
  date: string;
  position: number;
  durationMinutes: number;
  precision: CalendarPrecision;
  priorityTier: CalendarPriorityTier;
  reasons: string[];
  pinned: boolean;
  action: Record<string, JsonValue> | null;
  expectedGainMilli: number;
  replacesPlaceholderItemId: number | null;
}

export interface SprintCalendarDiff {
  added: number;
  moved: number;
  preserved: number;
  completed: number;
  removed: number;
  noSpace: number;
  placeholderReplacements: number;
}

export interface SprintCalendarDocument {
  run: SprintCalendarRun;
  days: SprintCalendarDay[];
  items: SprintCalendarItem[];
  assignments: SprintCalendarAssignment[];
  overrideVersions: Record<string, number>;
  diff: SprintCalendarDiff;
  replayed: boolean;
  undoRunId?: number | null;
}

export interface SprintCalendarPreviewInput {
  targetSlug: string;
  startDate: string;
  endDate: string;
  expectedRunId: number | null;
  mode: CalendarPreviewMode;
  maxTasksPerDay: number;
  hoursPerDay: number;
  restoreRunId?: number;
}

export interface SprintCalendarApplyInput {
  expectedRunId: number | null;
  expectedOverrideVersions: Record<string, number>;
}

export interface SprintCalendarDayOverride {
  id: number;
  targetSlug: string;
  scopeKind: 'date' | 'weekday' | 'global';
  scopeValue: string;
  availability: 'default' | 'available' | 'unavailable';
  lsMinutes: number | null;
  extraMinutes: number | null;
  energyLevel: number | null;
  active: boolean;
  version: number;
}

export interface SprintCalendarItemOverride {
  id: number;
  targetSlug: string;
  itemId: number;
  planDate: string;
  startTime: string | null;
  position: number | null;
  durationMinutes: number | null;
  pinned: boolean;
  active: boolean;
  version: number;
}

export interface SprintCalendarManualItemResult {
  item: SprintCalendarItem;
  override: SprintCalendarItemOverride;
  replayed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const isPositive = (value: unknown): value is number => isInteger(value) && Number(value) > 0;
const isNonNegative = (value: unknown): value is number => isInteger(value) && Number(value) >= 0;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && !Number.isNaN(Date.parse(value));
const isNullablePositive = (value: unknown): value is number | null => value === null || isPositive(value);
const isTextArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T);
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
};
const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS calendar ${label} response`);
};

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid(label);
}

const parseRun = (value: unknown): SprintCalendarRun => {
  assertRecord(value, 'run');
  const record = value;
  if (!isPositive(record.id)
    || !isText(record.targetSlug)
    || !isDate(record.windowStart)
    || !isDate(record.windowEnd)
    || record.windowStart > record.windowEnd
    || !isTimestamp(record.planningCutoff)
    || !isDate(record.exactThrough)
    || !isText(record.algorithmVersion)
    || !isHash(record.requestHash)
    || !isHash(record.inputHash)
    || !isNullablePositive(record.baseAppliedRunId)
    || !isNullablePositive(record.supersedesRunId)
    || !oneOf(record.decision, ['draft', 'applied', 'rejected'] as const)
    || !oneOf(record.status, ['generated', 'shortfall'] as const)
    || !isTextArray(record.warnings)
    || !isTextArray(record.shortfalls)
    || !isPositive(record.version)
    || !isTimestamp(record.generatedAt)
    || !(record.appliedAt === null || isTimestamp(record.appliedAt))) invalid('run');
  if ((record.decision === 'applied') !== (record.appliedAt !== null)) invalid('applied run');
  return record as unknown as SprintCalendarRun;
};

const parseDay = (value: unknown): SprintCalendarDay => {
  assertRecord(value, 'day');
  const record = value;
  if (!isPositive(record.id)
    || !isDate(record.date)
    || !oneOf(record.precision, ['exact', 'provisional', 'protected'] as const)
    || !oneOf(record.availabilitySource, ['manual_date', 'manual_weekday', 'manual_global', 'learned', 'default'] as const)
    || typeof record.available !== 'boolean'
    || !isNonNegative(record.availableMinutes) || record.availableMinutes > 960
    || !isNonNegative(record.lsMinutes) || record.lsMinutes > 720
    || !isNonNegative(record.extraMinutes) || record.extraMinutes > 240
    || !isNonNegative(record.reservedMinutes)
    || !isNonNegative(record.overageMinutes)
    || !isInteger(record.energyLevel) || record.energyLevel < 1 || record.energyLevel > 5
    || !isInteger(record.confidenceBp) || record.confidenceBp < 0 || record.confidenceBp > 10000
    || !isTextArray(record.warnings)) invalid('day');
  const day = record as unknown as SprintCalendarDay;
  if (day.availableMinutes !== day.lsMinutes + day.extraMinutes
    || day.overageMinutes !== Math.max(day.reservedMinutes - day.availableMinutes, 0)
    || (day.available ? day.availableMinutes === 0 : day.availableMinutes !== 0)) invalid('capacity');
  return day;
};

const parseItem = (value: unknown): SprintCalendarItem => {
  assertRecord(value, 'item');
  const record = value;
  if (!isPositive(record.id)
    || !isText(record.itemKey)
    || !oneOf(record.origin, ['source', 'manual', 'system'] as const)
    || !oneOf(record.kind, ['source_task', 'manual', 'intervention', 'future_cycle_capacity'] as const)
    || !isNullablePositive(record.sourcePlanTaskId)
    || !isNullablePositive(record.subjectProfileId)
    || !isText(record.title)
    || !(record.expectedMetaNumber === null || isNonNegative(record.expectedMetaNumber))
    || !oneOf(record.state, ['pending', 'active', 'completed', 'failed', 'ignored', 'archived'] as const)
    || !isRecord(record.result) || !Object.values(record.result).every(isJsonValue)
    || !(record.completedAt === null || isTimestamp(record.completedAt))
    || !isPositive(record.version)) invalid('item');
  const item = record as unknown as SprintCalendarItem;
  if (item.kind === 'source_task' && (item.origin !== 'source' || item.sourcePlanTaskId === null)) invalid('source item');
  if (item.kind === 'future_cycle_capacity' && (
    item.origin !== 'system'
    || item.sourcePlanTaskId !== null
    || item.subjectProfileId !== null
    || item.state !== 'pending'
    || Object.keys(item.result).length !== 0
    || item.completedAt !== null
  )) invalid('placeholder');
  if (item.state === 'completed' && item.completedAt === null) invalid('completed item');
  return item;
};

const parseAssignment = (value: unknown): SprintCalendarAssignment => {
  assertRecord(value, 'assignment');
  const record = value;
  if (!isPositive(record.id)
    || !isPositive(record.itemId)
    || !isDate(record.date)
    || !isPositive(record.position)
    || !isPositive(record.durationMinutes) || record.durationMinutes > 720
    || !oneOf(record.precision, ['exact', 'provisional', 'protected'] as const)
    || !oneOf(record.priorityTier, ['critical', 'high', 'maintenance', 'protected'] as const)
    || !isTextArray(record.reasons)
    || typeof record.pinned !== 'boolean'
    || !(record.action === null || (isRecord(record.action) && Object.values(record.action).every(isJsonValue)))
    || !isNonNegative(record.expectedGainMilli)
    || !isNullablePositive(record.replacesPlaceholderItemId)) invalid('assignment');
  return record as unknown as SprintCalendarAssignment;
};

const parseDiff = (value: unknown): SprintCalendarDiff => {
  assertRecord(value, 'diff');
  const record = value;
  if (![
    'added', 'moved', 'preserved', 'completed', 'removed', 'noSpace', 'placeholderReplacements',
  ].every((key) => isNonNegative(record[key]))) invalid('diff');
  return record as unknown as SprintCalendarDiff;
};

export const parseSprintCalendar = (value: unknown): SprintCalendarDocument => {
  assertRecord(value, 'document');
  const record = value;
  const rawDays = record.days;
  const rawItems = record.items;
  const rawAssignments = record.assignments;
  const rawOverrideVersions = record.overrideVersions;
  const replayed = record.replayed;
  const undoRunId = record.undoRunId;
  if (!Array.isArray(rawDays)
    || !Array.isArray(rawItems)
    || !Array.isArray(rawAssignments)
    || !isRecord(rawOverrideVersions)
    || typeof replayed !== 'boolean'
    || !(undoRunId === undefined || isNullablePositive(undoRunId))) invalid('document');
  const dayValues = rawDays as unknown[];
  const itemValues = rawItems as unknown[];
  const assignmentValues = rawAssignments as unknown[];
  const overrideVersionValues = rawOverrideVersions as Record<string, unknown>;
  const wasReplayed = replayed as boolean;
  const restoredRunId = undoRunId as number | null | undefined;
  const run = parseRun(record.run);
  const days = dayValues.map(parseDay);
  const items = itemValues.map(parseItem);
  const assignments = assignmentValues.map(parseAssignment);
  const diff = parseDiff(record.diff);
  if (days.length < 1 || days.length > 15) invalid('window');
  if (new Set(days.map((day) => day.id)).size !== days.length
    || new Set(days.map((day) => day.date)).size !== days.length) invalid('duplicate day');
  if (new Set(items.map((item) => item.id)).size !== items.length
    || new Set(items.map((item) => item.itemKey)).size !== items.length) invalid('duplicate item');
  if (new Set(assignments.map((assignment) => assignment.id)).size !== assignments.length
    || new Set(assignments.map((assignment) => assignment.itemId)).size !== assignments.length
    || new Set(assignments.map((assignment) => `${assignment.date}:${assignment.position}`)).size !== assignments.length) {
    invalid('duplicate assignment');
  }
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const minutesByDate = new Map<string, number>();
  for (const assignment of assignments) {
    const item = itemById.get(assignment.itemId);
    if (!item || !dayByDate.has(assignment.date)) invalid('assignment identity');
    const assignedItem = item as SprintCalendarItem;
    minutesByDate.set(assignment.date, (minutesByDate.get(assignment.date) ?? 0) + assignment.durationMinutes);
    if (assignedItem.kind === 'future_cycle_capacity' && (
      assignment.precision !== 'provisional'
      || assignment.action !== null
      || assignment.expectedGainMilli !== 0
    )) {
      invalid('placeholder assignment');
    }
    if (assignment.replacesPlaceholderItemId !== null) {
      const replaced = itemById.get(assignment.replacesPlaceholderItemId);
      if (assignedItem.kind !== 'source_task' || (replaced && replaced.kind !== 'future_cycle_capacity')) invalid('placeholder replacement');
    }
  }
  for (const day of days) {
    if ((minutesByDate.get(day.date) ?? 0) !== day.reservedMinutes) invalid('capacity reservation');
  }
  const versions: Record<string, number> = {};
  for (const [key, version] of Object.entries(overrideVersionValues)) {
    if (!isText(key) || !isPositive(version)) invalid('override version');
    versions[key] = version as number;
  }
  return {
    run,
    days,
    items,
    assignments,
    overrideVersions: versions,
    diff,
    replayed: wasReplayed,
    ...(restoredRunId === undefined ? {} : { undoRunId: restoredRunId }),
  };
};

export async function fetchSprintCalendarHead(
  targetSlug: string,
  startDate: string,
  signal?: AbortSignal,
): Promise<SprintCalendarDocument | null> {
  const query = new URLSearchParams({ targetSlug, startDate });
  try {
    return parseSprintCalendar(await requestJson(`/api/v1/sprints/calendar?${query}`, { signal }));
  } catch (error) {
    if (error instanceof StudyOsApiError && error.status === 404 && error.code === 'calendar_not_found') return null;
    throw error;
  }
}

export async function fetchSprintCalendarRun(
  runId: number,
  signal?: AbortSignal,
): Promise<SprintCalendarDocument> {
  return parseSprintCalendar(await requestJson(`/api/v1/sprints/calendar/runs/${runId}`, { signal }));
}

export async function previewSprintCalendar(
  input: SprintCalendarPreviewInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<SprintCalendarDocument> {
  if ((input.mode === 'restore_run') !== (input.restoreRunId !== undefined)) {
    throw new TypeError('restoreRunId is required exactly for restore_run mode');
  }
  return parseSprintCalendar(await requestJson('/api/v1/sprints/calendar/preview', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function applySprintCalendarRun(
  runId: number,
  input: SprintCalendarApplyInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<SprintCalendarDocument> {
  return parseSprintCalendar(await requestJson(`/api/v1/sprints/calendar/runs/${runId}/apply`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

const parseDayOverride = (value: unknown): SprintCalendarDayOverride => {
  assertRecord(value, 'day override');
  if (!isPositive(value.id) || !isText(value.targetSlug)
    || !oneOf(value.scopeKind, ['date', 'weekday', 'global'] as const) || !isText(value.scopeValue)
    || !oneOf(value.availability, ['default', 'available', 'unavailable'] as const)
    || !(value.lsMinutes === null || isNonNegative(value.lsMinutes))
    || !(value.extraMinutes === null || isNonNegative(value.extraMinutes))
    || !(value.energyLevel === null || (isInteger(value.energyLevel) && value.energyLevel >= 1 && value.energyLevel <= 5))
    || typeof value.active !== 'boolean' || !isPositive(value.version)) invalid('day override');
  return value as unknown as SprintCalendarDayOverride;
};

const parseItemOverride = (value: unknown): SprintCalendarItemOverride => {
  assertRecord(value, 'item override');
  if (!isPositive(value.id) || !isText(value.targetSlug) || !isPositive(value.itemId)
    || !isDate(value.planDate) || !(value.startTime === null || (typeof value.startTime === 'string' && /^\d{2}:\d{2}$/.test(value.startTime)))
    || !(value.position === null || isPositive(value.position))
    || !(value.durationMinutes === null || isPositive(value.durationMinutes))
    || typeof value.pinned !== 'boolean' || typeof value.active !== 'boolean' || !isPositive(value.version)) invalid('item override');
  return value as unknown as SprintCalendarItemOverride;
};

export async function updateSprintCalendarDay(
  input: Omit<SprintCalendarDayOverride, 'id' | 'scopeKind' | 'scopeValue' | 'active' | 'version'> & {
    date: string; expectedVersion: number | null;
  },
  signal?: AbortSignal,
): Promise<SprintCalendarDayOverride> {
  const { date, ...body } = input;
  return parseDayOverride(await requestJson(`/api/v1/sprints/calendar/days/${encodeURIComponent(date)}`, {
    method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

export async function updateSprintCalendarItemOverride(
  itemId: number,
  input: Omit<SprintCalendarItemOverride, 'id' | 'itemId' | 'active' | 'version'> & { expectedVersion: number | null },
  signal?: AbortSignal,
): Promise<SprintCalendarItemOverride> {
  return parseItemOverride(await requestJson(`/api/v1/sprints/calendar/items/${itemId}/override`, {
    method: 'PUT', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }));
}

export async function createSprintCalendarItem(
  input: { targetSlug: string; title: string; planDate: string; startTime?: string; durationMinutes: number; position?: number },
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<SprintCalendarManualItemResult> {
  const value = await requestJson('/api/v1/sprints/calendar/items', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
  assertRecord(value, 'manual item');
  const record = value;
  if (typeof record.replayed !== 'boolean') invalid('manual item');
  const replayed = record.replayed as boolean;
  return {
    item: parseItem(record.item),
    override: parseItemOverride(record.override),
    replayed,
  };
}
