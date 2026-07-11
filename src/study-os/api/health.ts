import { requestJson } from './client';

export interface StudyOsHealth {
  status: 'ok' | 'error';
  serviceVersion: string;
  schemaVersion: number;
  database: 'ok' | 'error';
  backup: 'ok' | 'missing' | 'stale' | 'error';
  configuredRoots: number;
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function parseStudyOsHealth(value: unknown): StudyOsHealth {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Invalid Study OS health response');
  }
  const candidate = value as Record<string, unknown>;
  const valid =
    (candidate.status === 'ok' || candidate.status === 'error') &&
    typeof candidate.serviceVersion === 'string' &&
    candidate.serviceVersion.length > 0 &&
    isNonNegativeInteger(candidate.schemaVersion) &&
    (candidate.database === 'ok' || candidate.database === 'error') &&
    (candidate.backup === 'ok' || candidate.backup === 'missing' || candidate.backup === 'stale' || candidate.backup === 'error') &&
    isNonNegativeInteger(candidate.configuredRoots);
  if (!valid) throw new TypeError('Invalid Study OS health response');
  return candidate as unknown as StudyOsHealth;
}

export const isStudyOsHealthOperational = (health: StudyOsHealth): boolean =>
  health.status === 'ok' && health.database === 'ok';

export async function fetchStudyOsHealth(signal?: AbortSignal): Promise<StudyOsHealth> {
  return parseStudyOsHealth(await requestJson('/api/v1/health', { signal }));
}
