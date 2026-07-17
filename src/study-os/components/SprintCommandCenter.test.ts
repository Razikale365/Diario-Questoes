import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SprintAction } from '../api/sprint';
import { defaultSprintResult, sprintDecisionState } from './SprintCommandCenter';

const componentUrl = new URL('./SprintCommandCenter.tsx', import.meta.url);
const plannerAreaUrl = new URL('../../components/PlannerArea.tsx', import.meta.url);
const cutoverUrl = new URL('./CutoverStatus.tsx', import.meta.url);
const appUrl = new URL('../../App.tsx', import.meta.url);

test('sprint command center keeps the tactical workflow visible and score details secondary', () => {
  const source = readFileSync(componentUrl, 'utf8');

  for (const label of [
    'dias para a P1',
    'Projeção P1',
    'Projeção P2',
    'Minutos LS',
    'Minutos extras',
    '204/240',
    '85%',
    'equivalente bruto',
    'não é a nota padronizada da FCC',
    'Confiança',
    'Fragilidade',
    'Ciclo vigente',
    'Backlog da meta encerrada',
    'Origem dominante',
    'Usar override manual',
    'Dia mínimo viável',
    'Por que agora',
    'Detalhes do score',
    'Executar',
    'Comprimir',
    'Adiar',
  ]) {
    assert.equal(source.includes(label), true, `${label} must remain in the command center`);
  }
  assert.equal(source.includes('recordSourceTaskExecution'), true);
  assert.equal(source.includes('refreshSprintDay'), true);
  assert.equal(source.includes('useState(42)'), false);
  assert.equal(source.includes('useState(55)'), false);
  assert.equal(source.includes('fetchSprintProjection'), true);
  assert.equal(source.includes('fetchSprintTrajectory'), true);
  assert.equal(source.includes('fetchSprintEvidence'), true);
  assert.equal(source.includes('<details'), true);
});

test('PlannerArea mounts the SEFAZ sprint first and persists imported LS tasks', () => {
  const source = readFileSync(plannerAreaUrl, 'utf8');

  assert.equal(source.includes('<SprintCommandCenter'), true);
  assert.equal(source.includes('importSourcePlan'), true);
  assert.equal(source.includes('fetchSourcePlanTasks'), true);
  assert.equal(source.includes('plannerTaskFromSourcePlan'), true);
  assert.equal(source.indexOf('<SprintCommandCenter'), source.indexOf('<AutonomousDay') > -1
    ? Math.min(source.indexOf('<SprintCommandCenter'), source.indexOf('<AutonomousDay'))
    : source.indexOf('<SprintCommandCenter'));
});

test('PlannerArea source-plan restore remains safe under React Strict Mode remounts', () => {
  const source = readFileSync(plannerAreaUrl, 'utf8');

  assert.equal(source.includes('lastSourceHydration'), false);
  assert.equal(source.includes('const controller = new AbortController()'), true);
  assert.equal(source.includes('fetchSourcePlanTasks(studyOsTarget, undefined, controller.signal)'), true);
  assert.equal(source.includes('return () => controller.abort()'), true);
  assert.equal(source.includes('hydratedSourcePlanTarget !== studyOsTarget'), true);
  assert.equal(source.includes('setHydratedSourcePlanTarget(null)'), true);
});

test('App keeps the planner toast callback stable across renders', () => {
  const source = readFileSync(appUrl, 'utf8');

  assert.match(source, /const showToast = useCallback\(\(message: string\) => \{/);
  assert.match(source, /setTimeout\(\(\) => setToastMessage\(null\), 3000\);\s*\}, \[\]\);/);
});

test('mobile command center removes administrative height before the study queue', () => {
  const component = readFileSync(componentUrl, 'utf8');
  const planner = readFileSync(plannerAreaUrl, 'utf8');
  const cutover = readFileSync(cutoverUrl, 'utf8');

  assert.equal(component.includes('grid-cols-2'), true);
  assert.equal(component.includes('col-span-2'), true);
  assert.equal(planner.includes('hidden sm:flex'), true);
  assert.match(cutover, /className="hidden[^"]*sm:inline"/);
  assert.match(cutover, /className="hidden[^"]*sm:flex"/);
});

test('execution defaults do not invent zero-percent question evidence', () => {
  const action = {
    durationMinutes: 60,
    plannedQuestions: 15,
  } as SprintAction;

  assert.deepEqual(defaultSprintResult(action, 3), {
    state: 'completed',
    actualMinutes: 60,
    questionsDone: 0,
    correctCount: 0,
    wrongCount: 0,
    doubtCount: 0,
    energyAfter: 3,
  });
  assert.equal(sprintDecisionState(false, false), 'skipped');
  assert.equal(sprintDecisionState(true, false), 'active');
  assert.equal(sprintDecisionState(true, true), 'skipped');
});

test('a saved result is retained locally when the day refresh fails', () => {
  const source = readFileSync(componentUrl, 'utf8');

  assert.equal(source.includes('const saved = await recordSourceTaskExecution'), true);
  assert.equal(source.includes('item.id === saved.sprintAction?.id ? { ...item, ...saved.sprintAction } : item'), true);
  assert.equal(source.includes('const refreshed = await createDay(true, false)'), true);
  assert.equal(source.includes("refreshed\n        ? 'Resultado salvo e restante do dia recalculado.'\n        : 'Resultado salvo; recálculo pendente.'"), true);
});

test('IA Hoje uses the shared execution receipt and reloads only matching Study OS events', () => {
  const source = readFileSync(componentUrl, 'utf8');

  assert.equal(source.includes('TaskExecutionFields'), true);
  assert.equal(source.includes('STUDY_OS_DATA_CHANGED'), true);
  assert.equal(source.includes('parseStudyOsDataChangedDetail'), true);
  assert.equal(source.includes("detail.targetSlug !== targetSlug"), true);
  assert.equal(source.includes("detail.resources.includes('sprint-day')"), true);
  assert.equal(source.includes('window.removeEventListener(STUDY_OS_DATA_CHANGED'), true);
  assert.equal(source.includes('sprintActionId: action.id'), true);
  assert.equal(source.includes('expectedVersion: action.version'), true);
});

test('generation, recalculation, and saved results refresh audit state in parallel', () => {
  const source = readFileSync(componentUrl, 'utf8');
  const auditRefresh = source.match(
    /const refreshAuditState = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[targetSlug\]\);/,
  );

  assert.ok(auditRefresh, 'the command center must expose a focused audit refresh');
  for (const contract of [
    'Promise.all([',
    'fetchSprintTrajectory(targetSlug)',
    'fetchSprintEvidence(targetSlug)',
    'fetchSourcePlanTasks(targetSlug, undefined, true)',
    'setTrajectory(nextTrajectory)',
    'setEvidence(nextEvidence)',
    'setSourceTasks(nextSourceTasks.items)',
  ]) {
    assert.equal(auditRefresh[1].includes(contract), true, `${contract} must remain in the audit refresh`);
  }

  const createDay = source.slice(source.indexOf('const createDay = async'), source.indexOf('const confirmAction = async'));
  assert.equal(createDay.includes('await refreshAuditState()'), true);

  const submitResult = source.slice(source.indexOf('const submitResult = async'), source.indexOf('const copyPrompt = async'));
  assert.equal(submitResult.includes('await createDay(true, false)'), true);
});
