import type { PlannerTaskStatus } from '../types';

export interface PlannerTaskActionAvailability {
  canExecute: boolean;
  canRecordResult: boolean;
}

export const plannerTaskActionAvailability = (status: PlannerTaskStatus): PlannerTaskActionAvailability => {
  const terminal = status === 'completed' || status === 'archived';
  return { canExecute: !terminal, canRecordResult: !terminal };
};

export const plannerTaskPerformanceLabel = (performance: number | null): string => (
  performance === null
    ? 'Sem evidência'
    : `${performance.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
);
