import { requestJson } from './client';

export type MigrationState = 'running' | 'completed' | 'failed';

export interface ActiveTargetPreference {
  targetSlug: string;
  version: number;
  updatedAt: string;
}

export interface MigrationSummary {
  id: number;
  migrationKey: string;
  schema: 'study-os.browser-migration.v1';
  payloadHash: string;
  state: MigrationState;
  stage: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BrowserMigrationReport {
  activeTargetSlug: string;
  coverageRowsImported: number;
  learningItemsImported: number;
  learningItemsRejected: number;
  legacyIdsRecorded: number;
  lsTasksImported: number;
  sourceSignalsImported: number;
  strategyRunIds: number[];
  targetsImported: number;
}

export interface BrowserMigrationResult {
  migration: MigrationSummary;
  report: BrowserMigrationReport;
}

export interface CutoverStatus {
  schemaVersion: number;
  ownership: 'sqlite';
  activeTarget: ActiveTargetPreference | null;
  migrations: MigrationSummary[];
  legacyMappingCount: number;
}

const migrationStates = ['running', 'completed', 'failed'] as const;
const preferenceKeys = ['targetSlug', 'version', 'updatedAt'] as const;
const migrationKeys = [
  'id',
  'migrationKey',
  'schema',
  'payloadHash',
  'state',
  'stage',
  'version',
  'createdAt',
  'updatedAt',
  'completedAt',
] as const;
const reportKeys = [
  'activeTargetSlug',
  'coverageRowsImported',
  'learningItemsImported',
  'learningItemsRejected',
  'legacyIdsRecorded',
  'lsTasksImported',
  'sourceSignalsImported',
  'strategyRunIds',
  'targetsImported',
] as const;
const statusKeys = [
  'schemaVersion',
  'ownership',
  'activeTarget',
  'migrations',
  'legacyMappingCount',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && Boolean(value.trim())
);
const isPositiveInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value > 0
);
const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isInteger(value) && value >= 0
);
const isUtcTimestamp = (value: unknown): value is string => (
  typeof value === 'string'
  && value.endsWith('Z')
  && Number.isFinite(Date.parse(value))
);
const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
};
const oneOf = <T extends string>(
  value: unknown,
  options: readonly T[],
): value is T => typeof value === 'string' && options.includes(value as T);
const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS ${label} response`);
};

export function parseActiveTargetPreference(value: unknown): ActiveTargetPreference {
  if (!isRecord(value)
    || !hasExactKeys(value, preferenceKeys)
    || !isNonEmptyString(value.targetSlug)
    || !isPositiveInteger(value.version)
    || !isUtcTimestamp(value.updatedAt)) invalid('active target preference');
  return value as unknown as ActiveTargetPreference;
}

export function parseMigrationSummary(value: unknown): MigrationSummary {
  if (!isRecord(value)
    || !hasExactKeys(value, migrationKeys)
    || !isPositiveInteger(value.id)
    || !isNonEmptyString(value.migrationKey)
    || value.schema !== 'study-os.browser-migration.v1'
    || typeof value.payloadHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.payloadHash)
    || !oneOf(value.state, migrationStates)
    || !isNonEmptyString(value.stage)
    || !isPositiveInteger(value.version)
    || !isUtcTimestamp(value.createdAt)
    || !isUtcTimestamp(value.updatedAt)
    || !(value.completedAt === null || isUtcTimestamp(value.completedAt))
    || (value.state === 'completed' && value.completedAt === null)
    || (value.state !== 'completed' && value.completedAt !== null)) {
    invalid('migration summary');
  }
  return value as unknown as MigrationSummary;
}

function parseBrowserMigrationReport(value: unknown): BrowserMigrationReport {
  if (!isRecord(value)
    || !hasExactKeys(value, reportKeys)
    || !isNonEmptyString(value.activeTargetSlug)
    || !isNonNegativeInteger(value.coverageRowsImported)
    || !isNonNegativeInteger(value.learningItemsImported)
    || !isNonNegativeInteger(value.learningItemsRejected)
    || !isNonNegativeInteger(value.legacyIdsRecorded)
    || !isNonNegativeInteger(value.lsTasksImported)
    || !isNonNegativeInteger(value.sourceSignalsImported)
    || !Array.isArray(value.strategyRunIds)
    || !value.strategyRunIds.every(isPositiveInteger)
    || !isNonNegativeInteger(value.targetsImported)) invalid('migration report');
  return value as unknown as BrowserMigrationReport;
}

export function parseBrowserMigrationResult(value: unknown): BrowserMigrationResult {
  const record = isRecord(value) ? value : invalid('browser migration');
  if (!hasExactKeys(record, ['migration', 'report'])) {
    invalid('browser migration');
  }
  return {
    migration: parseMigrationSummary(record.migration),
    report: parseBrowserMigrationReport(record.report),
  };
}

export function parseCutoverStatus(value: unknown): CutoverStatus {
  const record = isRecord(value) ? value : invalid('cutover status');
  if (!hasExactKeys(record, statusKeys) || record.ownership !== 'sqlite') {
    invalid('cutover status');
  }
  const schemaVersion = isPositiveInteger(record.schemaVersion)
    ? record.schemaVersion
    : invalid('cutover status');
  const activeTarget = record.activeTarget === null || isRecord(record.activeTarget)
    ? record.activeTarget
    : invalid('cutover status');
  const migrations = Array.isArray(record.migrations)
    ? record.migrations
    : invalid('cutover status');
  const legacyMappingCount = isNonNegativeInteger(record.legacyMappingCount)
    ? record.legacyMappingCount
    : invalid('cutover status');
  return {
    schemaVersion,
    ownership: 'sqlite',
    activeTarget: activeTarget === null
      ? null
      : parseActiveTargetPreference(activeTarget),
    migrations: migrations.map(parseMigrationSummary),
    legacyMappingCount,
  };
}

export async function fetchCutoverStatus(
  signal?: AbortSignal,
): Promise<CutoverStatus> {
  return parseCutoverStatus(await requestJson('/api/v1/cutover/status', { signal }));
}

export async function updateActiveTarget(
  targetSlug: string,
  version: number,
  signal?: AbortSignal,
): Promise<ActiveTargetPreference> {
  const normalized = targetSlug.trim();
  if (!normalized || !isPositiveInteger(version)) {
    throw new TypeError('A target slug and positive preference version are required');
  }
  return parseActiveTargetPreference(await requestJson(
    '/api/v1/preferences/active-target',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetSlug: normalized, version }),
      signal,
    },
  ));
}

export async function migrateBrowserState(
  bundle: Record<string, unknown>,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<BrowserMigrationResult> {
  if (!isRecord(bundle)) throw new TypeError('Browser migration bundle must be an object');
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedKey || normalizedKey.length > 200) {
    throw new TypeError('A valid browser migration idempotency key is required');
  }
  return parseBrowserMigrationResult(await requestJson(
    '/api/v1/cutover/browser-migration',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': normalizedKey,
      },
      body: JSON.stringify(bundle),
      signal,
    },
  ));
}
