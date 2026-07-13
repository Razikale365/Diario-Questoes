import { requestJson } from './client';

export type DownloadStatus = 'candidate' | 'selected' | 'downloaded' | 'validated';
export type ImportRunState = 'queued' | 'running' | 'completed' | 'failed';
export type MaterialKind = 'original' | 'simplified' | 'highlighted' | 'slides' | 'mind_map' | 'summary' | 'bizu' | 'track' | 'other';

export interface SetupStatus {
  configuredRoots: number;
  activeScans: number;
  courseCount: number;
  materialCount: number;
  needsPackageSetup: boolean;
}

export interface CourseRoot {
  id: number;
  targetSlug: string;
  provider: string;
  packageName: string;
  packageId: string | null;
  packageUrl: string;
  editionNote: string;
  rootPath: string;
  sourceKind: 'course_package' | 'manual_folder' | 'legacy';
  acquisitionMethod: 'estrategia_downloader' | 'manual';
  downloadStatus: DownloadStatus;
  downloaderName: string | null;
  downloaderVersion: string | null;
  acquisitionId: string | null;
  catalogCheckedAt: string;
  downloadStartedAt: string | null;
  downloadedAt: string | null;
  acquisitionManifestPath: string | null;
  expectedFileCount: number | null;
  observedFileCount: number | null;
  failedItemCount: number | null;
  active: boolean;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRun {
  id: number;
  rootId: number;
  state: ImportRunState;
  discoveredCount: number;
  reconciledCount: number;
  issueCount: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CourseTopicMappingSummary {
  rootId: number;
  targetSlug: string;
  sourceIds: number[];
  runIds: number[];
  discoveredCount: number;
  mappedCount: number;
  unresolvedCount: number;
  algorithmVersion: string;
}

export interface CourseSummary {
  id: number;
  rootId: number;
  targetSlug: string;
  displayName: string;
  provider: string;
  relativePath: string;
  active: boolean;
  scanState: 'available' | 'missing' | 'unresolved';
  lastScannedAt: string | null;
  lessonCount: number;
  materialCount: number;
  issueCount: number;
}

export interface LessonSummary {
  id: number;
  courseId: number;
  disciplineId: number | null;
  disciplineName: string | null;
  lessonNumber: number | null;
  title: string;
  sequenceIndex: number;
  status: 'unread' | 'in_progress' | 'completed' | 'skipped';
  estimatedMinutes: number | null;
  available: boolean;
  mappingSource: 'automatic' | 'manual';
  materialCount: number;
}

export interface MaterialSummary {
  id: number;
  courseId: number;
  lessonId: number | null;
  relativePath: string;
  kind: MaterialKind;
  sizeBytes: number;
  modifiedAt: string;
  contentHash: string | null;
  pageCount: number | null;
  pageOffset: number;
  available: boolean;
  isPrimary: boolean;
  primarySelection: 'automatic' | 'manual' | null;
  trustLevel: number;
  fileUrl: string;
}

export interface LessonDetail extends LessonSummary {
  materials: MaterialSummary[];
}

export interface ListResponse<T> {
  total: number;
  items: T[];
}

export interface LessonListResponse extends ListResponse<LessonSummary> {
  limit: number;
  offset: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  isInteger(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  isInteger(value) && value > 0;
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const isNullableNonNegativeInteger = (value: unknown): value is number | null =>
  value === null || isNonNegativeInteger(value);
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && options.includes(value as T);

const invalid = (label: string): never => {
  throw new TypeError(`Invalid Study OS ${label} response`);
};

export function parseSetupStatus(value: unknown): SetupStatus {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.configuredRoots)
    || !isNonNegativeInteger(value.activeScans)
    || !isNonNegativeInteger(value.courseCount)
    || !isNonNegativeInteger(value.materialCount)
    || typeof value.needsPackageSetup !== 'boolean') invalid('setup status');
  return value as unknown as SetupStatus;
}

function parseCourseRoot(value: unknown): CourseRoot {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isString(value.targetSlug)
    || !isString(value.provider)
    || !isString(value.packageName)
    || !isNullableString(value.packageId)
    || !isString(value.packageUrl)
    || !isString(value.editionNote)
    || !isString(value.rootPath)
    || !oneOf(value.sourceKind, ['course_package', 'manual_folder', 'legacy'] as const)
    || !oneOf(value.acquisitionMethod, ['estrategia_downloader', 'manual'] as const)
    || !oneOf(value.downloadStatus, ['candidate', 'selected', 'downloaded', 'validated'] as const)
    || !isNullableString(value.downloaderName)
    || !isNullableString(value.downloaderVersion)
    || !isNullableString(value.acquisitionId)
    || !isString(value.catalogCheckedAt)
    || !isNullableString(value.downloadStartedAt)
    || !isNullableString(value.downloadedAt)
    || !isNullableString(value.acquisitionManifestPath)
    || !isNullableNonNegativeInteger(value.expectedFileCount)
    || !isNullableNonNegativeInteger(value.observedFileCount)
    || !isNullableNonNegativeInteger(value.failedItemCount)
    || typeof value.active !== 'boolean'
    || !isNullableString(value.lastScannedAt)
    || !isString(value.createdAt)
    || !isString(value.updatedAt)) invalid('course root');
  return value as unknown as CourseRoot;
}

export function parseCourseRootList(value: unknown): ListResponse<CourseRoot> {
  if (!isRecord(value) || !isNonNegativeInteger(value.total) || !Array.isArray(value.items)) {
    return invalid('course root list');
  }
  return { total: value.total, items: value.items.map(parseCourseRoot) };
}

export function parseImportRun(value: unknown): ImportRun {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.rootId)
    || !oneOf(value.state, ['queued', 'running', 'completed', 'failed'] as const)
    || !isNonNegativeInteger(value.discoveredCount)
    || !isNonNegativeInteger(value.reconciledCount)
    || !isNonNegativeInteger(value.issueCount)
    || !isString(value.startedAt)
    || !isNullableString(value.completedAt)
    || !isNullableString(value.errorMessage)) invalid('import run');
  return value as unknown as ImportRun;
}

export function parseCourseTopicMappingSummary(value: unknown): CourseTopicMappingSummary {
  if (!isRecord(value)
    || !isPositiveInteger(value.rootId)
    || !isString(value.targetSlug)
    || !value.targetSlug.trim()
    || !Array.isArray(value.sourceIds)
    || !value.sourceIds.every(isPositiveInteger)
    || !Array.isArray(value.runIds)
    || !value.runIds.every(isPositiveInteger)
    || !isNonNegativeInteger(value.discoveredCount)
    || !isNonNegativeInteger(value.mappedCount)
    || !isNonNegativeInteger(value.unresolvedCount)
    || value.mappedCount + value.unresolvedCount !== value.discoveredCount
    || !isString(value.algorithmVersion)
    || !value.algorithmVersion.trim()) invalid('course topic mapping');
  return value as unknown as CourseTopicMappingSummary;
}

function parseCourse(value: unknown): CourseSummary {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.rootId)
    || !isString(value.targetSlug)
    || !isString(value.displayName)
    || !isString(value.provider)
    || !isString(value.relativePath)
    || typeof value.active !== 'boolean'
    || !oneOf(value.scanState, ['available', 'missing', 'unresolved'] as const)
    || !isNullableString(value.lastScannedAt)
    || !isNonNegativeInteger(value.lessonCount)
    || !isNonNegativeInteger(value.materialCount)
    || !isNonNegativeInteger(value.issueCount)) invalid('course');
  return value as unknown as CourseSummary;
}

export function parseCourseList(value: unknown): ListResponse<CourseSummary> {
  if (!isRecord(value) || !isNonNegativeInteger(value.total) || !Array.isArray(value.items)) {
    return invalid('course list');
  }
  return { total: value.total, items: value.items.map(parseCourse) };
}

function parseLesson(value: unknown): LessonSummary {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.courseId)
    || !(value.disciplineId === null || isPositiveInteger(value.disciplineId))
    || !isNullableString(value.disciplineName)
    || !(value.lessonNumber === null || isNonNegativeInteger(value.lessonNumber))
    || !isString(value.title)
    || !isNonNegativeInteger(value.sequenceIndex)
    || !oneOf(value.status, ['unread', 'in_progress', 'completed', 'skipped'] as const)
    || !(value.estimatedMinutes === null || isNonNegativeInteger(value.estimatedMinutes))
    || typeof value.available !== 'boolean'
    || !oneOf(value.mappingSource, ['automatic', 'manual'] as const)
    || !isNonNegativeInteger(value.materialCount)) invalid('lesson');
  return value as unknown as LessonSummary;
}

export function parseLessonList(value: unknown): LessonListResponse {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.total)
    || !isPositiveInteger(value.limit)
    || !isNonNegativeInteger(value.offset)
    || !Array.isArray(value.items)) return invalid('lesson list');
  return {
    total: value.total,
    limit: value.limit,
    offset: value.offset,
    items: value.items.map(parseLesson),
  };
}

function parseMaterial(value: unknown): MaterialSummary {
  if (!isRecord(value)
    || !isPositiveInteger(value.id)
    || !isPositiveInteger(value.courseId)
    || !(value.lessonId === null || isPositiveInteger(value.lessonId))
    || !isString(value.relativePath)
    || !oneOf(value.kind, ['original', 'simplified', 'highlighted', 'slides', 'mind_map', 'summary', 'bizu', 'track', 'other'] as const)
    || !isNonNegativeInteger(value.sizeBytes)
    || !isString(value.modifiedAt)
    || !isNullableString(value.contentHash)
    || !(value.pageCount === null || isPositiveInteger(value.pageCount))
    || !isNonNegativeInteger(value.pageOffset)
    || typeof value.available !== 'boolean'
    || typeof value.isPrimary !== 'boolean'
    || !(value.primarySelection === null || oneOf(value.primarySelection, ['automatic', 'manual'] as const))
    || !isNonNegativeInteger(value.trustLevel)
    || value.trustLevel > 10
    || !isString(value.fileUrl)) invalid('material');
  return value as unknown as MaterialSummary;
}

export function parseLessonDetail(value: unknown): LessonDetail {
  const lesson = parseLesson(value);
  if (!isRecord(value) || !Array.isArray(value.materials)) return invalid('lesson detail');
  return { ...lesson, materials: value.materials.map(parseMaterial) };
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
  return parseSetupStatus(await requestJson('/api/v1/setup/status', { signal }));
}

export async function fetchCourseRoots(targetSlug: string, signal?: AbortSignal): Promise<ListResponse<CourseRoot>> {
  const query = new URLSearchParams({ targetSlug });
  return parseCourseRootList(await requestJson(`/api/v1/course-roots?${query}`, { signal }));
}

export async function registerCourseRootFromPath(targetSlug: string, rootPath: string): Promise<CourseRoot> {
  return parseCourseRoot(await requestJson('/api/v1/course-roots', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ targetSlug, rootPath }),
  }));
}

export async function startCourseScan(rootId: number): Promise<ImportRun> {
  return parseImportRun(await requestJson('/api/v1/scans', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ rootId }),
  }));
}

export async function mapCourseRootToStrategy(
  rootId: number,
  targetSlug: string,
): Promise<CourseTopicMappingSummary> {
  return parseCourseTopicMappingSummary(await requestJson(
    `/api/v1/course-roots/${rootId}/strategy-map`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ targetSlug }),
    },
  ));
}

export async function fetchImportRun(runId: number, signal?: AbortSignal): Promise<ImportRun> {
  return parseImportRun(await requestJson(`/api/v1/scans/${runId}`, { signal }));
}

export async function fetchCourses(targetSlug: string, signal?: AbortSignal): Promise<ListResponse<CourseSummary>> {
  const query = new URLSearchParams({ targetSlug });
  return parseCourseList(await requestJson(`/api/v1/courses?${query}`, { signal }));
}

export async function fetchLessons(courseId: number, targetSlug: string, signal?: AbortSignal): Promise<LessonListResponse> {
  const query = new URLSearchParams({ targetSlug, limit: '250', offset: '0' });
  return parseLessonList(await requestJson(`/api/v1/courses/${courseId}/lessons?${query}`, { signal }));
}

export async function fetchLesson(lessonId: number, targetSlug: string, signal?: AbortSignal): Promise<LessonDetail> {
  const query = new URLSearchParams({ targetSlug });
  return parseLessonDetail(await requestJson(`/api/v1/lessons/${lessonId}?${query}`, { signal }));
}

export async function updateLessonMapping(
  lessonId: number,
  targetSlug: string,
  disciplineName: string,
  title: string,
): Promise<LessonSummary> {
  return parseLesson(await requestJson(`/api/v1/lessons/${lessonId}/mapping`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify({ targetSlug, disciplineName, title }),
  }));
}
