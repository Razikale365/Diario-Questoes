import assert from 'node:assert/strict';
import test from 'node:test';

import { isStudyOsHealthOperational, parseStudyOsHealth } from './health';

test('parseStudyOsHealth accepts the service contract', () => {
  assert.deepEqual(parseStudyOsHealth({
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: 0,
  }), {
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: 0,
  });
});

test('parseStudyOsHealth rejects malformed responses', () => {
  assert.throws(() => parseStudyOsHealth({ status: 'ok' }), /health response/i);
  assert.throws(() => parseStudyOsHealth({
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: -1,
  }), /health response/i);
});

test('isStudyOsHealthOperational requires an ok service and database', () => {
  const health = parseStudyOsHealth({
    status: 'ok',
    serviceVersion: '0.1.0',
    schemaVersion: 1,
    database: 'ok',
    backup: 'missing',
    configuredRoots: 0,
  });

  assert.equal(isStudyOsHealthOperational(health), true);
  assert.equal(isStudyOsHealthOperational({ ...health, status: 'error' }), false);
  assert.equal(isStudyOsHealthOperational({ ...health, database: 'error' }), false);
});
