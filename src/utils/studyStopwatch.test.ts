import assert from 'node:assert/strict';
import test from 'node:test';

import { formatElapsedSeconds, getElapsedSeconds } from './studyStopwatch';

test('getElapsedSeconds adds only the time elapsed while the stopwatch is running', () => {
  assert.equal(getElapsedSeconds(75, 1_000, 8_900), 82);
  assert.equal(getElapsedSeconds(75, null, 8_900), 75);
  assert.equal(getElapsedSeconds(75, 9_000, 8_900), 75);
});

test('formatElapsedSeconds presents short and long durations clearly', () => {
  assert.equal(formatElapsedSeconds(0), '00:00');
  assert.equal(formatElapsedSeconds(65), '01:05');
  assert.equal(formatElapsedSeconds(3_661), '01:01:01');
});
