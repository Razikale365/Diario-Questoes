import assert from 'node:assert/strict';
import test from 'node:test';

import { StudyOsApiError } from './client';
import {
  parseCourseList,
  parseCourseRootList,
  parseImportRun,
  parseLessonDetail,
  parseLessonList,
  parseSetupStatus,
  parseCourseTopicMappingSummary,
  registerCourseRootFromPath,
  mapCourseRootToStrategy,
} from './inventory';

const root = {
  id: 1,
  targetSlug: 'rfb_auditor',
  provider: 'Estrategia Concursos',
  packageName: 'RFB Auditor Pacotaco',
  packageId: '249654',
  packageUrl: 'https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654',
  editionNote: 'Fresh downloader acquisition',
  rootPath: 'C:\\Cursos\\RFB-249654',
  sourceKind: 'course_package',
  acquisitionMethod: 'estrategia_downloader',
  downloadStatus: 'validated',
  downloaderName: 'Study OS Estrategia Package Downloader',
  downloaderVersion: '1.0.0',
  acquisitionId: 'acq-249654',
  catalogCheckedAt: '2026-07-11T12:00:00+00:00',
  downloadStartedAt: '2026-07-11T12:05:00+00:00',
  downloadedAt: '2026-07-11T13:00:00+00:00',
  acquisitionManifestPath: 'C:\\Cursos\\RFB-249654\\.study-os-download.json',
  expectedFileCount: 9,
  observedFileCount: 9,
  failedItemCount: 0,
  active: true,
  lastScannedAt: null,
  createdAt: '2026-07-11T13:01:00',
  updatedAt: '2026-07-11T13:01:00',
};

const course = {
  id: 11,
  rootId: 1,
  targetSlug: 'rfb_auditor',
  displayName: 'Economia e Financas Publicas',
  provider: 'Estrategia Concursos',
  relativePath: 'Economia e Financas Publicas',
  active: true,
  scanState: 'available',
  lastScannedAt: '2026-07-11T13:02:00+00:00',
  lessonCount: 1,
  materialCount: 6,
  issueCount: 0,
};

const lesson = {
  id: 21,
  courseId: 11,
  disciplineId: 31,
  disciplineName: 'Economia e Financas Publicas',
  lessonNumber: 1,
  title: 'Aula 01',
  sequenceIndex: 0,
  status: 'unread',
  estimatedMinutes: null,
  available: true,
  mappingSource: 'automatic',
  materialCount: 1,
};

const material = {
  id: 41,
  courseId: 11,
  lessonId: 21,
  relativePath: 'Economia e Financas Publicas/PDF/Aula 01_Apostila.pdf',
  kind: 'original',
  sizeBytes: 1024,
  modifiedAt: '1783790000000000000',
  contentHash: null,
  pageCount: null,
  pageOffset: 0,
  available: true,
  isPrimary: true,
  primarySelection: 'automatic',
  trustLevel: 10,
  fileUrl: '/api/v1/materials/41/file',
};

test('inventory parsers accept every service DTO', () => {
  assert.deepEqual(parseSetupStatus({
    configuredRoots: 1,
    activeScans: 0,
    courseCount: 1,
    materialCount: 6,
    needsPackageSetup: false,
  }), {
    configuredRoots: 1,
    activeScans: 0,
    courseCount: 1,
    materialCount: 6,
    needsPackageSetup: false,
  });
  assert.deepEqual(parseCourseRootList({ total: 1, items: [root] }).items[0], root);
  assert.deepEqual(parseImportRun({
    id: 7,
    rootId: 1,
    state: 'completed',
    discoveredCount: 9,
    reconciledCount: 9,
    issueCount: 0,
    startedAt: '2026-07-11T13:02:00',
    completedAt: '2026-07-11T13:02:01',
    errorMessage: null,
  }).state, 'completed');
  assert.deepEqual(parseCourseList({ total: 1, items: [course] }).items[0], course);
  assert.deepEqual(parseLessonList({ total: 1, limit: 50, offset: 0, items: [lesson] }).items[0], lesson);
  assert.deepEqual(parseLessonDetail({ ...lesson, materials: [material] }).materials[0], material);
});

test('inventory parsers reject malformed nested values', () => {
  assert.throws(() => parseSetupStatus({ configuredRoots: -1 }), /setup status/i);
  assert.throws(() => parseCourseRootList({ total: 1, items: [{ ...root, active: 'yes' }] }), /course root/i);
  assert.throws(() => parseImportRun({ id: 1, state: 'mystery' }), /import run/i);
  assert.throws(() => parseCourseList({ total: 1, items: [{ ...course, lessonCount: -1 }] }), /course/i);
  assert.throws(() => parseLessonList({ total: 1, limit: 50, offset: 0, items: [{ ...lesson, status: 'bad' }] }), /lesson/i);
  assert.throws(() => parseLessonDetail({ ...lesson, materials: [{ ...material, trustLevel: 11 }] }), /material/i);
});

test('minimal root registration preserves structured API errors', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'invalid_course_root',
    message: 'rootPath must contain a valid .study-os-download.json manifest',
  }), {
    status: 422,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    registerCourseRootFromPath('rfb_auditor', 'C:\\missing'),
    (error: unknown) => error instanceof StudyOsApiError
      && error.status === 422
      && error.code === 'invalid_course_root',
  );
});

test('course topic mapping parser is strict about audit counts and IDs', () => {
  const summary = {
    rootId: 1,
    targetSlug: 'rfb_auditor',
    sourceIds: [10, 11],
    runIds: [20, 21],
    discoveredCount: 2,
    mappedCount: 1,
    unresolvedCount: 1,
    algorithmVersion: 'm6-course-map-v1',
  };

  assert.deepEqual(parseCourseTopicMappingSummary(summary), summary);
  assert.throws(
    () => parseCourseTopicMappingSummary({ ...summary, sourceIds: [0] }),
    /course topic mapping/i,
  );
  assert.throws(
    () => parseCourseTopicMappingSummary({ ...summary, unresolvedCount: -1 }),
    /course topic mapping/i,
  );
});

test('course topic mapping client posts the selected root and target', async (context) => {
  const response = {
    rootId: 7,
    targetSlug: 'rfb_auditor',
    sourceIds: [10],
    runIds: [20],
    discoveredCount: 1,
    mappedCount: 0,
    unresolvedCount: 1,
    algorithmVersion: 'm6-course-map-v1',
  };
  let requestPath = '';
  let requestInit: RequestInit | undefined;
  context.mock.method(globalThis, 'fetch', async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    requestPath = String(input);
    requestInit = init;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  assert.deepEqual(await mapCourseRootToStrategy(7, 'rfb_auditor'), response);
  assert.equal(requestPath, '/api/v1/course-roots/7/strategy-map');
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    targetSlug: 'rfb_auditor',
  });
});
