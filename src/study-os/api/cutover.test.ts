import assert from 'node:assert/strict';
import test from 'node:test';

import { StudyOsApiError } from './client';
import {
  fetchCutoverStatus,
  migrateBrowserState,
  parseActiveTargetPreference,
  parseBrowserMigrationResult,
  parseCutoverStatus,
  parseMigrationSummary,
  updateActiveTarget,
} from './cutover';

const preference = {
  targetSlug: 'rfb_auditor',
  version: 3,
  updatedAt: '2026-07-13T17:00:00.000Z',
};

const migration = {
  id: 7,
  migrationKey: 'browser-cutover:api-a1',
  schema: 'study-os.browser-migration.v1',
  payloadHash: 'a'.repeat(64),
  state: 'completed',
  stage: 'completed',
  version: 7,
  createdAt: '2026-07-13T17:00:00.000Z',
  updatedAt: '2026-07-13T17:00:01.000Z',
  completedAt: '2026-07-13T17:00:01.000Z',
};

const report = {
  activeTargetSlug: 'rfb_auditor',
  coverageRowsImported: 1,
  learningItemsImported: 1,
  learningItemsRejected: 0,
  legacyIdsRecorded: 5,
  lsTasksImported: 1,
  sourceSignalsImported: 1,
  strategyRunIds: [11, 12],
  targetsImported: 1,
};

const status = {
  schemaVersion: 9,
  ownership: 'sqlite',
  activeTarget: preference,
  migrations: [migration],
  legacyMappingCount: 5,
};

test('cutover parsers accept every public DTO', () => {
  assert.deepEqual(parseActiveTargetPreference(preference), preference);
  assert.deepEqual(parseMigrationSummary(migration), migration);
  assert.deepEqual(parseCutoverStatus(status), status);
  assert.deepEqual(
    parseBrowserMigrationResult({ migration, report }),
    { migration, report },
  );
  assert.deepEqual(parseCutoverStatus({ ...status, activeTarget: null }), {
    ...status,
    activeTarget: null,
  });
});

test('cutover parsers reject malformed, inconsistent, and expanded DTOs', () => {
  assert.throws(
    () => parseActiveTargetPreference({ ...preference, version: 0 }),
    /active target preference/i,
  );
  assert.throws(
    () => parseMigrationSummary({ ...migration, payloadHash: 'not-a-hash' }),
    /migration summary/i,
  );
  assert.throws(
    () => parseMigrationSummary({ ...migration, completedAt: null }),
    /migration summary/i,
  );
  assert.throws(
    () => parseCutoverStatus({ ...status, ownership: 'localStorage' }),
    /cutover status/i,
  );
  assert.throws(
    () => parseCutoverStatus({ ...status, unexpected: true }),
    /cutover status/i,
  );
  assert.throws(
    () => parseBrowserMigrationResult({
      migration,
      report: { ...report, targetProfiles: [] },
    }),
    /migration report/i,
  );
});

test('cutover requests preserve abort signals and exact command headers', async (context) => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, 'fetch', async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests.push({ input: String(input), init });
    const body = requests.length === 1
      ? status
      : requests.length === 2
        ? preference
        : { migration, report };
    return new Response(JSON.stringify(body), {
      status: requests.length === 3 ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const controller = new AbortController();
  const bundle = {
    schema: 'study-os.browser-migration.v1',
    migrationId: 'browser-a1',
  };

  await fetchCutoverStatus(controller.signal);
  await updateActiveTarget('rfb_auditor', 2, controller.signal);
  await migrateBrowserState(bundle, 'browser-cutover:api-a1', controller.signal);

  assert.equal(requests[0]?.input, '/api/v1/cutover/status');
  assert.equal(requests[0]?.init?.signal, controller.signal);
  assert.equal(requests[1]?.input, '/api/v1/preferences/active-target');
  assert.equal(requests[1]?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    targetSlug: 'rfb_auditor',
    version: 2,
  });
  assert.equal(requests[2]?.input, '/api/v1/cutover/browser-migration');
  assert.equal(requests[2]?.init?.method, 'POST');
  assert.equal(
    (requests[2]?.init?.headers as Record<string, string>)['Idempotency-Key'],
    'browser-cutover:api-a1',
  );
  assert.equal(requests[2]?.init?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), bundle);
});

test('cutover requests surface structured API errors without the request body', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'migration_replay_conflict',
    message: 'idempotency key already belongs to a different migration payload',
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  }));

  await assert.rejects(
    migrateBrowserState(
      { secret: 'must-never-appear-in-the-error' },
      'browser-cutover:conflict',
    ),
    (error: unknown) => (
      error instanceof StudyOsApiError
      && error.status === 409
      && error.code === 'migration_replay_conflict'
      && !error.message.includes('must-never-appear')
    ),
  );
});
