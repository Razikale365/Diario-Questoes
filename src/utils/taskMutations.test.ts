import test from 'node:test';
import assert from 'node:assert/strict';

import { ActivityBlock } from '../types';
import { autoSnapTaskBlocks, moveBlockByStep, moveBlocks } from './taskMutations';

const activity = (id: string, lesson = ''): ActivityBlock => ({
  id,
  title: id,
  lesson,
  pages: '',
  questions: [{ number: 1, answer: '', isCorrect: null, hasDoubt: false }]
});

const section = (id: string, title: string): ActivityBlock => ({
  id,
  title,
  lesson: title,
  pages: '',
  questions: [],
  isSection: true
});

test('moveBlocks moves a section together with its lesson-matched child blocks', () => {
  const blocks = [
    section('sec-1', 'Aula 1'),
    activity('q-1', 'Aula 1'),
    activity('q-2', 'Aula 1'),
    section('sec-2', 'Aula 2'),
    activity('q-3', 'Aula 2')
  ];

  const moved = moveBlocks(blocks, 'sec-1', 'q-3');

  assert.deepEqual(moved.map(block => block.id), ['sec-2', 'sec-1', 'q-1', 'q-2', 'q-3']);
});

test('moveBlocks creates a section when two free activity blocks are fused', () => {
  const moved = moveBlocks([activity('q-1'), activity('q-2'), activity('q-3', 'Aula 3')], 'q-1', 'q-2');

  assert.equal(moved[0].isSection, true);
  assert.equal(moved[0].title, 'Nova Seção');
  assert.equal(moved[1].lesson, 'Nova Seção');
  assert.equal(moved[2].lesson, 'Nova Seção');
  assert.deepEqual(moved.map(block => block.id).slice(1), ['q-1', 'q-2', 'q-3']);
});

test('moveBlockByStep gives mobile users a deterministic non-drag reorder path', () => {
  const moved = moveBlockByStep([activity('q-1'), activity('q-2'), activity('q-3')], 'q-2', -1);

  assert.deepEqual(moved.map(block => block.id), ['q-2', 'q-1', 'q-3']);
});

test('autoSnapTaskBlocks groups activities below matching section headers', () => {
  const snapped = autoSnapTaskBlocks([
    activity('loose'),
    activity('q-2', 'Aula 2'),
    section('sec-2', 'Aula 2'),
    activity('q-1', 'Aula 1'),
    section('sec-1', 'Aula 1')
  ]);

  assert.deepEqual(snapped.map(block => block.id), ['sec-2', 'q-2', 'sec-1', 'q-1', 'loose']);
});
