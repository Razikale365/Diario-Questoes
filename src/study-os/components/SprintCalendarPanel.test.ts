import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';


const panelUrl = new URL('./SprintCalendarPanel.tsx', import.meta.url);
const commandCenterUrl = new URL('./SprintCommandCenter.tsx', import.meta.url);


test('calendar panel exposes the preview/apply flow and precision legend', () => {
  const source = readFileSync(panelUrl, 'utf8');

  for (const label of [
    'Auto-organizar',
    'Aplicar organização',
    'Exato',
    'Provisório',
    'Protegido',
    'Capacidade reservada',
  ]) {
    assert.equal(source.includes(label), true, `${label} must remain visible`);
  }
  assert.equal(source.includes('aria-label="Horizonte do Sprint"'), true);
  assert.equal(source.includes('controller.abort()'), true);
  assert.equal(source.includes('fetchSprintCalendarHead'), true);
  assert.equal(source.includes('Avisos do motor'), true);
  assert.equal(source.includes('document.run.shortfalls'), true);
  assert.equal(source.includes('mutationControllerRef'), true);
  assert.equal(source.includes('controller.signal'), true);
  assert.equal(source.includes('aria-label={`Prioridade ${priorityLabel[day.hottestPriority]}`}'), true);
  assert.equal(source.includes('<article'), true);
  assert.equal(source.includes('STUDY_OS_DATA_CHANGED'), true);
  assert.equal(source.includes('parseStudyOsDataChangedDetail'), true);
  assert.equal(source.includes("detail.targetSlug !== targetSlug"), true);
  assert.equal(source.includes("detail.resources.includes('calendar')"), true);
  assert.equal(source.includes('window.removeEventListener(STUDY_OS_DATA_CHANGED'), true);
});

test('Planner owns the shared calendar while the command center consumes the day projection', () => {
  const source = readFileSync(commandCenterUrl, 'utf8');

  assert.equal(source.includes('<SprintCalendarPanel'), false);
});
