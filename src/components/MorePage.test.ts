import assert from 'node:assert/strict';
import test from 'node:test';
import { MORE_SECTIONS } from './MorePage';

test('More keeps the secondary study capabilities reachable', () => {
  assert.deepEqual(MORE_SECTIONS.map((item) => item.id), ['meta', 'review', 'courses', 'insights', 'maps', 'history', 'generator', 'archived', 'backup', 'account']);
});
