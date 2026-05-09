import test from 'node:test';
import assert from 'node:assert/strict';

import { StudyTask } from '../types';
import { mergeTasksForSync } from './syncMerge';

const task = (id: string, updatedAt: string, title = id): StudyTask => ({
  id,
  updatedAt,
  date: updatedAt,
  discipline: title,
  bank: 'Outra',
  blocks: [],
  status: 'in_progress'
});

test('mergeTasksForSync keeps the newest task version per id and reports local winners', () => {
  const remote = [
    task('remote-only', '2026-05-07T10:00:00.000Z'),
    task('shared-local-newer', '2026-05-07T09:00:00.000Z', 'remote old'),
    task('shared-remote-newer', '2026-05-07T11:00:00.000Z', 'remote new')
  ];
  const local = [
    task('shared-local-newer', '2026-05-07T12:00:00.000Z', 'local new'),
    task('shared-remote-newer', '2026-05-07T10:30:00.000Z', 'local old'),
    task('local-only', '2026-05-07T13:00:00.000Z')
  ];

  const result = mergeTasksForSync(remote, local);

  assert.deepEqual(result.merged.map(item => item.id), [
    'remote-only',
    'shared-local-newer',
    'shared-remote-newer',
    'local-only'
  ]);
  assert.equal(result.merged.find(item => item.id === 'shared-local-newer')?.discipline, 'local new');
  assert.equal(result.merged.find(item => item.id === 'shared-remote-newer')?.discipline, 'remote new');
  assert.equal(result.hadLocalWinner, true);
  assert.equal(result.localWins, 2);
  assert.equal(result.remoteWins, 2);
});
