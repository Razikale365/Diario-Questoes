import assert from 'node:assert/strict';
import test from 'node:test';

import type { SprintAction, SprintDay, TaskExecutionResult } from '../api/sprint';
import { STUDY_OS_DATA_CHANGED } from '../dataChanged';
import {
  buildSprintActionExecutionInput,
  mergeSavedSprintAction,
  resultRefreshNotice,
  subscribeStudyOsDataChanged,
} from './executionUiState';
import { createCalendarRequestGate } from './SprintCalendarControl';

test('IA Hoje canonical execution input binds the saved source action version', () => {
  const action = { id: 41, version: 9 } as SprintAction;

  assert.deepEqual(buildSprintActionExecutionInput(action, 'completed', {
    performedOn: '2026-07-17', taskMinutes: 60, exerciseMinutes: 30,
    questionsTotal: 12, correctCount: 9, wrongCount: 3, doubtCount: 1,
    energyAfter: 3, notes: 'Caderno concluído',
  }), {
    outcome: 'completed',
    performedOn: '2026-07-17', taskMinutes: 60, exerciseMinutes: 30,
    questionsTotal: 12, correctCount: 9, wrongCount: 3, doubtCount: 1,
    energyAfter: 3, notes: 'Caderno concluído', sprintActionId: 41, expectedVersion: 9,
  });
});

test('saved action is reduced before a failed refresh and keeps the pending notice exact', () => {
  const day = { actions: [{ id: 41, state: 'pending', decision: 'pending', version: 8 }] } as SprintDay;
  const saved = { sprintAction: { id: 41, state: 'completed', decision: 'accepted', version: 9 } } as TaskExecutionResult;

  const afterSave = mergeSavedSprintAction(day, saved);
  const refreshFailed = true;

  assert.deepEqual(afterSave.actions[0], { id: 41, state: 'completed', decision: 'accepted', version: 9 });
  assert.equal(refreshFailed, true);
  assert.equal(resultRefreshNotice(false), 'Resultado salvo; recálculo pendente.');
});

test('data change subscription filters target/resources and stops after unsubscribe', () => {
  const bus = new EventTarget();
  let reloads = 0;
  const unsubscribe = subscribeStudyOsDataChanged(bus, 'sefaz_ce', ['sprint-day'], () => { reloads += 1; });
  const dispatch = (detail: unknown) => {
    const event = new Event(STUDY_OS_DATA_CHANGED);
    Object.defineProperty(event, 'detail', { value: detail });
    bus.dispatchEvent(event);
  };

  dispatch({ targetSlug: 'sefaz_go', resources: ['sprint-day'] });
  dispatch({ targetSlug: 'sefaz_ce', resources: ['calendar'] });
  dispatch({ targetSlug: 'sefaz_ce', resources: ['sprint-day'] });
  assert.equal(reloads, 1);

  unsubscribe();
  dispatch({ targetSlug: 'sefaz_ce', resources: ['sprint-day'] });
  assert.equal(reloads, 1);
});

test('an old IA Hoje event load cannot overwrite a recalculated day and cleanup aborts it', async () => {
  const gate = createCalendarRequestGate();
  const lifecycle = new AbortController();
  const oldEventLoad = gate.begin(lifecycle.signal);
  let day = 'saved-local-action';
  let resolveOld!: (value: string) => void;
  const oldResponse = new Promise<string>((resolve) => { resolveOld = resolve; });
  const applyOld = oldResponse.then((value) => gate.applyIfCurrent(oldEventLoad, () => { day = value; }));

  const recalculation = gate.begin();
  gate.applyIfCurrent(recalculation, () => { day = 'recalculated-day'; });
  lifecycle.abort();
  resolveOld('stale-event-day');
  await applyOld;

  assert.equal(oldEventLoad.signal.aborted, true);
  assert.equal(day, 'recalculated-day');
});
