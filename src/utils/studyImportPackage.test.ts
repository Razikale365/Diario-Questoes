import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerMetaSummary, PlannerTask, QuestionBankItem } from '../types';
import { parseStudyImportPackage, parseWeekScheduleImport } from './studyImportPackage';

const meta: PlannerMetaSummary = {
  id: 'meta-46',
  title: 'Meta 46',
  metaNumber: 46,
  totalTasks: 2,
  totalDisciplines: 1,
  completedPercent: 0,
  completedTasks: 0,
  pendingTasks: 2,
  ignoredTasks: 0,
  startedTasks: 0,
  importedAt: '2026-07-04T00:00:00.000Z',
};

const task: PlannerTask = {
  id: 'meta-46-task-29',
  number: 29,
  metaNumber: 46,
  discipline: 'Legis. Tribut. Estadual (ICMS)',
  format: 'Revisao',
  description: 'Lei 18.665/2023 - Arts. 01 ao 06',
  spentMinutes: 0,
  estimatedMinutes: 60,
  performance: null,
  status: 'pending',
  relevance: 8,
  durationMinutes: 60,
  source: 'ls-meta-pdf',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
};

const question: QuestionBankItem = {
  id: 'question-1',
  fingerprint: 'fingerprint-1',
  sourceQuestionNumber: 1,
  statement: 'Enunciado de teste.',
  alternatives: [{ label: 'A', text: 'Alternativa A' }],
  correctAnswer: 'A',
  sourceKind: 'professor',
  sourceName: 'Professor Raphael Senra - Aula 03',
  discipline: 'Legis. Tribut. Estadual (ICMS)',
  lesson: 'Lei 18.665/2023',
  taskTitle: 'Meta 46 - Tarefa 29',
  bank: 'Professor',
  tags: ['Meta 46'],
  favorite: false,
  hasDoubt: false,
  attempts: [],
  importedAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
};

test('parseStudyImportPackage reads combined planner and question-bank payloads', () => {
  const parsed = parseStudyImportPackage(JSON.stringify({
    planner: { meta, tasks: [task] },
    questionBankItems: [question],
  }));

  assert.ok(parsed);
  assert.equal(parsed.meta.title, 'Meta 46');
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.questionBankItems.length, 1);
});

test('parseStudyImportPackage ignores ordinary LS pasted text', () => {
  assert.equal(parseStudyImportPackage('Tarefa 1\\nDireito Tributario'), null);
});

test('parseWeekScheduleImport reads compact weekly schedule payloads', () => {
  const parsed = parseWeekScheduleImport(JSON.stringify({
    schema: 'diario-questoes.week-schedule',
    metaNumber: 46,
    startDate: '2026-07-06',
    endDate: '2026-07-11',
    entries: [
      { number: 29, date: '2026-07-06', startTime: '09:15' },
      { number: 31, date: '2026-07-07', startTime: '08:00' },
    ],
  }));

  assert.ok(parsed);
  assert.equal(parsed.metaNumber, 46);
  assert.equal(parsed.entries.length, 2);
});
