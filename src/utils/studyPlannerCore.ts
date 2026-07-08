import { PlannerTask } from '../types';

export type StudyPlanPhase = 'pre_edital' | 'pos_edital';
export type CoverageStatus = 'strong' | 'stale' | 'weak' | 'unread';
export type StudyBlockKind = 'theory' | 'questions' | 'review';
export type StudySourceKind =
  | 'ls'
  | 'trilha_estrategica'
  | 'estrategia_aulas'
  | 'guia_andrety'
  | 'tec_incidence'
  | 'manual';

export interface ExamTargetProfile {
  slug: string;
  name: string;
  institution: string;
  role: string;
  organizer: string;
  phase: StudyPlanPhase;
  sourceUrls: string[];
  editalNotes: string;
  vagasNotes: string;
  defaultDailyQuota: number;
  priorityScore: number;
  active: boolean;
  courseAvailable: boolean;
  lsAvailable: boolean;
  bancaFit: number;
  costBenefit: number;
}

export interface TargetDecisionRow {
  targetSlug: string;
  name: string;
  institution: string;
  role: string;
  organizer: string;
  phase: StudyPlanPhase;
  vagasNotes: string;
  active: boolean;
  priorityScore: number;
  costBenefit: number;
  bancaFit: number;
  coverageRows: number;
  weaknessRows: number;
  overlapRows: number;
  courseAvailability: number;
  lsAvailability: number;
  editalTiming: number;
  recommendationScore: number;
  recommendationLabel: string;
  reasons: string[];
}

export interface BuildTargetDecisionRowsInput {
  targetProfiles: ExamTargetProfile[];
  coverageRows: StudyCoverageRow[];
  feedbackRows: TopicFeedback[];
  sourceItems: StudySourceItem[];
  activeTargetSlug?: string;
}

export interface StudyCoverageRow {
  targetSlug: string;
  discipline: string;
  topic: string;
  status: CoverageStatus;
  editalWeight: number;
  incidence: number;
  tier: number;
  materialHint: string;
  materialSource?: string;
  notes?: string;
}

export interface StudySourceItem {
  id: string;
  sourceKind: StudySourceKind;
  targetSlug: string;
  discipline: string;
  topic: string;
  lesson?: string;
  taskText?: string;
  incidence?: number;
  editalWeight?: number;
  priorityHint?: number;
  sourceTrust: number;
  sourceOrder?: number;
}

export interface TopicFeedback {
  discipline: string;
  topic: string;
  weaknessScore: number;
  attempts?: number;
  wrong?: number;
  doubts?: number;
  favorites?: number;
  lastSeenAt?: string;
}

export interface StudyScoreboardRow {
  candidateKey: string;
  targetSlug: string;
  sourceTargetSlug: string;
  discipline: string;
  topic: string;
  kind: StudyBlockKind;
  materialHint: string;
  editalWeight: number;
  plannedQuestions?: number;
  weakness: number;
  incidence: number;
  tier: number;
  coverageNeed: number;
  reviewDebt: number;
  lsAlignment: number;
  targetFit: number;
  overlapValue: number;
  deadlinePressure: number;
  bancaFit: number;
  balancePenalty: number;
  lowTrustPenalty: number;
  finalScore: number;
  chosen: boolean;
  displacedBy: string;
}

export interface DailyStudyBlock {
  id: string;
  kind: StudyBlockKind;
  targetSlug: string;
  discipline: string;
  topic: string;
  materialHint: string;
  durationMinutes: number;
  plannedQuestions?: number;
  finalScore: number;
  sourceReason: string[];
  linkedSourceItems: string[];
  scoreBreakdown: Pick<
    StudyScoreboardRow,
    | 'weakness'
    | 'incidence'
    | 'tier'
    | 'coverageNeed'
    | 'reviewDebt'
    | 'lsAlignment'
    | 'targetFit'
    | 'overlapValue'
    | 'deadlinePressure'
    | 'bancaFit'
    | 'balancePenalty'
    | 'lowTrustPenalty'
    | 'finalScore'
  >;
}

export interface StudyDayPlan {
  targetSlug: string;
  phase: StudyPlanPhase;
  blocks: DailyStudyBlock[];
  scoreboard: StudyScoreboardRow[];
  warnings: string[];
}

export interface BuildStudyDayPlanInput {
  targetSlug: string;
  phase: StudyPlanPhase;
  coverageRows: StudyCoverageRow[];
  feedbackRows: TopicFeedback[];
  sourceItems: StudySourceItem[];
  targetProfiles?: ExamTargetProfile[];
  dailyQuota?: number;
  excludedCandidateKeys?: string[];
}

export interface StudyWeekDayPlan extends StudyDayPlan {
  date: string;
}

export interface StudyWeekPlan {
  targetSlug: string;
  phase: StudyPlanPhase;
  startDate: string;
  days: StudyWeekDayPlan[];
  scoreboard: StudyScoreboardRow[];
  warnings: string[];
}

export interface BuildStudyWeekPlanInput extends BuildStudyDayPlanInput {
  startDate: string;
  days?: number;
}

interface Candidate {
  candidateKey: string;
  sourceTargetSlug: string;
  discipline: string;
  topic: string;
  kind: StudyBlockKind;
  materialHint: string;
  plannedQuestions?: number;
  sourceItemIds: string[];
}

const DAILY_BLOCKS: StudyBlockKind[] = ['theory', 'questions', 'questions', 'review'];
const MAX_DISCIPLINE_PER_DAY = 2;

const PRE_EDITAL_WEIGHTS = {
  weakness: 3.0,
  incidence: 1.5,
  tier: 1.5,
  coverageNeed: 2.0,
  reviewDebt: 1.5,
  lsAlignment: 0.5,
};

const POS_EDITAL_WEIGHTS = {
  weakness: 3.5,
  incidence: 2.5,
  tier: 1.5,
  coverageNeed: 1.0,
  reviewDebt: 1.0,
  lsAlignment: 0.5,
};

export const DEFAULT_STUDY_TARGET_PROFILES: ExamTargetProfile[] = [
  {
    slug: 'bacen_economia_financas',
    name: 'BACEN Economia e Financas',
    institution: 'Banco Central do Brasil',
    role: 'Analista - Economia e Financas',
    organizer: 'CEBRASPE',
    phase: 'pre_edital',
    sourceUrls: ['https://www.bcb.gov.br/detalhenoticia/776/noticia'],
    editalNotes: 'Concurso BCB 2024: 100 vagas, com 50 para Economia e Financas.',
    vagasNotes: '50 vagas Economia e Financas no edital BCB 2024.',
    defaultDailyQuota: 4,
    priorityScore: 84,
    active: true,
    courseAvailable: false,
    lsAvailable: false,
    bancaFit: 8,
    costBenefit: 9,
  },
  {
    slug: 'rfb_auditor',
    name: 'RFB Auditor',
    institution: 'Receita Federal do Brasil',
    role: 'Auditor-Fiscal',
    organizer: 'FGV',
    phase: 'pre_edital',
    sourceUrls: ['https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/servidores/concurso-publico-2022'],
    editalNotes: 'Concurso Receita 2022: 230 vagas para Auditor-Fiscal.',
    vagasNotes: '230 vagas AFRFB no concurso 2022.',
    defaultDailyQuota: 4,
    priorityScore: 78,
    active: false,
    courseAvailable: false,
    lsAvailable: false,
    bancaFit: 7,
    costBenefit: 7,
  },
  {
    slug: 'rfb_analista',
    name: 'RFB Analista',
    institution: 'Receita Federal do Brasil',
    role: 'Analista-Tributario',
    organizer: 'FGV',
    phase: 'pre_edital',
    sourceUrls: ['https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/servidores/concurso-publico-2022'],
    editalNotes: 'Concurso Receita 2022: 469 vagas para Analista-Tributario.',
    vagasNotes: '469 vagas ATRFB no concurso 2022.',
    defaultDailyQuota: 4,
    priorityScore: 76,
    active: false,
    courseAvailable: false,
    lsAvailable: false,
    bancaFit: 7,
    costBenefit: 8,
  },
  {
    slug: 'sefaz_ce',
    name: 'SEFAZ CE',
    institution: 'Secretaria da Fazenda do Ceara',
    role: 'Auditor Fiscal',
    organizer: 'CEBRASPE',
    phase: 'pos_edital',
    sourceUrls: [],
    editalNotes: 'Target temporario para manter execucao SEFAZ CE com LS/trilha.',
    vagasNotes: '',
    defaultDailyQuota: 4,
    priorityScore: 70,
    active: false,
    courseAvailable: true,
    lsAvailable: true,
    bancaFit: 8,
    costBenefit: 6,
  },
];

const DEFAULT_STUDY_COVERAGE: StudyCoverageRow[] = [
  coverage('bacen_economia_financas', 'Economia', 'Macroeconomia', 'unread', 2, 9, 1, 'Questões CEBRASPE'),
  coverage('bacen_economia_financas', 'Economia', 'Microeconomia', 'unread', 2, 9, 1, 'Questões CEBRASPE'),
  coverage('bacen_economia_financas', 'Sistema Financeiro', 'Sistema Financeiro Nacional', 'stale', 1.5, 8, 1, 'Questões CEBRASPE'),
  coverage('bacen_economia_financas', 'Estatística', 'Probabilidade e estatística', 'weak', 1.5, 7, 2, 'Questões CEBRASPE'),
  coverage('shared', 'Português', 'Interpretação de textos', 'stale', 1, 6, 2, 'Curso base'),
  coverage('rfb_auditor', 'Direito Tributário', 'Crédito Tributário', 'stale', 2, 10, 1, 'PDF Completo'),
  coverage('rfb_auditor', 'Contabilidade', 'Demonstrações Contábeis', 'stale', 1.5, 8, 1, 'PDF Completo'),
  coverage('rfb_auditor', 'Auditoria', 'Procedimentos de auditoria', 'weak', 1.5, 8, 1, 'Questões FGV'),
  coverage('rfb_analista', 'Direito Tributário', 'Legislação Tributária', 'stale', 2, 9, 1, 'PDF Completo'),
  coverage('rfb_analista', 'Contabilidade', 'Contabilidade Geral', 'stale', 1.5, 7, 1, 'PDF Completo'),
  coverage('sefaz_ce', 'Finanças Públicas', 'Orçamento Público', 'weak', 2, 8, 2, 'LS/trilha'),
  coverage('sefaz_ce', 'Direito Tributário', 'ICMS', 'weak', 2, 9, 1, 'LS/trilha'),
];

export const seedCoverageForTarget = (targetSlug: string): StudyCoverageRow[] => {
  const normalizedTarget = normalizeTargetSlug(targetSlug);
  return DEFAULT_STUDY_COVERAGE
    .filter((row) => row.targetSlug === normalizedTarget || row.targetSlug === 'shared')
    .map((row) => ({ ...row }));
};

export const buildStudyDayPlan = ({
  targetSlug,
  phase,
  coverageRows,
  feedbackRows,
  sourceItems,
  targetProfiles = DEFAULT_STUDY_TARGET_PROFILES,
  dailyQuota = 4,
  excludedCandidateKeys = [],
}: BuildStudyDayPlanInput): StudyDayPlan => {
  const activeTargetSlug = normalizeTargetSlug(targetSlug);
  const targetProfile = targetProfiles.find((target) => target.slug === activeTargetSlug);
  const weights = phase === 'pos_edital' ? POS_EDITAL_WEIGHTS : PRE_EDITAL_WEIGHTS;
  const rows = targetRows(coverageRows, activeTargetSlug);
  const candidates = buildCandidates(rows, sourceItems, activeTargetSlug);
  const scoreboard = candidates
    .map((candidate) =>
      scoreCandidate(candidate, {
        targetSlug: activeTargetSlug,
        phase,
        targetProfile,
        weights,
        coverageRows: rows,
        feedbackRows,
        sourceItems,
      }),
    )
    .sort((a, b) => b.finalScore - a.finalScore || a.discipline.localeCompare(b.discipline) || a.topic.localeCompare(b.topic));

  const chosenKeys = new Set<string>();
  const excludedKeys = new Set(excludedCandidateKeys);
  const dailyCounts = new Map<string, number>();
  const blocks: DailyStudyBlock[] = [];
  const dailyMix = DAILY_BLOCKS.slice(0, Math.max(1, dailyQuota));

  dailyMix.forEach((kind) => {
    const choice = chooseCandidate(scoreboard, chosenKeys, dailyCounts, kind, excludedKeys);
    if (!choice) return;
    chosenKeys.add(choice.candidateKey);
    dailyCounts.set(choice.discipline, (dailyCounts.get(choice.discipline) || 0) + 1);
    choice.chosen = true;
    blocks.push(scoreboardRowToBlock(choice, blocks.length));
  });

  scoreboard.forEach((row) => {
    if (row.chosen) {
      row.displacedBy = '';
      return;
    }
    const chosenForKind = scoreboard.find((candidate) => candidate.chosen && candidate.kind === row.kind);
    row.displacedBy = chosenForKind ? `${chosenForKind.discipline} > ${chosenForKind.topic}` : '';
  });

  const warnings: string[] = [];
  if (blocks.length < dailyMix.length) {
    warnings.push(`${dailyMix.length - blocks.length} bloco(s) ficaram sem candidato confiavel.`);
  }

  return {
    targetSlug: activeTargetSlug,
    phase,
    blocks,
    scoreboard,
    warnings,
  };
};

export const buildStudyWeekPlan = ({
  startDate,
  days = 5,
  ...dayInput
}: BuildStudyWeekPlanInput): StudyWeekPlan => {
  const start = parseIsoDate(startDate);
  const safeDays = clamp(Math.round(days), 1, 14);
  const usedCandidateKeys = new Set<string>();
  const weekDays: StudyWeekDayPlan[] = [];
  const scoreboard: StudyScoreboardRow[] = [];
  const warnings: string[] = [];

  Array.from({ length: safeDays }).forEach((_, index) => {
    const date = addDays(start, index);
    const plan = buildStudyDayPlan({
      ...dayInput,
      excludedCandidateKeys: Array.from(usedCandidateKeys),
    });

    plan.blocks.forEach((block) => {
      const candidateKey = candidateKeyFromBlockId(block.id);
      if (candidateKey) usedCandidateKeys.add(candidateKey);
    });
    scoreboard.push(...plan.scoreboard.map((row) => ({ ...row })));
    warnings.push(...plan.warnings.map((warning) => `${toIsoDateString(date)}: ${warning}`));
    weekDays.push({
      ...plan,
      date: toIsoDateString(date),
      blocks: plan.blocks.map((block) => ({
        ...block,
        id: `${toIsoDateString(date)}-${block.id}`,
      })),
    });
  });

  return {
    targetSlug: normalizeTargetSlug(dayInput.targetSlug),
    phase: dayInput.phase,
    startDate: toIsoDateString(start),
    days: weekDays,
    scoreboard,
    warnings,
  };
};

export const parseStudyCoverageTable = (text: string): StudyCoverageRow[] => {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes('|'))
    .filter((line) => !/^target\s*\|/i.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells) => {
      const [targetSlug, discipline, topic, rawStatus, rawWeight, rawIncidence, materialHint, rawTier, materialSource, notes] = cells;
      return {
        targetSlug: normalizeTargetSlug(targetSlug),
        discipline,
        topic,
        status: toCoverageStatus(rawStatus),
        editalWeight: toNumber(rawWeight, 1),
        incidence: toNumber(rawIncidence, 0),
        tier: Math.round(toNumber(rawTier, 3)),
        materialHint: materialHint || '',
        materialSource: materialSource || '',
        notes: notes || '',
      };
    })
    .filter((row) => Boolean(row.targetSlug && row.discipline && row.topic));
};

export const formatStudyCoverageTable = (rows: StudyCoverageRow[]): string => {
  const header = 'target | discipline | topic | status | edital_weight | incidence | material_hint | tier | material_source | notes';
  const body = rows.map((row) =>
    [
      row.targetSlug,
      row.discipline,
      row.topic,
      row.status,
      row.editalWeight,
      row.incidence,
      row.materialHint,
      row.tier,
      row.materialSource || '',
      row.notes || '',
    ].join(' | '),
  );
  return [header, ...body].join('\n');
};

export const parseStudyTargetProfileTable = (text: string): ExamTargetProfile[] => {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes('|'))
    .filter((line) => !/^slug\s*\|/i.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .map((cells) => {
      const [
        slug,
        name,
        institution,
        role,
        organizer,
        rawPhase,
        rawPriority,
        rawCostBenefit,
        rawBancaFit,
        rawCourseAvailable,
        rawLsAvailable,
        rawActive,
        vagasNotes,
        editalNotes,
        rawSourceUrls,
      ] = cells;

      return {
        slug: normalizeTargetSlug(slug),
        name: name || slug || 'Target',
        institution: institution || '',
        role: role || '',
        organizer: organizer || '',
        phase: rawPhase === 'pos_edital' ? 'pos_edital' : 'pre_edital',
        sourceUrls: parseUrls(rawSourceUrls),
        editalNotes: editalNotes || '',
        vagasNotes: vagasNotes || '',
        defaultDailyQuota: 4,
        priorityScore: clamp(Math.round(toNumber(rawPriority, 50)), 0, 100),
        active: toBoolean(rawActive),
        courseAvailable: toBoolean(rawCourseAvailable),
        lsAvailable: toBoolean(rawLsAvailable),
        bancaFit: clamp(Math.round(toNumber(rawBancaFit, 5)), 0, 10),
        costBenefit: clamp(Math.round(toNumber(rawCostBenefit, 5)), 0, 10),
      } satisfies ExamTargetProfile;
    })
    .filter((target) => Boolean(target.slug && target.name));
};

export const formatStudyTargetProfileTable = (profiles: ExamTargetProfile[]): string => {
  const header = 'slug | name | institution | role | organizer | phase | priority | cost_benefit | banca_fit | course | ls | active | vagas | notes | urls';
  const body = profiles.map((target) =>
    [
      target.slug,
      target.name,
      target.institution,
      target.role,
      target.organizer,
      target.phase,
      target.priorityScore,
      target.costBenefit,
      target.bancaFit,
      formatBoolean(target.courseAvailable),
      formatBoolean(target.lsAvailable),
      formatBoolean(target.active),
      target.vagasNotes,
      target.editalNotes,
      target.sourceUrls.join(', '),
    ].map(tableCell).join(' | '),
  );
  return [header, ...body].join('\n');
};

export const buildTargetDecisionRows = ({
  targetProfiles,
  coverageRows,
  feedbackRows,
  sourceItems,
  activeTargetSlug,
}: BuildTargetDecisionRowsInput): TargetDecisionRow[] => {
  const activeSlug = normalizeTargetSlug(activeTargetSlug || targetProfiles.find((target) => target.active)?.slug || '');
  return targetProfiles
    .map((target) => {
      const rowsForTarget = targetRows(coverageRows, target.slug);
      const targetFeedback = feedbackRows.filter((feedback) =>
        rowsForTarget.some((row) => sameDiscipline(row, feedback) && topicMatches(row.topic, feedback.topic)),
      );
      const overlappingSources = targetRows(sourceItems, target.slug);
      const lsSources = overlappingSources.filter((item) => item.sourceKind === 'ls');
      const lsAvailability = (target.lsAvailable ? 8 : 0) + Math.min(7, lsSources.length * 2);
      const courseAvailability = target.courseAvailable ? 10 : 0;
      const editalTiming = target.phase === 'pos_edital' ? 10 : 5;
      const coverageScore = Math.min(20, rowsForTarget.length * 2);
      const weaknessScore = Math.min(12, targetFeedback.reduce((sum, row) => sum + row.weaknessScore, 0) / Math.max(1, targetFeedback.length || 1));
      const overlapScore = Math.min(12, overlappingSources.length * 2);
      const activeBonus = target.slug === activeSlug ? 6 : 0;
      const recommendationScore = round(
        target.priorityScore +
          target.costBenefit * 5 +
          target.bancaFit * 3 +
          coverageScore +
          weaknessScore +
          overlapScore +
          courseAvailability +
          lsAvailability +
          editalTiming +
          activeBonus,
      );
      const reasons = [
        target.costBenefit >= 8 ? `custo-beneficio ${target.costBenefit}/10` : '',
        rowsForTarget.length > 0 ? `${rowsForTarget.length} linha(s) de cobertura` : '',
        targetFeedback.length > 0 ? `${targetFeedback.length} fraqueza(s) atuais` : '',
        target.lsAvailable || lsSources.length > 0 ? 'LS/trilha disponível como baseline' : '',
        target.courseAvailable ? 'curso/material disponível' : '',
        target.phase === 'pos_edital' ? 'pressão pós-edital' : '',
      ].filter(Boolean);

      return {
        targetSlug: target.slug,
        name: target.name,
        institution: target.institution,
        role: target.role,
        organizer: target.organizer,
        phase: target.phase,
        vagasNotes: target.vagasNotes,
        active: target.slug === activeSlug,
        priorityScore: target.priorityScore,
        costBenefit: target.costBenefit,
        bancaFit: target.bancaFit,
        coverageRows: rowsForTarget.length,
        weaknessRows: targetFeedback.length,
        overlapRows: overlappingSources.length,
        courseAvailability,
        lsAvailability,
        editalTiming,
        recommendationScore,
        recommendationLabel: recommendationScore >= 150 ? 'Forte' : recommendationScore >= 120 ? 'Viável' : 'Fraco',
        reasons,
      } satisfies TargetDecisionRow;
    })
    .sort((a, b) => b.recommendationScore - a.recommendationScore || a.name.localeCompare(b.name));
};

export const materializeStudyBlocksAsPlannerTasks = (
  blocks: DailyStudyBlock[],
  options: { planejamento: string; scheduledDate?: string; metaNumber?: number },
): PlannerTask[] => {
  const now = new Date().toISOString();
  return blocks.map((block, index) => ({
    id: `study_os_${Date.now()}_${index}_${normalize(block.discipline).replace(/\s+/g, '_')}`,
    number: index + 1,
    metaNumber: options.metaNumber,
    planejamento: options.planejamento,
    discipline: block.discipline,
    format: block.kind === 'theory' ? 'Teoria/Releitura' : block.kind === 'questions' ? 'Questões TEC' : 'Revisão de Erros',
    description: blockDescription(block),
    details: [
      `Target: ${block.targetSlug}`,
      `Fonte: ${block.materialHint || 'manual'}`,
      `Score: ${block.finalScore}`,
      ...block.sourceReason,
    ].join('\n'),
    tips: undefined,
    spentMinutes: 0,
    estimatedMinutes: block.durationMinutes,
    performance: null,
    status: 'pending',
    relevance: clamp(Math.round(block.finalScore / 10), 6, 10),
    scheduledDate: options.scheduledDate,
    durationMinutes: block.durationMinutes,
    source: 'generated',
    linkedStudyTaskId: undefined,
    createdAt: now,
    updatedAt: now,
  }));
};

export const materializeStudyWeekAsPlannerTasks = (
  week: StudyWeekPlan,
  options: { planejamento: string; metaNumber?: number },
): PlannerTask[] => {
  return week.days.flatMap((day) =>
    materializeStudyBlocksAsPlannerTasks(day.blocks, {
      planejamento: options.planejamento,
      metaNumber: options.metaNumber,
      scheduledDate: day.date,
    }),
  ).map((task, index) => ({
    ...task,
    id: `${task.id}_${index + 1}`,
    number: index + 1,
  }));
};

function coverage(
  targetSlug: string,
  discipline: string,
  topic: string,
  status: CoverageStatus,
  editalWeight: number,
  incidence: number,
  tier: number,
  materialHint: string,
): StudyCoverageRow {
  return { targetSlug, discipline, topic, status, editalWeight, incidence, tier, materialHint };
}

function buildCandidates(rows: StudyCoverageRow[], sourceItems: StudySourceItem[], targetSlug: string): Candidate[] {
  const candidates = new Map<string, Candidate>();

  rows.forEach((row, index) => {
    (['theory', 'questions'] as StudyBlockKind[]).forEach((kind) => {
      const key = candidateKey('coverage', index, row.discipline, row.topic, kind, row.materialHint);
      candidates.set(key, {
        candidateKey: key,
        sourceTargetSlug: row.targetSlug,
        discipline: row.discipline,
        topic: row.topic,
        kind,
        materialHint: row.materialHint,
        plannedQuestions: kind === 'questions' ? 20 : undefined,
        sourceItemIds: [],
      });
    });
    if (row.status === 'weak' || row.status === 'stale' || row.status === 'unread') {
      const key = candidateKey('coverage', index, row.discipline, row.topic, 'review', row.materialHint);
      candidates.set(key, {
        candidateKey: key,
        sourceTargetSlug: row.targetSlug,
        discipline: row.discipline,
        topic: row.topic,
        kind: 'review',
        materialHint: row.materialHint,
        plannedQuestions: 15,
        sourceItemIds: [],
      });
    }
  });

  targetRows(sourceItems, targetSlug).forEach((item, index) => {
    const kind = sourceKindToBlockKind(item);
    const key = candidateKey('source', index, item.discipline, item.topic, kind, item.sourceKind);
    const previous = candidates.get(key);
    candidates.set(key, {
      candidateKey: key,
      sourceTargetSlug: item.targetSlug,
      discipline: item.discipline,
      topic: item.topic,
      kind,
      materialHint: item.taskText || item.lesson || item.sourceKind,
      plannedQuestions: kind === 'questions' ? 20 : kind === 'review' ? 15 : undefined,
      sourceItemIds: [...(previous?.sourceItemIds || []), item.id],
    });
  });

  return Array.from(candidates.values());
}

function scoreCandidate(
  candidate: Candidate,
  context: {
    targetSlug: string;
    phase: StudyPlanPhase;
    targetProfile?: ExamTargetProfile;
    weights: typeof PRE_EDITAL_WEIGHTS;
    coverageRows: StudyCoverageRow[];
    feedbackRows: TopicFeedback[];
    sourceItems: StudySourceItem[];
  },
): StudyScoreboardRow {
  const rawWeakness = weaknessRaw(candidate, context.feedbackRows);
  const rawIncidence = incidenceRaw(candidate, context.coverageRows, context.sourceItems);
  const rawEditalWeight = editalWeightRaw(candidate, context.coverageRows, context.phase);
  const rawTier = tierRaw(candidate, context.coverageRows) * rawEditalWeight;
  const rawCoverage = coverageRaw(candidate, context.coverageRows);
  const rawReview = candidate.kind === 'review' ? Math.max(rawCoverage, rawWeakness) : 0;
  const rawLsAlignment = lsAlignmentRaw(candidate, context.sourceItems);
  const rawTargetFit = targetFitRaw(candidate, context.targetSlug);
  const rawOverlap = overlapValueRaw(candidate, context.targetSlug);
  const deadlineRaw = context.phase === 'pos_edital' || context.targetProfile?.phase === 'pos_edital' ? 10 : 4;
  const rawBanca = bancaFitRaw(candidate, context.targetProfile);
  const lowTrustPenalty = isLowTrust(candidate.materialHint) ? 12 : 0;

  const row: StudyScoreboardRow = {
    candidateKey: candidate.candidateKey,
    targetSlug: context.targetSlug,
    sourceTargetSlug: candidate.sourceTargetSlug,
    discipline: candidate.discipline,
    topic: candidate.topic,
    kind: candidate.kind,
    materialHint: candidate.materialHint,
    editalWeight: rawEditalWeight,
    plannedQuestions: candidate.plannedQuestions,
    weakness: round(rawWeakness * context.weights.weakness),
    incidence: round(rawIncidence * context.weights.incidence),
    tier: round(rawTier * context.weights.tier),
    coverageNeed: round(rawCoverage * context.weights.coverageNeed),
    reviewDebt: round(rawReview * context.weights.reviewDebt),
    lsAlignment: round(rawLsAlignment * context.weights.lsAlignment),
    targetFit: round(rawTargetFit),
    overlapValue: round(rawOverlap),
    deadlinePressure: round(deadlineRaw),
    bancaFit: round(rawBanca),
    balancePenalty: 0,
    lowTrustPenalty,
    finalScore: 0,
    chosen: false,
    displacedBy: '',
  };
  row.finalScore = round(
    row.weakness +
      row.incidence +
      row.tier +
      row.coverageNeed +
      row.reviewDebt +
      row.lsAlignment +
      row.targetFit +
      row.overlapValue +
      row.deadlinePressure +
      row.bancaFit -
      row.balancePenalty -
      row.lowTrustPenalty,
  );
  return row;
}

function chooseCandidate(
  scoreboard: StudyScoreboardRow[],
  chosenKeys: Set<string>,
  dailyCounts: Map<string, number>,
  kind: StudyBlockKind,
  excludedKeys = new Set<string>(),
): StudyScoreboardRow | undefined {
  const eligible = scoreboard.filter((row) => row.kind === kind && !chosenKeys.has(row.candidateKey) && !excludedKeys.has(row.candidateKey));
  const trusted = eligible.filter((row) => row.lowTrustPenalty === 0);
  const pool = trusted.length > 0 ? trusted : [];
  const balanced = pool.filter((row) => (dailyCounts.get(row.discipline) || 0) < MAX_DISCIPLINE_PER_DAY);
  return balanced[0] || pool[0];
}

function scoreboardRowToBlock(row: StudyScoreboardRow, index: number): DailyStudyBlock {
  return {
    id: `study-block-${index + 1}-${row.candidateKey}`,
    kind: row.kind,
    targetSlug: row.targetSlug,
    discipline: row.discipline,
    topic: row.topic,
    materialHint: row.materialHint,
    durationMinutes: row.kind === 'theory' ? 60 : row.kind === 'questions' ? 55 : 45,
    plannedQuestions: row.plannedQuestions,
    finalScore: row.finalScore,
    sourceReason: [
      `fraqueza ${row.weakness}`,
      `incidência ${row.incidence}`,
      `cobertura ${row.coverageNeed}`,
      row.lsAlignment ? `alinhado à fonte ${row.lsAlignment}` : '',
    ].filter(Boolean),
    linkedSourceItems: [],
    scoreBreakdown: {
      weakness: row.weakness,
      incidence: row.incidence,
      tier: row.tier,
      coverageNeed: row.coverageNeed,
      reviewDebt: row.reviewDebt,
      lsAlignment: row.lsAlignment,
      targetFit: row.targetFit,
      overlapValue: row.overlapValue,
      deadlinePressure: row.deadlinePressure,
      bancaFit: row.bancaFit,
      balancePenalty: row.balancePenalty,
      lowTrustPenalty: row.lowTrustPenalty,
      finalScore: row.finalScore,
    },
  };
}

function blockDescription(block: DailyStudyBlock): string {
  if (block.kind === 'questions') {
    return `Resolver questões TEC: ${block.topic}`;
  }
  if (block.kind === 'review') {
    return `Corrigir erros e provar correção: ${block.topic}`;
  }
  return `Estudar ou reler bloco médio: ${block.topic}`;
}

function targetRows<T extends { targetSlug: string }>(rows: T[], targetSlug: string): T[] {
  const normalized = normalizeTargetSlug(targetSlug);
  return rows.filter((row) => row.targetSlug === normalized || (normalized !== 'legacy' && row.targetSlug === 'shared'));
}

function sourceKindToBlockKind(item: StudySourceItem): StudyBlockKind {
  if (item.sourceKind === 'tec_incidence') return 'questions';
  if (item.sourceKind === 'guia_andrety') return 'review';
  return 'theory';
}

function weaknessRaw(candidate: Candidate, rows: TopicFeedback[]): number {
  const exact = rows
    .filter((row) => sameDiscipline(row, candidate) && topicMatches(candidate.topic, row.topic))
    .map((row) => row.weaknessScore);
  if (exact.length > 0) return clamp(Math.max(...exact), 0, 10);
  const discipline = rows.filter((row) => sameDiscipline(row, candidate)).map((row) => row.weaknessScore / 2);
  return clamp(Math.max(0, ...discipline), 0, 10);
}

function incidenceRaw(candidate: Candidate, coverageRows: StudyCoverageRow[], sourceItems: StudySourceItem[]): number {
  const coverageMatch = findCoverage(candidate, coverageRows);
  if (coverageMatch?.incidence) return clamp(coverageMatch.incidence, 0, 10);
  const sourceMatch = sourceItems.find((item) => sameDiscipline(item, candidate) && topicMatches(candidate.topic, item.topic));
  return clamp(sourceMatch?.incidence || 0, 0, 10);
}

function editalWeightRaw(candidate: Candidate, coverageRows: StudyCoverageRow[], phase: StudyPlanPhase): number {
  if (phase !== 'pos_edital') return 1;
  const exact = findCoverage(candidate, coverageRows);
  if (exact?.editalWeight) return Math.max(0.1, exact.editalWeight);
  const discipline = coverageRows.find((row) => sameDiscipline(row, candidate));
  return Math.max(0.1, discipline?.editalWeight || 1);
}

function tierRaw(candidate: Candidate, coverageRows: StudyCoverageRow[]): number {
  const tier = findCoverage(candidate, coverageRows)?.tier || 3;
  return { 1: 10, 2: 7, 3: 4 }[tier as 1 | 2 | 3] || 4;
}

function coverageRaw(candidate: Candidate, coverageRows: StudyCoverageRow[]): number {
  const status = findCoverage(candidate, coverageRows)?.status || 'stale';
  return {
    unread: 10,
    weak: 8,
    stale: 6,
    strong: 1,
  }[status];
}

function lsAlignmentRaw(candidate: Candidate, sourceItems: StudySourceItem[]): number {
  const aligned = sourceItems.find(
    (item) =>
      item.sourceKind === 'ls' &&
      sameDiscipline(item, candidate) &&
      topicMatches(candidate.topic, item.topic) &&
      item.sourceTrust > 0,
  );
  return aligned ? clamp(aligned.sourceTrust, 0, 10) : 0;
}

function targetFitRaw(candidate: Candidate, targetSlug: string): number {
  if (candidate.sourceTargetSlug === targetSlug) return 10;
  if (candidate.sourceTargetSlug === 'shared') return 6;
  return 0;
}

function overlapValueRaw(candidate: Candidate, targetSlug: string): number {
  if (candidate.sourceTargetSlug === 'shared') return 6;
  if (candidate.sourceTargetSlug === targetSlug) return 10;
  return 0;
}

function bancaFitRaw(candidate: Candidate, targetProfile?: ExamTargetProfile): number {
  const organizer = normalize(targetProfile?.organizer || '');
  if (!organizer) return 5;
  const hint = normalize(candidate.materialHint);
  if (hint.includes(organizer)) return 10;
  if (hint.includes('tec') || hint.includes('questoes')) return 6;
  return targetProfile?.bancaFit || 5;
}

function findCoverage(candidate: Candidate, rows: StudyCoverageRow[]): StudyCoverageRow | undefined {
  return rows.find((row) => sameDiscipline(row, candidate) && topicMatches(candidate.topic, row.topic));
}

function sameDiscipline(left: { discipline: string }, right: { discipline: string }): boolean {
  return normalize(left.discipline) === normalize(right.discipline);
}

function topicMatches(left: string, right: string): boolean {
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  return Boolean(leftNorm && rightNorm && (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)));
}

function candidateKey(prefix: string, index: number, discipline: string, topic: string, kind: StudyBlockKind, source: string): string {
  return [prefix, index, normalize(discipline), normalize(topic), kind, normalize(source)].join(':');
}

function isLowTrust(value: string): boolean {
  const normalized = normalize(value);
  return normalized.includes('bizu') || normalized.includes('dicas');
}

function toCoverageStatus(value: string | undefined): CoverageStatus {
  const normalized = normalize(value || '');
  if (normalized === 'strong' || normalized === 'stale' || normalized === 'weak' || normalized === 'unread') {
    return normalized;
  }
  return 'stale';
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value || '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: string | undefined): boolean {
  const normalized = normalize(value || '');
  return ['1', 'true', 'yes', 'sim', 's', 'y'].includes(normalized);
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

function parseUrls(value: string | undefined): string[] {
  return String(value || '')
    .split(/[,;]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function tableCell(value: string | number): string {
  return String(value ?? '').replace(/\|/g, '/').trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeTargetSlug(value: string): string {
  return String(value || 'legacy').trim().toLowerCase() || 'legacy';
}

function parseIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

function toIsoDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function candidateKeyFromBlockId(blockId: string): string {
  return blockId.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^study-block-\d+-/, '');
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
