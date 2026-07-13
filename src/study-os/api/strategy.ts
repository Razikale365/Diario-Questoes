import { requestJson } from './client';

export type StrategySourceKind = 'course' | 'passo' | 'trilha' | 'ls' | 'andrety' | 'tec' | 'manual';
export type StrategyContentRole = 'primary_theory' | 'review_support' | 'question_practice' | 'schedule_advice' | 'incidence_signal';
export type StrategyMappingStatus = 'proposed' | 'approved' | 'rejected';
export type StrategyTransferKind = 'target_specific' | 'shared' | 'partial';
export type StrategyResolutionState = 'unresolved' | 'proposed' | 'approved' | 'rejected';
export type StrategyPackageState = 'missing' | 'candidate' | 'selected' | 'downloaded' | 'validated';

export interface StrategyMapping {
  id: number;
  targetSlug: string;
  targetTopicId: number;
  sourceItemId: number;
  sourceTargetSlug: string;
  transferKind: StrategyTransferKind;
  mappingStatus: StrategyMappingStatus;
  confidenceBp: number;
  primaryEligible: boolean;
  manualOverride: boolean;
  notes: string;
  version: number;
}

export interface StrategyWorkbenchMapping extends StrategyMapping {
  targetDiscipline: string;
  targetTopic: string;
}

export interface StrategyPackageStatus {
  state: StrategyPackageState;
  rootId: number | null;
  packageName: string | null;
  packageId: string | null;
  downloadStatus: Exclude<StrategyPackageState, 'missing'> | null;
  manifestPath: string | null;
  expectedFileCount: number | null;
  observedFileCount: number | null;
  failedItemCount: number | null;
  validated: boolean;
}

export interface StrategyWorkbenchItem {
  sourceItemId: number;
  sourceId: number;
  sourceTargetSlug: string;
  sourceKind: StrategySourceKind;
  sourceDisplayName: string;
  trustTier: number;
  edition: string;
  sourceVersion: number;
  discipline: string;
  topicHint: string;
  sourceOrder: number;
  contentRole: StrategyContentRole;
  lessonId: number | null;
  materialId: number | null;
  externalUrl: string | null;
  externalId: string | null;
  incidenceBp: number;
  banca: string;
  itemVersion: number;
  resolutionState: StrategyResolutionState;
  mappings: StrategyWorkbenchMapping[];
}

export interface StrategyWorkbench {
  targetSlug: string;
  packageStatus: StrategyPackageStatus;
  items: StrategyWorkbenchItem[];
}

export interface StrategyMappingUpdate {
  targetSlug: string;
  targetTopicId: number;
  expectedVersion: number;
  expectedSourceVersion: number;
  sourceTrustTier: number;
  mappingStatus: StrategyMappingStatus;
  transferKind: StrategyTransferKind;
  confidenceBp: number;
  primaryEligible: boolean;
  notes: string;
}

const sourceKinds = ['course', 'passo', 'trilha', 'ls', 'andrety', 'tec', 'manual'] as const;
const contentRoles = ['primary_theory', 'review_support', 'question_practice', 'schedule_advice', 'incidence_signal'] as const;
const mappingStatuses = ['proposed', 'approved', 'rejected'] as const;
const transferKinds = ['target_specific', 'shared', 'partial'] as const;
const resolutionStates = ['unresolved', 'proposed', 'approved', 'rejected'] as const;
const packageStates = ['missing', 'candidate', 'selected', 'downloaded', 'validated'] as const;
const downloadStates = ['candidate', 'selected', 'downloaded', 'validated'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => isString(value) && Boolean(value.trim());
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isPositiveInteger = (value: unknown): value is number => isInteger(value) && value > 0;
const isNonNegativeInteger = (value: unknown): value is number => isInteger(value) && value >= 0;
const isNullablePositiveInteger = (value: unknown): value is number | null => value === null || isPositiveInteger(value);
const isNullableNonNegativeInteger = (value: unknown): value is number | null => value === null || isNonNegativeInteger(value);
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => (
  typeof value === 'string' && options.includes(value as T)
);
const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS ${label} response`);
};

export function parseStrategyMapping(value: unknown): StrategyMapping {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isNonEmptyString(value.targetSlug)
    || !isPositiveInteger(value.targetTopicId)
    || !isPositiveInteger(value.sourceItemId)
    || !isNonEmptyString(value.sourceTargetSlug)
    || !oneOf(value.transferKind, transferKinds)
    || !oneOf(value.mappingStatus, mappingStatuses)
    || !isInteger(value.confidenceBp)
    || value.confidenceBp < 0
    || value.confidenceBp > 10000
    || typeof value.primaryEligible !== 'boolean'
    || typeof value.manualOverride !== 'boolean'
    || !isString(value.notes)
    || !isPositiveInteger(value.version)
    || (value.primaryEligible && value.mappingStatus !== 'approved')
    || (value.transferKind === 'target_specific' && value.sourceTargetSlug !== value.targetSlug)) invalid('strategy mapping');
  return value as unknown as StrategyMapping;
}

const parseWorkbenchMapping = (value: unknown): StrategyWorkbenchMapping => {
  const mapping = parseStrategyMapping(value);
  const record = value as Record<string, unknown>;
  if (!isNonEmptyString(record.targetDiscipline) || !isNonEmptyString(record.targetTopic)) {
    invalid('strategy workbench mapping');
  }
  return mapping as StrategyWorkbenchMapping;
};

const parsePackageStatus = (value: unknown): StrategyPackageStatus => {
  if (!isRecord(value)
    || !oneOf(value.state, packageStates)
    || !isNullablePositiveInteger(value.rootId)
    || !isNullableString(value.packageName)
    || !isNullableString(value.packageId)
    || !(value.downloadStatus === null || oneOf(value.downloadStatus, downloadStates))
    || !isNullableString(value.manifestPath)
    || !isNullableNonNegativeInteger(value.expectedFileCount)
    || !isNullableNonNegativeInteger(value.observedFileCount)
    || !isNullableNonNegativeInteger(value.failedItemCount)
    || typeof value.validated !== 'boolean'
    || (value.state === 'missing' && value.rootId !== null)
    || (value.validated && value.downloadStatus !== 'validated')) invalid('strategy package');
  return value as unknown as StrategyPackageStatus;
};

const parseWorkbenchItem = (value: unknown): StrategyWorkbenchItem => {
  const record = isRecord(value) ? value : invalid('strategy workbench item');
  if (!isPositiveInteger(record.sourceItemId)
    || !isPositiveInteger(record.sourceId)
    || !isNonEmptyString(record.sourceTargetSlug)
    || !oneOf(record.sourceKind, sourceKinds)
    || !isNonEmptyString(record.sourceDisplayName)
    || !isInteger(record.trustTier)
    || record.trustTier < 0
    || record.trustTier > 10
    || !isString(record.edition)
    || !isPositiveInteger(record.sourceVersion)
    || !isNonEmptyString(record.discipline)
    || !isNonEmptyString(record.topicHint)
    || !isNonNegativeInteger(record.sourceOrder)
    || !oneOf(record.contentRole, contentRoles)
    || !isNullablePositiveInteger(record.lessonId)
    || !isNullablePositiveInteger(record.materialId)
    || !isNullableString(record.externalUrl)
    || !isNullableString(record.externalId)
    || !isInteger(record.incidenceBp)
    || record.incidenceBp < 0
    || record.incidenceBp > 10000
    || !isString(record.banca)
    || !isPositiveInteger(record.itemVersion)
    || !oneOf(record.resolutionState, resolutionStates)
    || !Array.isArray(record.mappings)) invalid('strategy workbench item');
  return {
    ...record,
    mappings: (record.mappings as unknown[]).map(parseWorkbenchMapping),
  } as unknown as StrategyWorkbenchItem;
};

export function parseStrategyWorkbench(value: unknown): StrategyWorkbench {
  const record = isRecord(value) ? value : invalid('strategy workbench');
  if (!isNonEmptyString(record.targetSlug) || !Array.isArray(record.items)) invalid('strategy workbench');
  const items = (record.items as unknown[]).map(parseWorkbenchItem);
  if (!items.every((item) => item.mappings.every((mapping) => (
    mapping.sourceItemId === item.sourceItemId && mapping.targetSlug === record.targetSlug
  )))) invalid('strategy workbench');
  return {
    targetSlug: record.targetSlug as string,
    packageStatus: parsePackageStatus(record.packageStatus),
    items,
  };
}

export async function fetchStrategyWorkbench(targetSlug: string, signal?: AbortSignal): Promise<StrategyWorkbench> {
  const query = new URLSearchParams({ targetSlug });
  return parseStrategyWorkbench(await requestJson(`/api/v1/strategy/workbench?${query}`, { signal }));
}

export async function saveStrategyMapping(sourceItemId: number, input: StrategyMappingUpdate): Promise<StrategyMapping> {
  return parseStrategyMapping(await requestJson(`/api/v1/strategy/source-items/${sourceItemId}/mapping`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}
