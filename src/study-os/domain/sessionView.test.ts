import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProgressState } from '../api/sessions';
import {
  buildSessionView,
  clampConfirmedPage,
  elapsedMinutesToSeconds,
  elapsedSecondsToMinutes,
  skipReasonChoices,
} from './sessionView';

const progressAt = (
  cursorPage: number,
  status: ProgressState['status'],
): ProgressState => ({
  id: 1,
  lessonId: 2,
  materialId: 3,
  status,
  cursorPage,
  furthestPage: cursorPage,
  completedAt: status === 'covered' ? '2026-07-12T12:00:00+00:00' : null,
  lastSeenAt: '2026-07-12T12:00:00+00:00',
  confidence: status === 'covered' ? 0.7 : 0.2,
  totalSeconds: 1200,
  sessionCount: 1,
  version: 2,
});

test('partial result remains resumable at the confirmed page', () => {
  assert.deepEqual(buildSessionView(progressAt(18, 'in_progress')), {
    commandLabel: 'Continuar p. 18',
    startPage: 18,
    canComplete: true,
  });
});

test('unread, covered, and unavailable materials produce clear commands', () => {
  assert.deepEqual(buildSessionView(null), {
    commandLabel: 'Começar',
    startPage: 1,
    canComplete: true,
  });
  assert.deepEqual(buildSessionView(progressAt(120, 'covered')), {
    commandLabel: 'Continuar p. 120',
    startPage: 120,
    canComplete: false,
  });
  assert.deepEqual(buildSessionView(progressAt(18, 'weak'), false), {
    commandLabel: 'Material ausente',
    startPage: 18,
    canComplete: false,
  });
});

test('confirmed pages stay integral and inside material bounds', () => {
  assert.equal(clampConfirmedPage(22.8, 18, 120), 22);
  assert.equal(clampConfirmedPage(3, 18, 120), 18);
  assert.equal(clampConfirmedPage(300, 18, 120), 120);
  assert.equal(clampConfirmedPage(Number.NaN, 18, null), 18);
});

test('elapsed minute conversion is stable for numeric inputs', () => {
  assert.equal(elapsedMinutesToSeconds(1.5), 90);
  assert.equal(elapsedMinutesToSeconds(-3), 0);
  assert.equal(elapsedMinutesToSeconds(Number.NaN), 0);
  assert.equal(elapsedSecondsToMinutes(0), 0);
  assert.equal(elapsedSecondsToMinutes(61), 2);
});

test('all durable skip reasons have concise Portuguese labels', () => {
  assert.deepEqual(skipReasonChoices, [
    { value: 'lack_of_time', label: 'Faltou tempo' },
    { value: 'fatigue', label: 'Cansaço' },
    { value: 'wrong_material', label: 'Material errado' },
    { value: 'blocked_prerequisite', label: 'Pré-requisito pendente' },
    { value: 'too_difficult', label: 'Difícil demais' },
    { value: 'other', label: 'Outro motivo' },
  ]);
});
