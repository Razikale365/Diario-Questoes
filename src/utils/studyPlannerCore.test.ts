import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudyDayPlan,
  DEFAULT_STUDY_TARGET_PROFILES,
  formatStudyCoverageTable,
  materializeStudyBlocksAsPlannerTasks,
  parseStudyCoverageTable,
  seedCoverageForTarget,
  type StudyCoverageRow,
} from './studyPlannerCore';

test('seedCoverageForTarget creates BACEN rows without leaking RFB-specific topics', () => {
  const bacen = seedCoverageForTarget('bacen_economia_financas');

  assert.ok(DEFAULT_STUDY_TARGET_PROFILES.some((target) => target.slug === 'bacen_economia_financas'));
  assert.ok(bacen.some((row) => row.discipline === 'Economia' && row.topic === 'Macroeconomia'));
  assert.ok(bacen.some((row) => row.targetSlug === 'shared' && row.discipline === 'Português'));
  assert.equal(bacen.some((row) => row.discipline === 'Direito Tributário'), false);
});

test('buildStudyDayPlan generates a BACEN four-block day from manual coverage without LS', () => {
  const plan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows: seedCoverageForTarget('bacen_economia_financas'),
    feedbackRows: [],
    sourceItems: [],
  });

  assert.equal(plan.blocks.length, 4);
  assert.deepEqual(plan.blocks.map((block) => block.kind), ['theory', 'questions', 'questions', 'review']);
  assert.equal(plan.blocks.some((block) => block.discipline === 'Direito Tributário'), false);
  assert.ok(plan.scoreboard.every((row) => row.targetSlug === 'bacen_economia_financas'));
});

test('buildStudyDayPlan keeps subject balance to at most two blocks per discipline', () => {
  const coverageRows: StudyCoverageRow[] = [
    ...['Macroeconomia', 'Microeconomia', 'Econometria', 'Economia Monetária'].map((topic) => ({
      targetSlug: 'bacen_economia_financas' as const,
      discipline: 'Economia',
      topic,
      status: 'unread' as const,
      editalWeight: 2,
      incidence: 10,
      tier: 1,
      materialHint: 'Questões CEBRASPE',
    })),
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Sistema Financeiro',
      topic: 'Sistema Financeiro Nacional',
      status: 'weak',
      editalWeight: 1.5,
      incidence: 8,
      tier: 1,
      materialHint: 'Questões CEBRASPE',
    },
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Estatística',
      topic: 'Probabilidade',
      status: 'weak',
      editalWeight: 1.5,
      incidence: 7,
      tier: 2,
      materialHint: 'Questões CEBRASPE',
    },
  ];

  const plan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows,
    feedbackRows: [],
    sourceItems: [],
  });

  const counts = plan.blocks.reduce<Record<string, number>>((acc, block) => {
    acc[block.discipline] = (acc[block.discipline] || 0) + 1;
    return acc;
  }, {});

  assert.ok(Math.max(...Object.values(counts)) <= 2);
});

test('pos-edital scoring honors edital weight without losing weakness priority', () => {
  const plan = buildStudyDayPlan({
    targetSlug: 'sefaz_ce',
    phase: 'pos_edital',
    coverageRows: [
      {
        targetSlug: 'sefaz_ce',
        discipline: 'Finanças Públicas',
        topic: 'Orçamento Público',
        status: 'stale',
        editalWeight: 2,
        incidence: 8,
        tier: 2,
        materialHint: 'LS/trilha',
      },
      {
        targetSlug: 'sefaz_ce',
        discipline: 'Administração',
        topic: 'Protocolo',
        status: 'stale',
        editalWeight: 1,
        incidence: 8,
        tier: 2,
        materialHint: 'LS/trilha',
      },
    ],
    feedbackRows: [
      { discipline: 'Finanças Públicas', topic: 'Orçamento Público', weaknessScore: 8 },
      { discipline: 'Administração', topic: 'Protocolo', weaknessScore: 8 },
    ],
    sourceItems: [],
  });

  const scoreboard = new Map(plan.scoreboard.map((row) => [`${row.discipline}:${row.topic}:${row.kind}`, row]));
  assert.ok(
    scoreboard.get('Finanças Públicas:Orçamento Público:questions')!.finalScore >
      scoreboard.get('Administração:Protocolo:questions')!.finalScore,
  );
});

test('low-trust Dicas/Bizus candidates lose to course material and cannot be primary-only', () => {
  const plan = buildStudyDayPlan({
    targetSlug: 'rfb_auditor',
    phase: 'pre_edital',
    coverageRows: [
      {
        targetSlug: 'rfb_auditor',
        discipline: 'Direito Tributário',
        topic: 'Crédito Tributário',
        status: 'weak',
        editalWeight: 2,
        incidence: 10,
        tier: 1,
        materialHint: 'Dicas e Bizus',
      },
      {
        targetSlug: 'rfb_auditor',
        discipline: 'Direito Tributário',
        topic: 'Crédito Tributário',
        status: 'weak',
        editalWeight: 2,
        incidence: 10,
        tier: 1,
        materialHint: 'PDF Completo',
      },
      {
        targetSlug: 'rfb_auditor',
        discipline: 'Contabilidade',
        topic: 'Demonstrações Contábeis',
        status: 'weak',
        editalWeight: 1.5,
        incidence: 8,
        tier: 1,
        materialHint: 'PDF Completo',
      },
    ],
    feedbackRows: [],
    sourceItems: [],
  });

  assert.equal(plan.blocks.some((block) => block.materialHint === 'Dicas e Bizus'), false);
  assert.ok(
    plan.scoreboard.some(
      (row) => row.materialHint === 'Dicas e Bizus' && row.lowTrustPenalty > 0 && !row.chosen,
    ),
  );
});

test('parseStudyCoverageTable and materializeStudyBlocksAsPlannerTasks bridge into current PlannerTask substrate', () => {
  const rows = parseStudyCoverageTable(`
target | discipline | topic | status | edital_weight | incidence | material_hint
bacen_economia_financas | Economia | Macroeconomia | unread | 2 | 9 | Questões CEBRASPE
shared | Português | Interpretação de textos | stale | 1 | 6 | Curso base
`);
  const plan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows: rows,
    feedbackRows: [],
    sourceItems: [],
  });
  const tasks = materializeStudyBlocksAsPlannerTasks(plan.blocks, {
    planejamento: 'Planner BACEN',
    scheduledDate: '2026-07-08',
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].targetSlug, 'bacen_economia_financas');
  assert.equal(tasks.length, plan.blocks.length);
  assert.equal(tasks[0].source, 'generated');
  assert.equal(tasks[0].scheduledDate, '2026-07-08');
  assert.match(tasks[0].description, /Macroeconomia|Interpretação/);
});

test('formatStudyCoverageTable round-trips editable manual target coverage rows', () => {
  const seed = seedCoverageForTarget('bacen_economia_financas').slice(0, 2);
  const formatted = formatStudyCoverageTable(seed);
  const parsed = parseStudyCoverageTable(formatted);

  assert.match(formatted.split('\n')[0], /target \| discipline \| topic/);
  assert.deepEqual(parsed, seed.map((row) => ({ ...row, materialSource: '', notes: '' })));
});
