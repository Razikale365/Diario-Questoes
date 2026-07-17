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

test('Planner result persistence is service-owned before it asks Calendar to organize', () => {
  const source = readFileSync(plannerAreaPath, 'utf8');

  assert.equal(source.includes('recordSourceTaskExecution'), true);
  assert.equal(source.includes('announceStudyOsDataChanged'), true);
  assert.equal(source.includes("'source-plan', 'sprint-day', 'calendar', 'evidence'"), true);
  const applyTaskResult = source.slice(source.indexOf('const applyTaskResult = async'), source.indexOf('const copyPlannerTaskChatPrompt'));
  assert.ok(
    applyTaskResult.indexOf('await recordSourceTaskExecution') < applyTaskResult.indexOf('startCalendarAutoOrganize()'),
    'the durable execution must finish before the Calendar preview starts',
  );
  assert.equal(source.includes('sourcePlanTaskId'), true);
  assert.equal(source.includes('TaskResultDraft'), false, 'the temporary result adapter must be removed');
});
