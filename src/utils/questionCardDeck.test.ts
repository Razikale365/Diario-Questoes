import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuestionCardDeck,
  findFirstUnansweredCardIndex,
  summarizeQuestionCardDeck,
} from './questionCardDeck';
import { StudyTask } from '../types';

const buildTask = (): StudyTask => ({
  id: 'task-1',
  date: '2026-07-05T00:00:00.000Z',
  discipline: 'Legislacao Tributaria Estadual',
  bank: 'Professor',
  status: 'in_progress',
  blocks: [
    {
      id: 'section-1',
      title: 'Aula 03',
      lesson: 'Aula 03',
      pages: '',
      isSection: true,
      questions: [],
    },
    {
      id: 'block-1',
      title: 'Lei 18.665 - Parte 1',
      lesson: 'Aula 03',
      pages: '1-12',
      bank: 'Professor',
      questions: [
        {
          number: 1,
          sourceQuestionNumber: 7,
          statement: 'Questao completa ja respondida.',
          alternatives: [
            { label: 'A', text: 'Alternativa A' },
            { label: 'B', text: 'Alternativa B' },
          ],
          answer: 'A',
          correctAnswer: 'A',
          isCorrect: true,
          hasDoubt: false,
          localId: 'q-1',
        },
        {
          number: 2,
          answer: '',
          isCorrect: null,
          hasDoubt: false,
        },
      ],
    },
    {
      id: 'block-2',
      title: 'Lei 18.665 - Parte 2',
      lesson: 'Aula 04',
      pages: '13-28',
      bank: 'Professor',
      questions: [
        {
          number: 3,
          sourceQuestionNumber: 8,
          statement: 'Questao completa pendente.',
          alternatives: [
            { label: 'A', text: 'Alternativa A' },
            { label: 'B', text: 'Alternativa B' },
          ],
          answer: '',
          correctAnswer: 'B',
          isCorrect: null,
          hasDoubt: true,
          favorite: true,
          localId: 'q-3',
        },
      ],
    },
  ],
});

test('buildQuestionCardDeck flattens only executable questions', () => {
  const cards = buildQuestionCardDeck(buildTask());

  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map((card) => ({
      id: card.id,
      blockId: card.blockId,
      blockTitle: card.blockTitle,
      displayNumber: card.displayNumber,
      isAnswered: card.isAnswered,
    })),
    [
      {
        id: 'q-1',
        blockId: 'block-1',
        blockTitle: 'Lei 18.665 - Parte 1',
        displayNumber: 7,
        isAnswered: true,
      },
      {
        id: 'q-3',
        blockId: 'block-2',
        blockTitle: 'Lei 18.665 - Parte 2',
        displayNumber: 8,
        isAnswered: false,
      },
    ],
  );
});

test('findFirstUnansweredCardIndex prefers the next pending card', () => {
  const cards = buildQuestionCardDeck(buildTask());

  assert.equal(findFirstUnansweredCardIndex(cards), 1);
  assert.equal(findFirstUnansweredCardIndex(cards.map((card) => ({ ...card, isAnswered: true }))), 0);
  assert.equal(findFirstUnansweredCardIndex([]), 0);
});

test('summarizeQuestionCardDeck counts execution progress', () => {
  const summary = summarizeQuestionCardDeck(buildQuestionCardDeck(buildTask()));

  assert.deepEqual(summary, {
    total: 2,
    answered: 1,
    correct: 1,
    wrong: 0,
    doubts: 1,
    favorites: 1,
    accuracy: 100,
  });
});
