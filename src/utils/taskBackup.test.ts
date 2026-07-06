import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyTask } from '../types';
import { mergeStudyTaskBackup, parseStudyTaskBackup } from './taskBackup';

const buildTask = (id: string, answer = ''): StudyTask => ({
  id,
  date: '2026-07-05T00:00:00.000Z',
  planejamento: 'SEFAZ CE',
  meta: '46',
  tarefa: '29',
  assunto: 'Lei 18.665/2023',
  discipline: 'Legis. Tribut. Estadual (ICMS)',
  bank: 'Outra',
  status: 'completed',
  blocks: [
    {
      id: `${id}-block`,
      title: 'Aula',
      lesson: 'Aula 03',
      pages: '',
      questions: [{ number: 1, answer, isCorrect: answer ? true : null, hasDoubt: false }],
    },
  ],
});

test('parseStudyTaskBackup normalizes old task backups with missing layout', () => {
  const [task] = parseStudyTaskBackup([buildTask('task-1')]);

  assert.equal(task.blocks[0].layout?.type, 'columns');
  assert.equal(task.blocks[0].layout?.width, 12);
});

test('mergeStudyTaskBackup preserves local duplicate progress and adds missing tasks', () => {
  const local = buildTask('task-1', 'A');
  const duplicateFromBackup = buildTask('task-1', '');
  const missingFromBackup = buildTask('task-2', 'B');

  const result = mergeStudyTaskBackup([local], [duplicateFromBackup, missingFromBackup]);

  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks.find((task) => task.id === 'task-1')?.blocks[0].questions[0].answer, 'A');
  assert.equal(result.tasks.find((task) => task.id === 'task-2')?.blocks[0].questions[0].answer, 'B');
});
