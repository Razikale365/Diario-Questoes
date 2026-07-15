import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIMARY_DESTINATIONS } from './PrimaryNavigation';

test('primary navigation exposes exactly four ordered destinations', () => {
  assert.deepEqual(PRIMARY_DESTINATIONS.map((item) => item.id), ['today', 'calendar', 'tasks', 'more']);
});
