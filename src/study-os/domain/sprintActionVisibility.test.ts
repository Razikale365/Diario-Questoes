import assert from 'node:assert/strict';
import test from 'node:test';

import type { SourcePlanTask, SprintAction } from '../api/sprint';
import { primarySprintActions, visibleSprintActions } from './sprintActionVisibility';

const sourceTask = (id: number, metaNumber: number) => ({ id, metaNumber }) as SourcePlanTask;
const action = (id: number, sourcePlanTaskId: number | null) => ({ id, sourcePlanTaskId }) as SprintAction;

test('visibleSprintActions removes prior-meta LS actions so Abrir never targets an obsolete task', () => {
  assert.deepEqual(
    visibleSprintActions([action(1, 47), action(2, 48), action(3, null)], [sourceTask(47, 47), sourceTask(48, 48)]).map((item) => item.id),
    [2, 3],
  );
});

test('primarySprintActions keeps the next executable actions instead of flooding the human queue', () => {
  const actions = [
    { id: 1, state: 'completed' },
    { id: 2, state: 'pending' },
    { id: 3, state: 'active' },
    { id: 4, state: 'pending' },
    { id: 5, state: 'pending' },
    { id: 6, state: 'pending' },
  ] as SprintAction[];

  assert.deepEqual(primarySprintActions(actions, 3).map((item) => item.id), [2, 3, 4]);
});
