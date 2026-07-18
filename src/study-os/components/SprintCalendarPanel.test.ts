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
  assert.equal(source.includes('Avisos do motor'), true);
  assert.equal(source.includes('document.run.shortfalls'), true);
  assert.equal(source.includes('aria-label={`Prioridade ${priorityLabel[day.hottestPriority]}`}'), true);
  assert.equal(source.includes('<article'), true);
  assert.equal(source.includes('onClick={() => void createPreview(true)}'), true, 'visible auto-organize must fetch the applied head');
  const applyPreview = source.slice(source.indexOf('const applyPreview = async'), source.indexOf('\n  return ('));
  assert.equal(applyPreview.includes('requestGateRef.current!.begin(controller.signal)'), true, 'apply must invalidate and gate pre-apply heads');
});

test('Planner owns the shared calendar while the command center consumes the day projection', () => {
  const source = readFileSync(commandCenterUrl, 'utf8');

  assert.equal(source.includes('<SprintCalendarPanel'), false);
});

test('cycle hydration that changes the horizon end always replaces an invalidated head load', () => {
  const source = readFileSync(panelUrl, 'utf8');
  const load = source.slice(
    source.indexOf('const load = useCallback'),
    source.indexOf('\n\n  useEffect(() => {', source.indexOf('const load = useCallback')),
  );

  assert.match(load, /\}, \[endDate, startDate, targetSlug\]\);/);
});
