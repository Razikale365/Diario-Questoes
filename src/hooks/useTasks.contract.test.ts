import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useTasks.ts', import.meta.url), 'utf8');

test('task PDF import persists before updating React state or dispatching bank events', () => {
  const start = source.indexOf('const commitTaskQuestionImport');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('\n  };', start) + 5);
  const persistAt = body.indexOf('persistTaskQuestionImportSnapshot');
  const stateAt = body.indexOf('setTasks(nextTasks)');
  const eventAt = body.indexOf('QUESTION_BANK_UPDATED_EVENT');

  assert.ok(persistAt >= 0);
  assert.ok(stateAt > persistAt);
  assert.ok(eventAt > stateAt);
});
