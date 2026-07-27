import assert from 'node:assert/strict';
import test from 'node:test';

import { getGabaritoQuestionNumber, parseGabarito } from './gabaritoParser';

test('preserves the association when question numbers arrive out of order', () => {
  const result = parseGabarito('47 45 46\nE C D');

  assert.deepEqual([...result.answers.entries()], [[47, 'E'], [45, 'C'], [46, 'D']]);
  assert.deepEqual(result.errors, []);
});

test('rejects a numbered row whose answer count does not match', () => {
  const result = parseGabarito('45 46 47 48\nC E A D A');

  assert.equal(result.answers.size, 0);
  assert.match(result.errors.join(' '), /4 questões e 5 respostas/i);
});

test('rejects repeated question numbers instead of overriding an answer', () => {
  const result = parseGabarito('45 45\nC D');

  assert.match(result.errors.join(' '), /45.*repetida/i);
});

test('normalizes a Cyrillic B copied from a PDF answer key', () => {
  const result = parseGabarito('74\nВ');

  assert.deepEqual([...result.answers.entries()], [[74, 'B']]);
  assert.deepEqual(result.errors, []);
});

test('accepts explicit number and answer pairs', () => {
  const result = parseGabarito('45. C\n46 - ERRADO\n47: ANULADA');

  assert.deepEqual([...result.answers.entries()], [[45, 'C'], [46, 'E'], [47, 'ANULADA']]);
  assert.deepEqual(result.errors, []);
});

test('uses the printed question number even when the card has another internal number', () => {
  assert.equal(getGabaritoQuestionNumber({ number: 80, sourceQuestionNumber: 44 }), 44);
  assert.equal(getGabaritoQuestionNumber({ number: 80 }), 80);
});
