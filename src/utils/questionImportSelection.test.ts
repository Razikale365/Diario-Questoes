import assert from 'node:assert/strict';
import test from 'node:test';

import type { ImportedObjectiveQuestion } from './objectiveQuestionParser';
import {
  createQuestionImportSelection,
  filterQuestionsByImportSelection,
  toggleQuestionImportSelection,
} from './questionImportSelection';

const questions: ImportedObjectiveQuestion[] = [1, 2, 3].map((number) => ({
  localId: `parsed-${number}`,
  number,
  statement: `Questão ${number}`,
  alternatives: [
    { label: 'A', text: 'Alternativa A' },
    { label: 'B', text: 'Alternativa B' },
  ],
}));

test('starts with every detected question selected and filters in source order', () => {
  const selection = createQuestionImportSelection(questions);

  assert.deepEqual([...selection], [1, 2, 3]);
  assert.deepEqual(
    filterQuestionsByImportSelection(questions, new Set([3, 1])).map((question) => question.number),
    [1, 3],
  );
});

test('toggles one source number without mutating the prior selection', () => {
  const selection = new Set([1, 2, 3]);
  const deselected = toggleQuestionImportSelection(selection, 2);
  const selectedAgain = toggleQuestionImportSelection(deselected, 2);

  assert.deepEqual([...selection], [1, 2, 3]);
  assert.deepEqual([...deselected], [1, 3]);
  assert.deepEqual([...selectedAgain], [1, 3, 2]);
});
