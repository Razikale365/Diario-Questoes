import assert from 'node:assert/strict';
import test from 'node:test';

import { createTaskQuestionImportParseGate } from './taskQuestionImportParseGate';

test('only the active import parse generation may publish a result', () => {
  const gate = createTaskQuestionImportParseGate();
  const firstPdf = gate.begin();
  const replacementPdf = gate.begin();

  assert.equal(gate.isCurrent(firstPdf), false);
  assert.equal(gate.isCurrent(replacementPdf), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(replacementPdf), false);

  const reopenedModalParse = gate.begin();
  assert.equal(gate.isCurrent(reopenedModalParse), true);
});
