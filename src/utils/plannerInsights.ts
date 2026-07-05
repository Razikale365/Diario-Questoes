import { PlannerMetaHistoryEntry, PlannerTask } from '../types';

export type PlannerLoadState = 'overloaded' | 'balanced' | 'underloaded' | 'neglected' | 'new';
export type PlannerTrend = 'up' | 'down' | 'steady' | 'new';

export interface PlannerDisciplineInsight {
  discipline: string;
  currentTasks: number;
  currentMinutes: number;
  pendingTasks: number;
  highRelevancePending: number;
  averageRelevance: number;
  historyAppearances: number;
  historicalAverageTasks: number;
  historicalAverageMinutes: number;
  loadState: PlannerLoadState;
  trend: PlannerTrend;
  recommendation: string;
}

export interface PlannerInsights {
  totalMinutes: number;
  highRelevancePending: number;
  overloadedCount: number;
  neglectedCount: number;
  repeatedDisciplines: number;
  disciplineInsights: PlannerDisciplineInsight[];
  recommendations: string[];
}

const round = (value: number) => Math.round(value);

const average = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const uniqueDisciplines = (tasks: PlannerTask[], history: PlannerMetaHistoryEntry[]) => {
  const disciplines = new Set<string>();
  tasks.forEach((task) => disciplines.add(task.discipline));
  history.forEach((entry) => entry.tasks.forEach((task) => disciplines.add(task.discipline)));
  return Array.from(disciplines).sort();
};

const describeLoad = (
  discipline: string,
  state: PlannerLoadState,
  pendingTasks: number,
  highRelevancePending: number,
  currentMinutes: number,
) => {
  if (state === 'overloaded') {
    return `Quebrar ${discipline}: carga alta (${round(currentMinutes / 60)}h) pede execução em blocos menores.`;
  }
  if (state === 'neglected') {
    return `Reavaliar ${discipline}: apareceu nas metas anteriores e sumiu da atual.`;
  }
  if (state === 'underloaded') {
    return `Adicionar revisão curta em ${discipline}: relevância alta com pouca carga planejada.`;
  }
  if (highRelevancePending > 0) {
    return `Priorizar ${discipline}: ${highRelevancePending} pendente(s) de relevância alta.`;
  }
  if (pendingTasks > 0) {
    return `Executar ${discipline} sem expandir escopo: pendências cabem na meta atual.`;
  }
  return `Manter ${discipline}: carga equilibrada para esta meta.`;
};

export const buildPlannerInsights = (
  currentTasks: PlannerTask[],
  history: PlannerMetaHistoryEntry[],
  currentMetaId?: string,
): PlannerInsights => {
  const activeCurrentTasks = currentTasks.filter((task) => task.status !== 'archived');
  const pastHistory = history
    .filter((entry) => entry.id !== currentMetaId)
    .map((entry) => ({
      ...entry,
      tasks: entry.tasks.filter((task) => task.status !== 'archived'),
    }));
  const currentByDiscipline = new Map<string, PlannerTask[]>();

  activeCurrentTasks.forEach((task) => {
    currentByDiscipline.set(task.discipline, [...(currentByDiscipline.get(task.discipline) || []), task]);
  });

  const disciplineInsights = uniqueDisciplines(activeCurrentTasks, pastHistory).map((discipline) => {
    const tasks = currentByDiscipline.get(discipline) || [];
    const historicalEntries = pastHistory
      .map((entry) => entry.tasks.filter((task) => task.discipline === discipline))
      .filter((items) => items.length > 0);
    const historicalTaskCounts = historicalEntries.map((items) => items.length);
    const historicalMinuteCounts = historicalEntries.map((items) =>
      items.reduce((sum, task) => sum + task.durationMinutes, 0)
    );

    const currentMinutes = tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const pendingTasks = tasks.filter((task) => task.status === 'pending' || task.status === 'started').length;
    const highRelevancePending = tasks.filter(
      (task) => (task.status === 'pending' || task.status === 'started') && task.relevance >= 9
    ).length;
    const averageRelevance = round(average(tasks.map((task) => task.relevance)));
    const historicalAverageTasks = round(average(historicalTaskCounts));
    const historicalAverageMinutes = round(average(historicalMinuteCounts));
    const historyAppearances = historicalEntries.length;

    let trend: PlannerTrend = 'steady';
    if (historyAppearances === 0) {
      trend = tasks.length > 0 ? 'new' : 'steady';
    } else if (tasks.length >= historicalAverageTasks + 2) {
      trend = 'up';
    } else if (tasks.length <= Math.max(0, historicalAverageTasks - 2)) {
      trend = 'down';
    }

    let loadState: PlannerLoadState = 'balanced';
    if (tasks.length === 0 && historyAppearances >= 1) {
      loadState = 'neglected';
    } else if (historyAppearances === 0 && tasks.length > 0) {
      loadState = 'new';
    } else if (currentMinutes >= Math.max(180, historicalAverageMinutes * 1.5) || tasks.length >= Math.max(4, historicalAverageTasks + 2)) {
      loadState = 'overloaded';
    } else if (averageRelevance >= 8 && pendingTasks > 0 && currentMinutes < 60) {
      loadState = 'underloaded';
    }

    return {
      discipline,
      currentTasks: tasks.length,
      currentMinutes,
      pendingTasks,
      highRelevancePending,
      averageRelevance,
      historyAppearances,
      historicalAverageTasks,
      historicalAverageMinutes,
      loadState,
      trend,
      recommendation: describeLoad(discipline, loadState, pendingTasks, highRelevancePending, currentMinutes),
    };
  });

  const sortedInsights = disciplineInsights.sort((a, b) => {
    const priority = (item: PlannerDisciplineInsight) => {
      if (item.loadState === 'overloaded') return 0;
      if (item.highRelevancePending > 0) return 1;
      if (item.loadState === 'underloaded') return 2;
      if (item.loadState === 'neglected') return 3;
      return 4;
    };
    return priority(a) - priority(b) || b.highRelevancePending - a.highRelevancePending || b.averageRelevance - a.averageRelevance;
  });

  const recommendations = sortedInsights
    .filter((item) => item.loadState !== 'balanced' || item.highRelevancePending > 0)
    .slice(0, 5)
    .map((item) => item.recommendation);

  return {
    totalMinutes: activeCurrentTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
    highRelevancePending: activeCurrentTasks.filter(
      (task) => (task.status === 'pending' || task.status === 'started') && task.relevance >= 9
    ).length,
    overloadedCount: sortedInsights.filter((item) => item.loadState === 'overloaded').length,
    neglectedCount: sortedInsights.filter((item) => item.loadState === 'neglected').length,
    repeatedDisciplines: sortedInsights.filter((item) => item.historyAppearances >= 1 && item.currentTasks > 0).length,
    disciplineInsights: sortedInsights,
    recommendations,
  };
};
