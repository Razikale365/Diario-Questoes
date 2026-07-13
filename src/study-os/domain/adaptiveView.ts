import type { ReviewQueueItem } from '../api/learning';
import type { PlannerWeek, PlannerWeekSlot } from '../api/planner';

export interface AdaptiveWeekColumn {
  date: string;
  selected: boolean;
  slots: PlannerWeekSlot[];
}

const parseDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('Invalid planner date');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new TypeError('Invalid planner date');
  return parsed;
};

const isoDate = (value: Date) => value.toISOString().slice(0, 10);

export function shiftPlannerDate(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function getPlannerWeekStart(value: string): string {
  const date = parseDate(value);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return isoDate(date);
}

export function buildAdaptiveWeekColumns(
  week: PlannerWeek,
  selectedDate: string,
): AdaptiveWeekColumn[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftPlannerDate(week.run.weekStart, index);
    return {
      date,
      selected: date === selectedDate,
      slots: week.slots
        .filter((slot) => slot.date === date)
        .sort((left, right) => left.position - right.position),
    };
  });
}

const adaptationLabels: Record<string, string> = {
  weekly_forecast_follow: 'Segue a previsão semanal',
  weekly_diverged_current_evidence: 'Mudou com evidência nova',
  profile_fallback: 'Perfil e cobertura atuais',
  stale_return: 'Conteúdo voltou por desatualização',
  bounded_review_due: 'Revisão curta vencida',
  resume_partial: 'Retoma de onde parou',
  cooldown_after_success: 'Sucesso recente reduziu prioridade',
  projected_weakness: 'Fraqueza confirmada pelo desempenho',
  projected_state: 'Estado de aprendizagem projetado',
};

export const adaptationReasonLabel = (reason: string): string => (
  adaptationLabels[reason] || 'Ajuste adaptativo'
);

export const reviewReasonLabel = (reason: string): string => {
  const normalized = reason.trim().replaceAll('_', ' ');
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Evidência recente';
};

export const reviewDueStatus = (
  dueDate: string,
  asOf: string,
): 'overdue' | 'today' | 'future' => {
  parseDate(dueDate);
  parseDate(asOf);
  if (dueDate < asOf) return 'overdue';
  if (dueDate === asOf) return 'today';
  return 'future';
};

export const reviewQueueProof = (item: ReviewQueueItem): string => {
  const evidenceLabel = item.triggerEventIds.length === 1 ? 'evidência' : 'evidências';
  return `${item.boundedQuestions} questões · dívida ${Math.round(item.debtBp / 100)}% · ${item.triggerEventIds.length} ${evidenceLabel}`;
};
