import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultTaskWorkTab,
  normalizeTaskWorkTabForTask,
  taskHasExecutableQuestions,
} from './taskWorkModes';
import { StudyTask } from '../types';

const buildTask = (withExecutableQuestion: boolean): StudyTask => ({
  id: withExecutableQuestion ? 'with-question' : 'without-question',
  date: '2026-07-05T00:00:00.000Z',
  discipline: 'Legislacao Tributaria Estadual',
  bank: 'Professor',
  status: 'completed',
  blocks: [
    {
      id: 'block-1',
      title: 'Aula 03',
      lesson: 'Aula 03',
      pages: '',
      bank: 'Professor',
      questions: withExecutableQuestion
        ? [
            {
              number: 1,
              statement: 'Enunciado recuperavel no historico.',
              alternatives: [
                { label: 'A', text: 'Alternativa A' },
                { label: 'B', text: 'Alternativa B' },
              ],
              answer: '',
              isCorrect: null,
              hasDoubt: false,
            },
          ]
        : [
            {
              number: 1,
              answer: '',
              isCorrect: null,
              hasDoubt: false,
            },
          ],
    },
  ],
});

test('taskHasExecutableQuestions detects recoverable question notebooks', () => {
  assert.equal(taskHasExecutableQuestions(buildTask(true)), true);
  assert.equal(taskHasExecutableQuestions(buildTask(false)), false);
  assert.equal(taskHasExecutableQuestions(null), false);
});

test('getDefaultTaskWorkTab opens executable notebooks in question mode', () => {
  assert.equal(getDefaultTaskWorkTab(buildTask(true)), 'questoes');
  assert.equal(getDefaultTaskWorkTab(buildTask(false)), 'caderno');
});

test('normalizeTaskWorkTabForTask keeps history question modes only when executable', () => {
  assert.equal(normalizeTaskWorkTabForTask(buildTask(true), 'cards'), 'cards');
  assert.equal(normalizeTaskWorkTabForTask(buildTask(true), 'gabarito'), 'gabarito');
  assert.equal(normalizeTaskWorkTabForTask(buildTask(false), 'cards'), 'caderno');
  assert.equal(normalizeTaskWorkTabForTask(buildTask(false), 'questoes'), 'caderno');
});
