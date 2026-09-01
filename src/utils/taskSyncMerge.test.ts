import assert from 'node:assert/strict';
import test from 'node:test';

import type { Question, StudyTask } from '../types';
import {
  deduplicateStudyTaskCollections,
  mergeStudyTaskCollections,
} from './taskSyncMerge';

const buildTask = (
  id: string,
  updatedAt: string,
  questions: Question[],
): StudyTask => ({
  id,
  date: '2026-07-28T00:00:00.000Z',
  updatedAt,
  planejamento: 'Reta Final SEFAZ CE 2026',
  meta: 'Semana final',
  tarefa: id,
  assunto: 'Simulado extra',
  discipline: 'Simulados',
  bank: 'FCC',
  status: 'in_progress',
  blocks: [{
    id: `${id}-block`,
    title: 'Questões',
    lesson: 'Simulado',
    pages: '',
    questions,
  }],
});

const unanswered = (number: number): Question => ({
  number,
  answer: '',
  isCorrect: null,
  hasDoubt: false,
});

test('mergeStudyTaskCollections keeps tasks that exist in only one browser origin', () => {
  const remote = buildTask('remote-only', '2026-07-28T20:00:00.000Z', [unanswered(1)]);
  const local = buildTask('local-only', '2026-07-28T21:00:00.000Z', [unanswered(1)]);

  const result = mergeStudyTaskCollections([remote], [local]);

  assert.deepEqual(result.tasks.map((task) => task.id), ['remote-only', 'local-only']);
  assert.equal(result.differsFromRemote, true);
});

test('mergeStudyTaskCollections preserves answers made in different origins on the same task', () => {
  const remote = buildTask('same-task', '2026-07-28T21:00:00.000Z', [
    { ...unanswered(1), answer: 'A', isCorrect: true },
    unanswered(2),
  ]);
  const local = buildTask('same-task', '2026-07-28T21:05:00.000Z', [
    unanswered(1),
    { ...unanswered(2), answer: 'C', isCorrect: false, hasDoubt: true },
  ]);

  const result = mergeStudyTaskCollections([remote], [local]);
  const questions = result.tasks[0]?.blocks[0]?.questions;

  assert.equal(questions?.[0]?.answer, 'A');
  assert.equal(questions?.[0]?.isCorrect, true);
  assert.equal(questions?.[1]?.answer, 'C');
  assert.equal(questions?.[1]?.isCorrect, false);
  assert.equal(questions?.[1]?.hasDoubt, true);
  assert.equal(result.differsFromRemote, true);
});

test('mergeStudyTaskCollections does not republish semantically identical task payloads', () => {
  const remote = buildTask('same-task', '2026-07-28T21:00:00.000Z', [unanswered(1)]);
  const local: StudyTask = {
    blocks: remote.blocks,
    status: remote.status,
    bank: remote.bank,
    discipline: remote.discipline,
    assunto: remote.assunto,
    tarefa: remote.tarefa,
    meta: remote.meta,
    planejamento: remote.planejamento,
    updatedAt: remote.updatedAt,
    date: remote.date,
    id: remote.id,
  };

  const result = mergeStudyTaskCollections([remote], [local]);

  assert.equal(result.differsFromRemote, false);
});

test('deduplicateStudyTaskCollections removes only copies whose content and progress are covered', () => {
  const canonical = buildTask('canonical', '2026-07-28T21:00:00.000Z', [
    { ...unanswered(1), statement: 'Questão um', answer: 'A', isCorrect: true },
    { ...unanswered(2), statement: 'Questão dois', answer: 'C', isCorrect: false },
  ]);
  const coveredPartial = {
    ...buildTask('partial', '2026-07-28T20:00:00.000Z', [
      {
        ...unanswered(1),
        statement: 'Questão um',
        answer: 'A',
      },
    ]),
    tarefa: canonical.tarefa,
  };
  const blankCopy = {
    ...buildTask('blank', '2026-07-28T22:00:00.000Z', [
      { ...unanswered(1), statement: 'Questão um' },
    ]),
    tarefa: canonical.tarefa,
  };
  const conflictingDraft = {
    ...buildTask('conflicting', '2026-07-28T20:30:00.000Z', [
      {
        ...unanswered(1),
        statement: 'Questão um',
        answer: 'B',
        eliminated: ['A'],
        doubtedAlts: ['B'],
      },
    ]),
    tarefa: canonical.tarefa,
  };
  const uniqueBlankContent = {
    ...buildTask('unique-blank', '2026-07-28T20:45:00.000Z', [
      { ...unanswered(3), statement: 'Questão exclusiva' },
    ]),
    tarefa: canonical.tarefa,
  };

  const result = deduplicateStudyTaskCollections([
    blankCopy,
    coveredPartial,
    conflictingDraft,
    uniqueBlankContent,
    canonical,
  ]);

  assert.deepEqual(
    result.tasks.map((task) => task.id),
    ['conflicting', 'unique-blank', 'canonical'],
  );
  assert.deepEqual(result.removedIds.sort(), ['blank', 'partial']);
});

test('deduplicateStudyTaskCollections retains one rich copy only for same-day empty planner duplicates', () => {
  const older = buildTask('older', '2026-07-28T20:00:00.000Z', []);
  const richer = {
    ...buildTask('richer', '2026-07-28T21:00:00.000Z', [unanswered(1)]),
    tarefa: older.tarefa,
  };
  const nextDay = {
    ...buildTask('next-day', '2026-07-29T21:00:00.000Z', [unanswered(1)]),
    tarefa: older.tarefa,
    date: '2026-07-29T00:00:00.000Z',
  };
  const simulatorExtra = {
    ...richer,
    id: 'simulator-extra',
    tarefa: '',
  };

  const result = deduplicateStudyTaskCollections([older, richer, nextDay, simulatorExtra]);

  assert.deepEqual(
    result.tasks.map((task) => task.id),
    ['richer', 'next-day', 'simulator-extra'],
  );
  assert.deepEqual(result.removedIds, ['older']);
});
