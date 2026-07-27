import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuestionCardDeck,
  findAdjacentQuestionCardBlockIndex,
  findQuestionCardIndexByDisplayNumber,
  findFirstUnansweredCardIndex,
  findNextUnansweredQuestionCardIndex,
  findRandomUnansweredQuestionCardIndex,
  getQuestionCardAlternativeShortcut,
  getQuestionCardNavigationShortcut,
  sortQuestionsByDisplayNumber,
  shouldHandleQuestionCardShortcut,
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

test('sortQuestionsByDisplayNumber restores the original question order after a manual correction', () => {
  const questions = [
    { number: 80, sourceQuestionNumber: 80 },
    { number: 44, sourceQuestionNumber: 44 },
    { number: 45, sourceQuestionNumber: 45 },
  ];

  assert.deepEqual(
    sortQuestionsByDisplayNumber(questions).map((question) => question.sourceQuestionNumber),
    [44, 45, 80],
  );
});

test('findFirstUnansweredCardIndex prefers the next pending card', () => {
  const cards = buildQuestionCardDeck(buildTask());

  assert.equal(findFirstUnansweredCardIndex(cards), 1);
  assert.equal(findFirstUnansweredCardIndex(cards.map((card) => ({ ...card, isAnswered: true }))), 0);
  assert.equal(findFirstUnansweredCardIndex([]), 0);
});

test('findQuestionCardIndexByDisplayNumber uses the printed number instead of the deck position', () => {
  const cards = [
    { displayNumber: 44 },
    { displayNumber: 46 },
    { displayNumber: 49 },
  ];

  assert.equal(findQuestionCardIndexByDisplayNumber(cards, 46), 1);
  assert.equal(findQuestionCardIndexByDisplayNumber(cards, 45), -1);
});

test('getQuestionCardNavigationShortcut maps Tec-style arrow navigation only', () => {
  assert.equal(getQuestionCardNavigationShortcut('ArrowLeft'), 'previous');
  assert.equal(getQuestionCardNavigationShortcut('ArrowRight'), 'next');
  assert.equal(getQuestionCardNavigationShortcut('ArrowLeft', true), null);
  assert.equal(getQuestionCardNavigationShortcut('ArrowRight', true), null);
  assert.equal(getQuestionCardNavigationShortcut('Enter'), null);
  assert.equal(getQuestionCardNavigationShortcut('a'), null);
});

test('Tec unanswered navigation finds the next pending card and can randomize it', () => {
  const cards = buildQuestionCardDeck(buildTask());

  assert.equal(findNextUnansweredQuestionCardIndex(cards, 0), 1);
  assert.equal(findNextUnansweredQuestionCardIndex(cards, 1), 1);
  assert.equal(findRandomUnansweredQuestionCardIndex(cards, 0, () => 0), 1);
  assert.equal(findRandomUnansweredQuestionCardIndex(cards, 0, () => 0.99), 1);
});

test('Tec topic navigation moves between card blocks without leaving the deck', () => {
  const cards = buildQuestionCardDeck(buildTask());

  assert.equal(findAdjacentQuestionCardBlockIndex(cards, 0, 'next'), 1);
  assert.equal(findAdjacentQuestionCardBlockIndex(cards, 1, 'previous'), 0);
  assert.equal(findAdjacentQuestionCardBlockIndex(cards, 0, 'previous'), 0);
});

test('Tec alternative shortcuts accept letters and position keys only for visible alternatives', () => {
  const alternatives = [
    { label: 'A', text: 'Alternativa A' },
    { label: 'B', text: 'Alternativa B' },
  ];

  assert.equal(getQuestionCardAlternativeShortcut('a', alternatives), 'A');
  assert.equal(getQuestionCardAlternativeShortcut('2', alternatives), 'B');
  assert.equal(getQuestionCardAlternativeShortcut('3', alternatives), null);
  assert.equal(getQuestionCardAlternativeShortcut('N', alternatives), null);
});

test('question card shortcuts yield to modifiers, editable targets, dialogs, and handled events', () => {
  assert.equal(shouldHandleQuestionCardShortcut({}), true);
  assert.equal(shouldHandleQuestionCardShortcut({ hasModifier: true }), false);
  assert.equal(shouldHandleQuestionCardShortcut({ isEditable: true }), false);
  assert.equal(shouldHandleQuestionCardShortcut({ isDialogOpen: true }), false);
  assert.equal(shouldHandleQuestionCardShortcut({ isDefaultPrevented: true }), false);
  assert.equal(shouldHandleQuestionCardShortcut({ isEnterOnInteractiveControl: true }), false);
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
