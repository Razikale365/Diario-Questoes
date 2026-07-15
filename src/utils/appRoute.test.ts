import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAppHash, parseAppRoute } from './appRoute';

test('unknown or empty hashes resolve to IA Hoje', () => {
  assert.equal(parseAppRoute('').destination, 'today');
  assert.equal(parseAppRoute('#/unknown').destination, 'today');
});

test('task query survives hash round trip', () => {
  const route = parseAppRoute('#/tasks?q=icms&status=pending&task=source-12');
  assert.equal(buildAppHash(route), '#/tasks?q=icms&status=pending&task=source-12');
});
