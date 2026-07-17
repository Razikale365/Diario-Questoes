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

test('apply aborts a pre-apply head and yields to a truly later reload', async () => {
  const gate = createCalendarRequestGate();
  const preApplyHead = gate.begin();
  let document = 'draft';
  let resolvePreApply!: (value: string) => void;
  let resolveApply!: (value: string) => void;
  const preApply = new Promise<string>((resolve) => { resolvePreApply = resolve; });
  const applyResponse = new Promise<string>((resolve) => { resolveApply = resolve; });
  const applyPreHead = preApply.then((value) => gate.applyIfCurrent(preApplyHead, () => { document = value; }));

  const applyRequest = gate.begin();
  const applyApplied = applyResponse.then((value) => gate.applyIfCurrent(applyRequest, () => { document = value; }));
  const laterReload = gate.begin();
  gate.applyIfCurrent(laterReload, () => { document = 'later-reload'; });
  resolvePreApply('stale-pre-apply-head');
  resolveApply('stale-apply-response');
  await Promise.all([applyPreHead, applyApplied]);

  assert.equal(preApplyHead.signal.aborted, true);
  assert.equal(document, 'later-reload');
});
