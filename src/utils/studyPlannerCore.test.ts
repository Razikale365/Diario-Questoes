import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTargetDecisionRows,
  buildStudyDayPlan,
  buildStudyWeekPlan,
  DEFAULT_STUDY_TARGET_PROFILES,
  formatStudyCoverageTable,
  formatStudySourceTable,
  formatStudyTargetProfileTable,
  materializeStudyBlocksAsPlannerTasks,
  materializeStudyWeekAsPlannerTasks,
  parseStudyCoverageTable,
  parseStudySourceTable,
  parseStudyTargetProfileTable,
  seedSourceSignalsForTarget,
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

test('formatStudyTargetProfileTable round-trips editable target profiles', () => {
  const seed = DEFAULT_STUDY_TARGET_PROFILES.slice(0, 2).map((target, index) => ({
    ...target,
    active: index === 1,
    priorityScore: index === 1 ? 92 : target.priorityScore,
    sourceUrls: ['https://example.com/edital'],
  }));

  const formatted = formatStudyTargetProfileTable(seed);
  const parsed = parseStudyTargetProfileTable(formatted);

  assert.match(formatted.split('\n')[0], /slug \| name \| institution/);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].slug, 'rfb_auditor');
  assert.equal(parsed[1].active, true);
  assert.equal(parsed[1].priorityScore, 92);
  assert.deepEqual(parsed[1].sourceUrls, ['https://example.com/edital']);
});

test('buildTargetDecisionRows ranks targets from editable profile and current coverage signals', () => {
  const profiles = parseStudyTargetProfileTable(`
slug | name | institution | role | organizer | phase | priority | cost_benefit | banca_fit | course | ls | active | vagas | notes | urls
bacen_economia_financas | BACEN Economia | BCB | Analista | CEBRASPE | pre_edital | 88 | 10 | 9 | yes | no | yes | 50 vagas | edital recente | https://www.bcb.gov.br
rfb_auditor | RFB Auditor | Receita Federal | Auditor | FGV | pre_edital | 72 | 6 | 7 | no | yes | no | 230 vagas | fiscal clássico | https://www.gov.br/receitafederal
sefaz_ce | SEFAZ CE | SEFAZ CE | Auditor | CEBRASPE | pos_edital | 70 | 5 | 8 | yes | yes | no | edital aberto | pós-edital |
`);
  const rows = buildTargetDecisionRows({
    targetProfiles: profiles,
    coverageRows: [
      ...seedCoverageForTarget('bacen_economia_financas'),
      ...seedCoverageForTarget('sefaz_ce'),
    ],
    feedbackRows: [
      { discipline: 'Economia', topic: 'Macroeconomia', weaknessScore: 7 },
      { discipline: 'Direito Tributário', topic: 'ICMS', weaknessScore: 8 },
    ],
    sourceItems: [
      { id: 'ls-1', sourceKind: 'ls', targetSlug: 'sefaz_ce', discipline: 'Direito Tributário', topic: 'ICMS', sourceTrust: 9 },
    ],
    activeTargetSlug: 'bacen_economia_financas',
  });

  assert.equal(rows[0].targetSlug, 'bacen_economia_financas');
  assert.ok(rows[0].recommendationScore > rows.find((row) => row.targetSlug === 'rfb_auditor')!.recommendationScore);
  assert.ok(rows.find((row) => row.targetSlug === 'sefaz_ce')!.lsAvailability > rows[0].lsAvailability);
  assert.ok(rows[0].coverageRows > 0);
  assert.ok(rows[0].reasons.some((reason) => /custo-beneficio/i.test(reason)));
});

test('formatStudySourceTable round-trips editable LS replacement source signals', () => {
  const formatted = formatStudySourceTable([
    {
      id: 'tec-macro',
      sourceKind: 'tec_incidence',
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      incidence: 9,
      editalWeight: 2,
      priorityHint: 95,
      sourceTrust: 9,
      sourceOrder: 2,
      lesson: 'TEC CEBRASPE',
      taskText: 'Mais cai em macroeconomia',
    },
  ]);
  const parsed = parseStudySourceTable(formatted);

  assert.match(formatted.split('\n')[0], /kind \| target \| discipline/);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sourceKind, 'tec_incidence');
  assert.equal(parsed[0].targetSlug, 'bacen_economia_financas');
  assert.equal(parsed[0].incidence, 9);
  assert.equal(parsed[0].priorityHint, 95);
  assert.equal(parsed[0].sourceTrust, 9);
  assert.equal(parsed[0].sourceOrder, 2);
  assert.equal(parsed[0].lesson, 'TEC CEBRASPE');
});

test('buildStudyDayPlan can generate a four-block day from source signals without LS coverage', () => {
  const sourceItems = parseStudySourceTable(`
kind | target | discipline | topic | incidence | edital_weight | priority | trust | order | hint | text
estrategia_aulas | bacen_economia_financas | Economia | Macroeconomia | 8 | 2 | 90 | 8 | 1 | Aula Estratégia | ordem do curso
tec_incidence | bacen_economia_financas | Economia | Microeconomia | 10 | 2 | 98 | 9 | 2 | TEC CEBRASPE | mais cai
tec_incidence | bacen_economia_financas | Sistema Financeiro | SFN | 9 | 1.5 | 96 | 9 | 3 | TEC CEBRASPE | mais cai
guia_andrety | bacen_economia_financas | Estatística | Probabilidade | 7 | 1.5 | 82 | 7 | 4 | Guia Andrety | revisão dirigida
`);

  const plan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows: [],
    feedbackRows: [],
    sourceItems,
  });

  assert.equal(plan.blocks.length, 4);
  assert.deepEqual(plan.blocks.map((block) => block.kind), ['theory', 'questions', 'questions', 'review']);
  assert.ok(plan.blocks.some((block) => /Microeconomia|SFN/.test(block.topic)));
  assert.ok(plan.scoreboard.some((row) => row.materialHint.includes('TEC CEBRASPE') && row.incidence > 0));
});

test('seedSourceSignalsForTarget gives editable defaults for BACEN external planning sources', () => {
  const seed = seedSourceSignalsForTarget('bacen_economia_financas');

  assert.ok(seed.some((item) => item.sourceKind === 'tec_incidence'));
  assert.ok(seed.some((item) => item.sourceKind === 'estrategia_aulas'));
  assert.ok(seed.every((item) => item.targetSlug === 'bacen_economia_financas' || item.targetSlug === 'shared'));
});

test('buildStudyWeekPlan creates a weekday shell without reusing the same scored candidate', () => {
  const coverageRows: StudyCoverageRow[] = Array.from({ length: 10 }, (_, index) => ({
    targetSlug: 'bacen_economia_financas',
    discipline: index < 4 ? 'Economia' : index < 7 ? 'Sistema Financeiro' : 'Estatística',
    topic: `Tema estratégico ${index + 1}`,
    status: index % 3 === 0 ? 'weak' : 'unread',
    editalWeight: index < 4 ? 2 : 1.5,
    incidence: 10 - (index % 4),
    tier: index < 7 ? 1 : 2,
    materialHint: 'Questões CEBRASPE',
  }));

  const week = buildStudyWeekPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    startDate: '2026-07-06',
    days: 5,
    coverageRows,
    feedbackRows: [],
    sourceItems: [],
  });

  const blocks = week.days.flatMap((day) => day.blocks);
  const uniqueBlockIds = new Set(blocks.map((block) => block.id));

  assert.deepEqual(
    week.days.map((day) => day.date),
    ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'],
  );
  assert.equal(blocks.length, 20);
  assert.equal(uniqueBlockIds.size, blocks.length);
  assert.ok(week.scoreboard.length >= blocks.length);
});

test('materializeStudyWeekAsPlannerTasks schedules each generated block on its day', () => {
  const week = buildStudyWeekPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    startDate: '2026-07-06',
    days: 2,
    coverageRows: seedCoverageForTarget('bacen_economia_financas'),
    feedbackRows: [],
    sourceItems: [],
  });

  const tasks = materializeStudyWeekAsPlannerTasks(week, {
    planejamento: 'Study OS - BACEN',
    metaNumber: 12,
  });

  assert.equal(tasks.length, 8);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
  assert.deepEqual(tasks.slice(0, 4).map((task) => task.scheduledDate), ['2026-07-06', '2026-07-06', '2026-07-06', '2026-07-06']);
  assert.deepEqual(tasks.slice(4).map((task) => task.scheduledDate), ['2026-07-07', '2026-07-07', '2026-07-07', '2026-07-07']);
  assert.deepEqual(tasks.map((task) => task.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(tasks.every((task) => task.source === 'generated' && task.planejamento === 'Study OS - BACEN'));
});

test('materializeStudyWeekAsPlannerTasks keeps ids unique when daily materialization happens in the same millisecond', () => {
  const originalNow = Date.now;
  Date.now = () => 123;

  try {
    const week = buildStudyWeekPlan({
      targetSlug: 'bacen_economia_financas',
      phase: 'pre_edital',
      startDate: '2026-07-06',
      days: 2,
      coverageRows: Array.from({ length: 8 }, (_, index) => ({
        targetSlug: 'bacen_economia_financas',
        discipline: 'Economia',
        topic: `Tema ${index + 1}`,
        status: 'weak',
        editalWeight: 2,
        incidence: 9,
        tier: 1,
        materialHint: 'Questões CEBRASPE',
      })),
      feedbackRows: [],
      sourceItems: [],
    });

    const tasks = materializeStudyWeekAsPlannerTasks(week, {
      planejamento: 'Study OS - BACEN',
    });

    assert.equal(tasks.length, 8);
    assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
  } finally {
    Date.now = originalNow;
  }
});
