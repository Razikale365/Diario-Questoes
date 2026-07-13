import type { PlannerBlock, PlannerRun } from '../api/planner';
import { adaptationReasonLabel } from './adaptiveView';

export interface PlannerBlockView {
  kindLabel: string;
  statusLabel: string;
  commandLabel: string;
  whyNow: string;
  sourceLabel: string;
}

const kindLabels: Record<PlannerBlock['blockKind'], string> = {
  theory: 'Teoria',
  questions: 'Questões',
  review: 'Revisão',
};

const statusLabels: Record<PlannerBlock['state'], string> = {
  pending: 'Pendente',
  active: 'Em andamento',
  completed: 'Concluído',
  skipped: 'Pulado',
  failed: 'Falhou',
};

const sourceLabels: Record<string, string> = {
  course: 'Curso original',
  tec: 'TEC externo',
  ls: 'Alinhamento LS',
  trilha: 'Trilha Estratégica',
  manual: 'Perfil manual',
  bizu: 'Dicas/Bizus · apoio',
};

const commandLabels: Record<PlannerBlock['blockKind'], string> = {
  theory: 'Abrir leitura',
  questions: 'Abrir TEC',
  review: 'Corrigir e provar',
};

const scorePercent = (value: number) => Math.round(value / 100);

export function buildBlockView(block: PlannerBlock): PlannerBlockView {
  const score = block.scoreBreakdown;
  const reasons: string[] = [];
  if (block.adaptationReason) reasons.push(adaptationReasonLabel(block.adaptationReason));
  if (block.blockKind === 'review' && score?.reviewDebt) {
    reasons.push(`revisão ${scorePercent(score.reviewDebt)}%`);
  }
  if (score?.weakness) reasons.push(`fraqueza ${scorePercent(score.weakness)}%`);
  if (score?.incidence) reasons.push(`incidência ${scorePercent(score.incidence)}%`);
  if (score?.deadlinePressure) reasons.push(`prazo ${scorePercent(score.deadlinePressure)}%`);
  if (score?.editalWeight && score.editalWeight > 1000) {
    reasons.push(`peso ${(score.editalWeight / 1000).toFixed(1)}`);
  }

  return {
    kindLabel: kindLabels[block.blockKind],
    statusLabel: statusLabels[block.state],
    commandLabel: commandLabels[block.blockKind],
    whyNow: reasons.slice(0, 3).join(' · ') || 'melhor evidência executável disponível',
    sourceLabel: sourceLabels[block.sourceKind || 'manual'] || String(block.sourceKind || 'Fonte local'),
  };
}

export function buildShortfallGuidance(run: PlannerRun): string[] {
  return run.shortfallReasons.map((reason) => {
    if (reason.includes('theory')) {
      return 'Vincule uma aula e um PDF original disponível a pelo menos um tópico.';
    }
    if (reason.includes('review')) {
      return 'Registre erros, dúvidas, favoritos ou dívida de revisão em um tópico.';
    }
    if (reason.includes('questions')) {
      return 'Informe um caderno ou fluxo externo do TEC para mais tópicos.';
    }
    return reason;
  });
}
