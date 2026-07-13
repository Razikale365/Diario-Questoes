import type {
  PlannerSourceAlternative,
  PlannerSourceChoice,
  PlannerSourceContentRole,
  PlannerStrategySourceKind,
} from '../api/planner';
import type {
  StrategyMappingStatus,
  StrategyPackageStatus,
  StrategyTransferKind,
  StrategyWorkbench,
  StrategyWorkbenchItem,
  StrategyWorkbenchMapping,
} from '../api/strategy';

export interface StrategyMappingDraft {
  targetTopicId: number | null;
  expectedVersion: number;
  expectedSourceVersion: number;
  sourceTrustTier: number;
  mappingStatus: StrategyMappingStatus;
  transferKind: StrategyTransferKind;
  confidenceBp: number;
  primaryEligible: boolean;
  notes: string;
}

export interface StrategyWorkbenchRow {
  item: StrategyWorkbenchItem;
  activeMapping: StrategyWorkbenchMapping | null;
  draft: StrategyMappingDraft;
}

export interface SourceAlternativeView {
  rowId: number;
  label: string;
  displayName: string;
  score: number;
  decision: string;
}

export interface SourceChoiceView {
  label: string;
  displayName: string;
  reason: string;
  shortfall: boolean;
  alternatives: SourceAlternativeView[];
}

const sourceLabels: Record<PlannerStrategySourceKind, string> = {
  course: 'Curso',
  passo: 'Passo',
  trilha: 'Trilha',
  ls: 'LS',
  andrety: 'Andréty',
  tec: 'TEC',
  manual: 'Manual',
};

const roleLabels: Record<PlannerSourceContentRole, string> = {
  primary_theory: 'Teoria original',
  review_support: 'Apoio de revisão',
  question_practice: 'Questões',
  schedule_advice: 'Ordem sugerida',
  incidence_signal: 'Incidência',
};

const targetLabels: Record<string, string> = {
  bacen_economia_financas: 'BACEN',
  rfb_auditor: 'RFB Auditor',
  rfb_analista: 'RFB Analista',
  sefaz_ce: 'SEFAZ CE',
};

export const sourceKindLabel = (kind: PlannerStrategySourceKind) => sourceLabels[kind];

export const contentRoleLabel = (role: PlannerSourceContentRole) => roleLabels[role];

const mappingRank = (mapping: StrategyWorkbenchMapping) => {
  if (mapping.manualOverride && mapping.mappingStatus === 'approved') return 0;
  if (mapping.mappingStatus === 'approved') return 1;
  if (mapping.mappingStatus === 'proposed') return 2;
  return 3;
};

const activeMapping = (item: StrategyWorkbenchItem) => (
  [...item.mappings].sort((left, right) => (
    mappingRank(left) - mappingRank(right)
      || right.confidenceBp - left.confidenceBp
      || left.id - right.id
  ))[0] || null
);

export const buildStrategyWorkbenchRows = (
  workbench: StrategyWorkbench,
): StrategyWorkbenchRow[] => {
  const stateRank = { unresolved: 0, proposed: 1, rejected: 2, approved: 3 };
  return [...workbench.items]
    .sort((left, right) => (
      stateRank[left.resolutionState] - stateRank[right.resolutionState]
        || left.discipline.localeCompare(right.discipline, 'pt-BR')
        || left.sourceOrder - right.sourceOrder
        || left.sourceItemId - right.sourceItemId
    ))
    .map((item) => {
      const mapping = activeMapping(item);
      return {
        item,
        activeMapping: mapping,
        draft: {
          targetTopicId: mapping?.targetTopicId ?? null,
          expectedVersion: mapping?.version ?? 0,
          expectedSourceVersion: item.sourceVersion,
          sourceTrustTier: item.trustTier,
          mappingStatus: mapping?.mappingStatus ?? 'approved',
          transferKind: mapping?.transferKind ?? (
            item.sourceTargetSlug === workbench.targetSlug ? 'target_specific' : 'shared'
          ),
          confidenceBp: mapping?.confidenceBp ?? 10000,
          primaryEligible: mapping?.primaryEligible ?? false,
          notes: mapping?.notes ?? '',
        },
      };
    });
};

export const packageStatusView = (
  status: StrategyPackageStatus,
  targetSlug: string,
) => {
  const target = targetLabels[targetSlug] || targetSlug;
  if (status.validated) {
    return {
      tone: 'success' as const,
      title: 'Pacote validado',
      detail: `${status.packageName || target} · ${status.observedFileCount ?? 0} PDFs · manifesto íntegro`,
    };
  }
  if (status.state === 'downloaded') {
    return {
      tone: 'warning' as const,
      title: 'Download sem validação',
      detail: `${target}: valide contagem, falhas e manifesto antes de aprovar fontes primárias.`,
    };
  }
  if (status.state === 'selected' || status.state === 'candidate') {
    return {
      tone: 'warning' as const,
      title: 'Pacote ainda não baixado',
      detail: `${target}: conclua o download fresco e registre o manifesto para liberar os PDFs.`,
    };
  }
  return {
    tone: 'warning' as const,
    title: 'Pacote ausente',
    detail: `${target}: selecione e baixe um pacote próprio deste alvo antes de usar material como fonte primária.`,
  };
};

const percent = (basisPoints: number) => `${Math.round(basisPoints / 100)}%`;

const alternativeDecision = (alternative: PlannerSourceAlternative) => {
  if (alternative.stopReason) return `Bloqueado: ${alternative.stopReason.replaceAll('_', ' ')}`;
  if (alternative.displacedByRowId) return 'Deslocado pela fonte escolhida';
  return alternative.chosen ? 'Escolhida' : 'Alternativa auditada';
};

export const buildSourceChoiceView = (
  choice: PlannerSourceChoice | null | undefined,
): SourceChoiceView => {
  if (!choice) {
    return {
      label: 'Fonte legada',
      displayName: 'Sem escolha M6 persistida',
      reason: 'O bloco foi criado antes da seleção auditável de fontes.',
      shortfall: false,
      alternatives: [],
    };
  }
  const alternatives = choice.alternatives
    .filter((item) => !item.chosen)
    .sort((left, right) => right.finalScore - left.finalScore)
    .map((item) => ({
      rowId: item.choiceRowId,
      label: sourceKindLabel(item.evidence.sourceKind),
      displayName: item.evidence.displayName,
      score: item.finalScore,
      decision: alternativeDecision(item),
    }));
  if (choice.status === 'shortfall') {
    return {
      label: 'Fonte pendente',
      displayName: choice.shortfallReason?.replaceAll('_', ' ') || 'Nenhuma fonte executável',
      reason: 'O planejador preservou a lacuna em vez de improvisar uma fonte.',
      shortfall: true,
      alternatives,
    };
  }
  const evidence = choice.evidence;
  return {
    label: sourceKindLabel(choice.sourceKind),
    displayName: choice.displayName,
    reason: [
      `alvo ${percent(evidence.targetFitBp)}`,
      `confiança ${percent(evidence.transferConfidenceBp)}`,
      `atualidade ${percent(evidence.freshnessBp)}`,
      `banca ${percent(evidence.bancaFitBp)}`,
      contentRoleLabel(choice.contentRole),
    ].join(' · '),
    shortfall: false,
    alternatives,
  };
};
