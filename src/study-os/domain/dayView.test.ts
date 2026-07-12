import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlannerBlock, PlannerRun } from '../api/planner';
import { buildBlockView, buildShortfallGuidance } from './dayView';


const scoreBreakdown = {
  weakness: 9000,
  incidence: 9200,
  tier: 10000,
  coverageNeed: 7000,
  reviewDebt: 7000,
  lsAlignment: 0,
  targetFit: 10000,
  overlapValue: 10000,
  deadlinePressure: 0,
  bancaFit: 9500,
  editalWeight: 2000,
  balancePenalty: 0,
  lowTrustPenalty: 0,
  finalScore: 98500,
} as const;

const block = {
  id: 41,
  runId: 21,
  candidateId: 31,
  targetSlug: 'bacen_economia_financas',
  date: '2026-07-13',
  position: 1,
  blockKind: 'theory',
  title: 'Ler ou reler: Macroeconomia - Politica monetaria',
  durationMinutes: 60,
  plannedQuestions: 0,
  state: 'pending',
  executionSessionId: null,
  questionsDone: 0,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  favoriteCount: 0,
  version: 1,
  discipline: 'Macroeconomia',
  topic: 'Politica monetaria',
  sourceKind: 'course',
  lessonId: 7,
  materialId: 13,
  scoreBreakdown,
  evidence: {
    candidateEvidence: {
      coverageStatus: 'weak',
      transferConfidence: 100,
      materialTrust: 10,
      tecSourceUrl: 'https://www.tecconcursos.com.br/questoes/cadernos',
    },
  },
} as unknown as PlannerBlock;

test('block view names the execution command and concise reason', () => {
  const view = buildBlockView(block);

  assert.equal(view.kindLabel, 'Teoria');
  assert.equal(view.commandLabel, 'Abrir leitura');
  assert.equal(view.statusLabel, 'Pendente');
  assert.match(view.whyNow, /fraqueza/i);
  assert.match(view.whyNow, /incidência/i);
  assert.equal(view.sourceLabel, 'Curso original');
});

test('TEC and review blocks expose bounded external commands', () => {
  const questions = buildBlockView({
    ...block,
    blockKind: 'questions',
    sourceKind: 'tec',
    plannedQuestions: 20,
  });
  const review = buildBlockView({
    ...block,
    blockKind: 'review',
    sourceKind: 'tec',
    plannedQuestions: 7,
  });

  assert.equal(questions.commandLabel, 'Abrir TEC');
  assert.equal(questions.kindLabel, 'Questões');
  assert.equal(review.commandLabel, 'Corrigir e provar');
  assert.match(review.whyNow, /revisão/i);
});

test('shortfall guidance preserves each backend reason without filler', () => {
  const run = {
    status: 'shortfall',
    shortfallCount: 2,
    shortfallReasons: [
      'no executable theory candidate',
      'no executable review candidate',
    ],
  } as PlannerRun;

  assert.deepEqual(buildShortfallGuidance(run), [
    'Vincule uma aula e um PDF original disponível a pelo menos um tópico.',
    'Registre erros, dúvidas, favoritos ou dívida de revisão em um tópico.',
  ]);
});
