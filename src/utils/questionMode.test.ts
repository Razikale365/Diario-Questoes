import test from 'node:test';
import assert from 'node:assert/strict';

import { getNextQuestionMode, getQuestionAlternatives, isQuestionMultipleChoice } from './questionMode';
import { Question } from '../types';

const question = (isMultipleChoice?: boolean): Question => ({
  number: 1,
  answer: '',
  isCorrect: null,
  hasDoubt: false,
  ...(typeof isMultipleChoice === 'boolean' ? { isMultipleChoice } : {})
});

test('CEBRASPE defaults to certo/errado and toggles to multiple choice', () => {
  const q = question();
  const block = { bank: 'CEBRASPE' };

  assert.equal(isQuestionMultipleChoice(q, block), false);
  assert.deepEqual(getQuestionAlternatives(q, block), ['C', 'E']);
  assert.equal(getNextQuestionMode(q, block), true);
});

test('non-CEBRASPE defaults to multiple choice and can toggle to certo/errado', () => {
  const q = question();
  const block = { bank: 'FGV' };

  assert.equal(isQuestionMultipleChoice(q, block), true);
  assert.deepEqual(getQuestionAlternatives(q, block), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(getNextQuestionMode(q, block), false);
  assert.deepEqual(getQuestionAlternatives(question(false), block), ['C', 'E']);
});

test('explicit question mode overrides the block bank', () => {
  assert.deepEqual(getQuestionAlternatives(question(true), { bank: 'CEBRASPE' }), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(getQuestionAlternatives(question(false), { bank: 'FCC' }), ['C', 'E']);
});
