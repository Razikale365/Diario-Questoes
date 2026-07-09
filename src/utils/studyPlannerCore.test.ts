import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudyBaselineComparison,
  buildTargetDecisionRows,
  buildStudyDayPlan,
  buildStudyRefreshPlan,
  buildStudyWeekPlan,
  DEFAULT_STUDY_TARGET_PROFILES,
  formatStudyCoverageTable,
  formatStudySourceTable,
  formatStudyTargetProfileTable,
  extractStudySourceCandidatesFromText,
  inferStudySourceSignalsFromText,
  isQuestionBankItemRelevantToStudyTarget,
  isPlannerTaskRelevantToStudyTarget,
  materializeStudyBlocksAsPlannerTasks,
  materializeStudyWeekAsPlannerTasks,
  mergeStudyCoverageWithTargetSeed,
  mergeStudySourceItemsWithTargetSeed,
  parseStudyCoverageTable,
  parseStudySourceTable,
  parseStudyTargetProfileTable,
  seedSourceSignalsForTarget,
  seedCoverageForTarget,
  studySourceItemsFromPlannerTasks,
  updateStudyCoverageStatus,
  updateStudyCoverageFromPlannerTask,
  type StudyCoverageRow,
} from './studyPlannerCore';
import type { PlannerTask } from '../types';

const makePlannerTask = (overrides: Partial<PlannerTask> = {}): PlannerTask => ({
  id: crypto.randomUUID(),
  number: 1,
  discipline: 'Economia',
  format: 'Teoria',
  description: 'Macroeconomia',
  spentMinutes: 0,
  estimatedMinutes: 60,
  performance: null,
  status: 'pending',
  relevance: 7,
  durationMinutes: 60,
  source: 'manual',
  createdAt: '2026-07-09T12:00:00.000Z',
  updatedAt: '2026-07-09T12:00:00.000Z',
  ...overrides,
});

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
  assert.equal(tasks[0].plannerSourceKind, 'generated_planner');
  assert.equal(tasks[0].targetSlug, 'bacen_economia_financas');
  assert.equal(tasks[0].plannedBlockKind, plan.blocks[0].kind);
  assert.equal(tasks[0].plannedQuestions, plan.blocks[0].plannedQuestions);
  assert.equal(tasks[0].materialHint, plan.blocks[0].materialHint);
  assert.deepEqual(tasks[0].sourceReason, plan.blocks[0].sourceReason);
  assert.equal(tasks[0].scoreBreakdown?.finalScore, plan.blocks[0].scoreBreakdown.finalScore);
  assert.equal(tasks[0].scheduledDate, '2026-07-08');
  assert.match(tasks[0].description, /Macroeconomia|Interpretação/);
});

test('studySourceItemsFromPlannerTasks excludes generated planner output from the next source pool', () => {
  const sourceItems = studySourceItemsFromPlannerTasks([
    makePlannerTask({
      id: 'generated-block',
      source: 'generated',
      plannerSourceKind: 'generated_planner',
      targetSlug: 'bacen_economia_financas',
      description: 'Política monetária',
    }),
    makePlannerTask({
      id: 'legacy-generated-block',
      source: 'generated',
      description: 'Sistema Financeiro Nacional',
    }),
  ], 'bacen_economia_financas');

  assert.deepEqual(sourceItems, []);
});

test('studySourceItemsFromPlannerTasks retains LS, trilha, and manual imported inputs', () => {
  const sourceItems = studySourceItemsFromPlannerTasks([
    makePlannerTask({
      id: 'ls-input',
      source: 'ls-meta-pdf',
      plannerSourceKind: 'ls',
      description: 'Crédito tributário',
    }),
    makePlannerTask({
      id: 'trilha-input',
      source: 'manual',
      plannerSourceKind: 'trilha_estrategica',
      discipline: 'Contabilidade',
      description: 'Demonstrações contábeis',
    }),
    makePlannerTask({
      id: 'manual-input',
      source: 'manual',
      plannerSourceKind: 'manual',
      discipline: 'Estatística',
      description: 'Probabilidade',
    }),
  ], 'rfb_auditor');

  assert.deepEqual(sourceItems.map((item) => [item.id, item.sourceKind, item.targetSlug]), [
    ['ls-input', 'ls', 'legacy'],
    ['trilha-input', 'trilha_estrategica', 'legacy'],
    ['manual-input', 'manual', 'shared'],
  ]);
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

test('inferStudySourceSignalsFromText converts TEC incidence paste into source rows', () => {
  const rows = inferStudySourceSignalsFromText(
    `
TEC mais cai
Economia - Macroeconomia - incidencia 9 - peso 2 - prioridade 96
Sistema Financeiro: SFN incidencia 8 peso 1.5
`,
    { targetSlug: 'bacen_economia_financas', sourceKind: 'tec_incidence' },
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceKind, 'tec_incidence');
  assert.equal(rows[0].discipline, 'Economia');
  assert.equal(rows[0].topic, 'Macroeconomia');
  assert.equal(rows[0].incidence, 9);
  assert.equal(rows[0].editalWeight, 2);
  assert.equal(rows[0].priorityHint, 96);
  assert.equal(rows[0].sourceTrust, 9);
});

test('inferStudySourceSignalsFromText detects Estratégia aula order and Andréty review hints', () => {
  const rows = inferStudySourceSignalsFromText(
    `
Aula 03 - Direito Tributário - Crédito Tributário
Aula 04: Contabilidade > Demonstrações Contábeis
Andrety revisão: Auditoria - Procedimentos de auditoria - prioridade 88
`,
    { targetSlug: 'rfb_auditor' },
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.sourceKind), ['estrategia_aulas', 'estrategia_aulas', 'guia_andrety']);
  assert.deepEqual(rows.map((row) => row.sourceOrder), [3, 4, 3]);
  assert.equal(rows[2].priorityHint, 88);
  assert.match(rows[2].lesson || '', /Andrety/i);
});

test('extractStudySourceCandidatesFromText retains structural course headings and excludes question content', () => {
  const candidates = extractStudySourceCandidatesFromText(`
[Pagina 1]
Economia para concursos
Aula 02 - Macroeconomia
Questão 01 - Assinale a alternativa correta sobre a inflação.
Alternativa A - Texto proprietário.
Trilha Estratégica - Revisão - Curva de Phillips
`);

  assert.deepEqual(candidates, [
    'Aula 02 - Macroeconomia',
    'Trilha Estratégica - Revisão - Curva de Phillips',
  ]);
});

test('inferStudySourceSignalsFromText uses a discipline hint for a course heading without discipline', () => {
  const parsed = inferStudySourceSignalsFromText('Aula 02 - Macroeconomia', {
    targetSlug: 'bacen_economia_financas',
    sourceKind: 'estrategia_aulas',
    disciplineHint: 'Economia',
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].discipline, 'Economia');
  assert.equal(parsed[0].topic, 'Macroeconomia');
  assert.equal(parsed[0].lesson, 'Aula 02 Estratégia');
});

test('isQuestionBankItemRelevantToStudyTarget keeps unlabeled legacy feedback out of BACEN and RFB', () => {
  const legacyItem = { exam: '', institution: '', sourceName: 'Caderno legado', tags: [] };
  const bacenItem = { exam: 'BACEN 2024', institution: 'Banco Central', sourceName: 'TEC', tags: [] };
  const rfbItem = { exam: 'AFRFB Receita Federal', institution: 'RFB', sourceName: 'TEC', tags: [] };
  const genericRfbItem = { exam: 'Receita Federal', institution: 'RFB', sourceName: 'TEC', tags: [] };

  assert.equal(isQuestionBankItemRelevantToStudyTarget(legacyItem, 'bacen_economia_financas'), false);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(legacyItem, 'rfb_auditor'), false);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(legacyItem, 'sefaz_ce'), true);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(bacenItem, 'bacen_economia_financas'), true);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(bacenItem, 'rfb_auditor'), false);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(rfbItem, 'rfb_auditor'), true);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(rfbItem, 'rfb_analista'), false);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(genericRfbItem, 'rfb_auditor'), true);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(genericRfbItem, 'rfb_analista'), true);
  assert.equal(isQuestionBankItemRelevantToStudyTarget(rfbItem, 'bacen_economia_financas'), false);
});

test('buildStudyRefreshPlan avoids completed generated work and prioritizes ignored work as review debt', () => {
  const sourceItems = parseStudySourceTable(`
kind | target | discipline | topic | incidence | edital_weight | priority | trust | order | hint | text
tec_incidence | bacen_economia_financas | Economia | Macroeconomia | 10 | 2 | 98 | 9 | 1 | TEC CEBRASPE | mais cai
tec_incidence | bacen_economia_financas | Economia | Microeconomia | 9 | 2 | 95 | 9 | 2 | TEC CEBRASPE | mais cai
estrategia_aulas | bacen_economia_financas | Sistema Financeiro | SFN | 8 | 1.5 | 90 | 8 | 3 | Aula Estratégia | aula
guia_andrety | bacen_economia_financas | Estatística | Probabilidade | 7 | 1.5 | 88 | 7 | 4 | Guia Andrety | revisão
`);
  const previousTasks = [
    plannerTask({
      id: 'done-macro',
      discipline: 'Economia',
      description: 'Resolver questões TEC: Macroeconomia',
      status: 'completed',
      performance: 92,
      scheduledDate: '2026-07-06',
      source: 'generated',
      plannerSourceKind: 'generated_planner',
      targetSlug: 'bacen_economia_financas',
    }),
    plannerTask({
      id: 'ignored-micro',
      discipline: 'Economia',
      description: 'Resolver questões TEC: Microeconomia',
      status: 'ignored',
      scheduledDate: '2026-07-06',
      source: 'generated',
      plannerSourceKind: 'generated_planner',
      targetSlug: 'bacen_economia_financas',
    }),
  ];

  const refresh = buildStudyRefreshPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    refreshDate: '2026-07-07',
    coverageRows: [],
    feedbackRows: [],
    sourceItems,
    previousTasks,
  });

  assert.equal(refresh.date, '2026-07-07');
  assert.equal(refresh.blocks.length, 4);
  assert.equal(refresh.blocks.some((block) => block.topic === 'Macroeconomia'), false);
  assert.equal(refresh.blocks[3].kind, 'review');
  assert.equal(refresh.blocks[3].topic, 'Microeconomia');
  assert.ok(refresh.warnings.some((warning) => /concluída/i.test(warning)));
});

test('buildStudyRefreshPlan converts low-performance completed tasks into weakness feedback', () => {
  const sourceItems = parseStudySourceTable(`
kind | target | discipline | topic | incidence | edital_weight | priority | trust | order | hint | text
estrategia_aulas | bacen_economia_financas | Sistema Financeiro | SFN | 8 | 1.5 | 90 | 8 | 1 | Aula Estratégia | aula
tec_incidence | bacen_economia_financas | Economia | Macroeconomia | 10 | 2 | 98 | 9 | 2 | TEC CEBRASPE | mais cai
tec_incidence | bacen_economia_financas | Economia | Microeconomia | 9 | 2 | 95 | 9 | 3 | TEC CEBRASPE | mais cai
guia_andrety | bacen_economia_financas | Estatística | Probabilidade | 7 | 1.5 | 88 | 7 | 4 | Guia Andrety | revisão
`);
  const refresh = buildStudyRefreshPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    refreshDate: '2026-07-08',
    coverageRows: [],
    feedbackRows: [],
    sourceItems,
    previousTasks: [
      plannerTask({
        id: 'low-sfn',
        discipline: 'Sistema Financeiro',
        description: 'Estudar ou reler bloco médio: SFN',
        status: 'completed',
        performance: 45,
        scheduledDate: '2026-07-07',
        source: 'generated',
        plannerSourceKind: 'generated_planner',
        targetSlug: 'bacen_economia_financas',
      }),
    ],
  });

  assert.ok(refresh.blocks.some((block) => block.kind === 'review' && block.topic === 'SFN'));
  assert.ok(refresh.scoreboard.some((row) => row.topic === 'SFN' && row.reviewDebt > 0));
});

test('buildStudyRefreshPlan ignores a failed block from a different target', () => {
  const refresh = buildStudyRefreshPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    refreshDate: '2026-07-08',
    coverageRows: [],
    feedbackRows: [],
    sourceItems: seedSourceSignalsForTarget('bacen_economia_financas'),
    previousTasks: [
      plannerTask({
        id: 'rfb-tax-debt',
        discipline: 'Direito Tributário',
        description: 'Crédito tributário',
        status: 'ignored',
        source: 'generated',
        plannerSourceKind: 'generated_planner',
        targetSlug: 'rfb_auditor',
      }),
    ],
  });

  assert.deepEqual(refresh.refreshedFromTaskIds, []);
  assert.equal(refresh.blocks.some((block) => block.discipline === 'Direito Tributário'), false);
  assert.equal(refresh.warnings.some((warning) => /dívida de revisão/i.test(warning)), false);
});

test('isPlannerTaskRelevantToStudyTarget transfers only explicit shared work and the SEFAZ LS baseline', () => {
  const bacenTask = plannerTask({ targetSlug: 'bacen_economia_financas', plannerSourceKind: 'generated_planner' });
  const sharedTask = plannerTask({ targetSlug: 'shared', plannerSourceKind: 'manual' });
  const legacyLsTask = plannerTask({ source: 'ls-meta-pdf', plannerSourceKind: 'ls' });

  assert.equal(isPlannerTaskRelevantToStudyTarget(bacenTask, 'bacen_economia_financas'), true);
  assert.equal(isPlannerTaskRelevantToStudyTarget(bacenTask, 'rfb_auditor'), false);
  assert.equal(isPlannerTaskRelevantToStudyTarget(sharedTask, 'rfb_auditor'), true);
  assert.equal(isPlannerTaskRelevantToStudyTarget(legacyLsTask, 'sefaz_ce'), true);
  assert.equal(isPlannerTaskRelevantToStudyTarget(legacyLsTask, 'bacen_economia_financas'), false);
});

test('updateStudyCoverageFromPlannerTask turns matching coverage strong after a high-performing generated block', () => {
  const coverageRows: StudyCoverageRow[] = [
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'unread',
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Curso BACEN',
    },
    {
      targetSlug: 'shared',
      discipline: 'Português',
      topic: 'Interpretação de textos',
      status: 'stale',
      editalWeight: 1,
      incidence: 6,
      tier: 2,
      materialHint: 'Curso base',
    },
    {
      targetSlug: 'rfb_auditor',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'weak',
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Curso RFB',
    },
  ];
  const task = plannerTask({
    targetSlug: 'bacen_economia_financas',
    plannerSourceKind: 'generated_planner',
    description: 'Resolver questões TEC: Macroeconomia',
    status: 'completed',
    performance: 86,
  });

  const result = updateStudyCoverageFromPlannerTask(coverageRows, task);

  assert.equal(result.updatedCount, 1);
  assert.equal(result.status, 'strong');
  assert.equal(result.rows[0].status, 'strong');
  assert.equal(result.rows[1].status, 'stale');
  assert.equal(result.rows[2].status, 'weak');
});

test('updateStudyCoverageFromPlannerTask leaves skipped and LS tasks to adaptive refresh instead of rewriting coverage', () => {
  const coverageRows = seedCoverageForTarget('sefaz_ce');
  const skippedGenerated = plannerTask({
    targetSlug: 'sefaz_ce',
    plannerSourceKind: 'generated_planner',
    description: 'Resolver questões TEC: ICMS',
    status: 'ignored',
  });
  const completedLs = plannerTask({
    source: 'ls-meta-pdf',
    plannerSourceKind: 'ls',
    description: 'Resolver questões TEC: ICMS',
    status: 'completed',
    performance: 90,
  });

  assert.deepEqual(updateStudyCoverageFromPlannerTask(coverageRows, skippedGenerated), {
    rows: coverageRows,
    updatedCount: 0,
  });
  assert.deepEqual(updateStudyCoverageFromPlannerTask(coverageRows, completedLs), {
    rows: coverageRows,
    updatedCount: 0,
  });
});

test('mergeStudyCoverageWithTargetSeed keeps prior target audits while adding missing target defaults', () => {
  const existing = [
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'strong' as const,
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Meu curso',
      notes: 'auditada',
    },
  ];

  const merged = mergeStudyCoverageWithTargetSeed(existing, 'rfb_auditor');

  assert.equal(merged.find((row) => row.targetSlug === 'bacen_economia_financas')?.status, 'strong');
  assert.equal(merged.find((row) => row.targetSlug === 'bacen_economia_financas')?.notes, 'auditada');
  assert.ok(merged.some((row) => row.targetSlug === 'rfb_auditor' && row.discipline === 'Direito Tributário'));
  assert.ok(merged.some((row) => row.targetSlug === 'shared' && row.discipline === 'Português'));
});

test('mergeStudySourceItemsWithTargetSeed preserves imported sources while adding a target baseline', () => {
  const existing = [
    {
      id: 'my-bacen-source',
      sourceKind: 'estrategia_aulas' as const,
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      sourceTrust: 9,
      lesson: 'Aula 12',
    },
  ];

  const merged = mergeStudySourceItemsWithTargetSeed(existing, 'sefaz_ce');

  assert.equal(merged.find((item) => item.id === 'my-bacen-source')?.lesson, 'Aula 12');
  assert.ok(merged.some((item) => item.targetSlug === 'sefaz_ce' && item.sourceKind === 'tec_incidence'));
});

test('LS alignment ignores a baseline from another target while keeping shared material as partial transfer', () => {
  const coverageRows: StudyCoverageRow[] = [
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'stale',
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Curso BACEN',
    },
  ];
  const sourceItems = [
    {
      id: 'ls-sefaz',
      sourceKind: 'ls' as const,
      targetSlug: 'sefaz_ce',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      sourceTrust: 9,
    },
    {
      id: 'trilha-shared',
      sourceKind: 'trilha_estrategica' as const,
      targetSlug: 'shared',
      discipline: 'Português',
      topic: 'Interpretação de textos',
      sourceTrust: 8,
    },
  ];

  const plan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows,
    feedbackRows: [],
    sourceItems,
  });
  const sharedPlan = buildStudyDayPlan({
    targetSlug: 'bacen_economia_financas',
    phase: 'pre_edital',
    coverageRows: [
      {
        targetSlug: 'shared',
        discipline: 'Português',
        topic: 'Interpretação de textos',
        status: 'stale',
        editalWeight: 1,
        incidence: 6,
        tier: 2,
        materialHint: 'Curso base',
      },
    ],
    feedbackRows: [],
    sourceItems,
  });
  const comparison = buildStudyBaselineComparison(sourceItems, 'bacen_economia_financas');

  assert.ok(plan.scoreboard.filter((row) => row.topic === 'Macroeconomia').every((row) => row.lsAlignment === 0));
  assert.equal(sharedPlan.scoreboard.find((row) => row.topic === 'Interpretação de textos')?.lsAlignment, 2);
  assert.deepEqual(comparison, {
    activeTargetSlug: 'bacen_economia_financas',
    alignedCount: 0,
    transferableCount: 1,
    mismatchedCount: 1,
    mismatchTargetSlugs: ['sefaz_ce'],
  });
});

test('updateStudyCoverageStatus changes only the exact target topic selected in the quick audit', () => {
  const rows: StudyCoverageRow[] = [
    {
      targetSlug: 'bacen_economia_financas',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'unread',
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Curso BACEN',
    },
    {
      targetSlug: 'rfb_auditor',
      discipline: 'Economia',
      topic: 'Macroeconomia',
      status: 'weak',
      editalWeight: 2,
      incidence: 9,
      tier: 1,
      materialHint: 'Curso RFB',
    },
  ];

  const result = updateStudyCoverageStatus(rows, {
    targetSlug: 'bacen_economia_financas',
    discipline: 'Economia',
    topic: 'Macroeconomia',
  }, 'strong');

  assert.equal(result.updatedCount, 1);
  assert.equal(result.rows[0].status, 'strong');
  assert.equal(result.rows[1].status, 'weak');
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

function plannerTask(overrides: Partial<PlannerTask>): PlannerTask {
  return {
    id: overrides.id || 'task',
    number: overrides.number || 1,
    metaNumber: overrides.metaNumber,
    planejamento: overrides.planejamento || 'Study OS',
    discipline: overrides.discipline || 'Economia',
    format: overrides.format || 'Questões TEC',
    description: overrides.description || 'Resolver questões TEC: Macroeconomia',
    details: overrides.details,
    tips: overrides.tips,
    spentMinutes: overrides.spentMinutes || 0,
    estimatedMinutes: overrides.estimatedMinutes || 55,
    performance: overrides.performance ?? null,
    status: overrides.status || 'pending',
    relevance: overrides.relevance || 8,
    scheduledDate: overrides.scheduledDate,
    startTime: overrides.startTime,
    durationMinutes: overrides.durationMinutes || 55,
    source: overrides.source || 'generated',
    plannerSourceKind: overrides.plannerSourceKind,
    targetSlug: overrides.targetSlug,
    linkedStudyTaskId: overrides.linkedStudyTaskId,
    createdAt: overrides.createdAt || '2026-07-06T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-07-06T00:00:00.000Z',
  };
}
