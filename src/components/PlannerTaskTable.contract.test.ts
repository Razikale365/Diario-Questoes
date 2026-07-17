import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./PlannerArea.tsx', import.meta.url), 'utf8');

test('planner task tables share configurable data columns while actions stay fixed', () => {
  for (const token of [
    'PLANNER_TASK_TABLE_PREFERENCES_KEY',
    'DEFAULT_PLANNER_TASK_COLUMNS',
    'DndContext',
    'SortableContext',
    'horizontalListSortingStrategy',
    'nextPlannerTaskSort',
    'sortPlannerTasks',
    'movePlannerTaskColumn',
    'setPlannerTaskColumnHidden',
    'Colunas',
    'Restaurar padrão',
  ]) {
    assert.ok(source.includes(token), `expected ${token} in PlannerArea`);
  }

  assert.match(source, /type="checkbox"/);
  assert.match(source, /sticky top-0 right-0/);
  assert.match(source, /sticky right-0/);
  assert.doesNotMatch(source, /movePlannerTaskColumn\([^)]*['"]actions/);
  assert.doesNotMatch(source, /setPlannerTaskColumnHidden\([^)]*['"]actions/);
});

test('task table preference storage failures cannot block PlannerArea rendering', () => {
  assert.match(
    source,
    /const loadPlannerTaskTablePreferences = \(\).*?try \{.*?localStorage\.getItem\(PLANNER_TASK_TABLE_PREFERENCES_KEY\).*?\} catch \{.*?parsePlannerTaskTablePreferences\(null\).*?\}/s,
  );
  assert.match(
    source,
    /const persistPlannerTaskTablePreferences = \(preferences: PlannerTaskTablePreferences\).*?try \{.*?localStorage\.setItem\(PLANNER_TASK_TABLE_PREFERENCES_KEY, JSON\.stringify\(preferences\)\).*?\} catch.*?console\.(?:warn|error).*?\}/s,
  );
  assert.doesNotMatch(
    source,
    /useState<PlannerTaskTablePreferences>\(\(\) =>\s*parsePlannerTaskTablePreferences\(localStorage\.getItem/,
  );
});
