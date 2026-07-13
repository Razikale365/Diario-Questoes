import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plannerAreaPath = new URL('../../components/PlannerArea.tsx', import.meta.url);
const plannerAreaSource = readFileSync(plannerAreaPath, 'utf8');

test('PlannerArea delegates Study OS ownership to the local service', () => {
  const retiredBrowserKeys = [
    'study_os_target_v1',
    'study_os_phase_v1',
    'study_os_coverage_table_v1',
    'study_os_target_profiles_v1',
    'study_os_source_signals_v1',
  ];

  for (const key of retiredBrowserKeys) {
    assert.equal(plannerAreaSource.includes(key), false, `${key} must not remain in PlannerArea`);
  }

  assert.equal(
    plannerAreaSource.includes('StudyOSPlannerPanel'),
    false,
    'the duplicate browser planner must not remain mounted or defined',
  );
});
