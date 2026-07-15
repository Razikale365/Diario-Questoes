import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTaskResultDraft } from './taskResultDraft';

test('result drafts tolerate incomplete typing and validate only on submit', () => {
  assert.deepEqual(parseTaskResultDraft({ spentMinutes: '', performance: '-' }), {
    ok: false,
    errors: { spentMinutes: 'Use minutos entre 0 e 240', performance: 'Use um percentual entre 0 e 100' },
  });
  assert.deepEqual(parseTaskResultDraft({ spentMinutes: '45', performance: '91' }), {
    ok: true, value: { spentMinutes: 45, performance: 91 },
  });
});
