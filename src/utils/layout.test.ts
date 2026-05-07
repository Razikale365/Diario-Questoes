import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTaskBlocksLayout, DEFAULT_ACTIVITY_LAYOUT } from './layout';
import { StudyTask } from '../types';

test('normalizeTaskBlocksLayout applies the new default layout only to activity blocks that do not define one', () => {
  const task: StudyTask = {
    id: 'task-1',
    date: '2026-05-07T00:00:00.000Z',
    discipline: 'Economia',
    bank: 'Outra',
    status: 'in_progress',
    blocks: [
      {
        id: 'block-1',
        title: 'Atividade 2 - Bloco 1',
        lesson: 'Aula 9 - Versão Original',
        pages: '51 a 63',
        questions: [{ number: 1, answer: '', isCorrect: null, hasDoubt: false }]
      },
      {
        id: 'block-2',
        title: 'Atividade 2 - Bloco 2',
        lesson: 'Aula 9 - Versão Original',
        pages: '90 a 95',
        questions: [{ number: 1, answer: '', isCorrect: null, hasDoubt: false }],
        layout: { columns: 4, rows: 6, type: 'grid', width: 12 }
      }
    ]
  };

  const normalized = normalizeTaskBlocksLayout(task);

  assert.deepEqual(normalized.blocks[0].layout, DEFAULT_ACTIVITY_LAYOUT);
  assert.deepEqual(normalized.blocks[1].layout, { columns: 4, rows: 6, type: 'grid', width: 12 });
});
