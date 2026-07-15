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
});

test('command center mounts the calendar before the daily execution surface', () => {
  const source = readFileSync(commandCenterUrl, 'utf8');
  const calendar = source.indexOf('<SprintCalendarPanel');
  const dailySurface = source.indexOf('<section className="overflow-hidden');

  assert.ok(calendar > 0);
  assert.ok(dailySurface > calendar);
  assert.equal(source.includes('const calendarStartDate = isoToday()'), true);
  assert.equal(source.includes('startDate={calendarStartDate}'), true);
});
