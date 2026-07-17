import assert from 'node:assert/strict';
import test from 'node:test';

import { createCalendarAutoOrganizeIntentGate, createCalendarRequestGate } from './SprintCalendarControl';

test('a durable auto-organize token is consumed once after Calendar mounts', () => {
  const gate = createCalendarAutoOrganizeIntentGate();
  const preMountToken = 3;

  assert.equal(gate.consume(preMountToken), true);
  assert.equal(gate.consume(preMountToken), false);
  assert.equal(gate.consume(preMountToken), false);
  assert.equal(gate.consume(4), true);
});

test('a late calendar head cannot overwrite a preview that invalidated its request', async () => {
  const gate = createCalendarRequestGate();
  const oldHead = gate.begin();
  let document = 'applied';
  let resolveOld!: (value: string) => void;
  const delayedOldHead = new Promise<string>((resolve) => { resolveOld = resolve; });
  const applyOldHead = delayedOldHead.then((value) => gate.applyIfCurrent(oldHead, () => { document = value; }));

  gate.invalidate();
  document = 'draft-preview';
  resolveOld('stale-applied-head');
  await applyOldHead;

  assert.equal(oldHead.signal.aborted, true);
  assert.equal(document, 'draft-preview');
});
