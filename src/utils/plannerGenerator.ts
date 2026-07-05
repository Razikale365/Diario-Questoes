import { PlannerMetaHistoryEntry, PlannerTask } from '../types';
import { buildPlannerInsights, PlannerDisciplineInsight } from './plannerInsights';

export type PlannerDraftReason = 'carry-pending' | 'rebalance' | 'retake' | 'maintenance';

export interface PlannerDraftTask {
  discipline: string;
  format: string;
  description: string;
  durationMinutes: number;
  relevance: number;
  reason: PlannerDraftReason;
  sourceTaskId?: string;
}

export interface PlannerDraft {
  tasks: PlannerDraftTask[];
  totalMinutes: number;
  totalTasks: number;
  allocations: Array<{
    discipline: string;
    tasks: number;
    minutes: number;
    relevance: number;
  }>;
  warnings: string[];
}

export interface PlannerDraftConfig {
  weeklyHours: number;
  maxTasks: number;
  currentMetaId?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const plannerDraftTaskKey = (task: PlannerDraftTask) =>
  `${task.reason}:${task.discipline.toLowerCase()}:${task.description.toLowerCase()}`;

const pendingPriority = (task: PlannerTask) => {
  const statusBoost = task.status === 'started' ? 8 : 0;
  return task.relevance * 10 + statusBoost + Math.min(10, Math.round(task.durationMinutes / 30));
};

const insightPriority = (insight: PlannerDisciplineInsight) => {
  if (insight.loadState === 'underloaded') return 90 + insight.averageRelevance;
  if (insight.loadState === 'neglected') return 80 + insight.historicalAverageTasks;
  if (insight.highRelevancePending > 0) return 70 + insight.highRelevancePending;
  if (insight.historyAppearances > 0) return 40 + insight.averageRelevance;
  return 10;
};

const buildGeneratedTask = (
  discipline: string,
  reason: PlannerDraftReason,
  description: string,
  durationMinutes: number,
  relevance: number,
): PlannerDraftTask => ({
  discipline,
  format: reason === 'retake' ? 'Revisão' : 'Revisão e Exercícios',
  description,
  durationMinutes,
  relevance,
  reason,
});

const fitDraft = (tasks: PlannerDraftTask[], maxMinutes: number, maxTasks: number) => {
  const accepted: PlannerDraftTask[] = [];
  let usedMinutes = 0;

  for (const task of tasks) {
    if (accepted.length >= maxTasks) break;
    if (usedMinutes + task.durationMinutes > maxMinutes) continue;
    accepted.push(task);
    usedMinutes += task.durationMinutes;
  }

  return accepted;
};

export const materializeDraftTasks = (
  draftTasks: PlannerDraftTask[],
  options: { planejamento?: string; metaNumber?: number } = {},
): PlannerTask[] => {
  const now = new Date().toISOString();
  return draftTasks.map((task, index) => ({
    id: `generated_${Date.now()}_${index}_${task.discipline.replace(/\W+/g, '_').toLowerCase()}`,
    number: index + 1,
    metaNumber: options.metaNumber,
    planejamento: options.planejamento || 'Planner Gerado',
    discipline: task.discipline,
    format: task.format,
    description: task.description,
    spentMinutes: 0,
    estimatedMinutes: task.durationMinutes,
    performance: null,
    status: 'pending',
    relevance: task.relevance,
    durationMinutes: task.durationMinutes,
    source: 'generated',
    sourceTaskId: task.sourceTaskId,
    createdAt: now,
    updatedAt: now,
  } as PlannerTask));
};

export const summarizeDraftTasks = (tasks: PlannerDraftTask[], warnings: string[] = []): PlannerDraft => {
  const totalMinutes = tasks.reduce((sum, task) => sum + task.durationMinutes, 0);
  const allocationMap = new Map<string, { discipline: string; tasks: number; minutes: number; relevanceTotal: number }>();

  tasks.forEach((task) => {
    const current = allocationMap.get(task.discipline) || {
      discipline: task.discipline,
      tasks: 0,
      minutes: 0,
      relevanceTotal: 0,
    };
    allocationMap.set(task.discipline, {
      ...current,
      tasks: current.tasks + 1,
      minutes: current.minutes + task.durationMinutes,
      relevanceTotal: current.relevanceTotal + task.relevance,
    });
  });

  return {
    tasks,
    totalMinutes,
    totalTasks: tasks.length,
    allocations: Array.from(allocationMap.values())
      .map((item) => ({
        discipline: item.discipline,
        tasks: item.tasks,
        minutes: item.minutes,
        relevance: Math.round(item.relevanceTotal / Math.max(1, item.tasks)),
      }))
      .sort((a, b) => b.minutes - a.minutes || b.relevance - a.relevance),
    warnings,
  };
};

export const generateNextMetaDraft = (
  currentTasks: PlannerTask[],
  history: PlannerMetaHistoryEntry[],
  config: PlannerDraftConfig,
): PlannerDraft => {
  const maxMinutes = clamp(config.weeklyHours, 1, 120) * 60;
  const maxTasks = clamp(config.maxTasks, 1, 80);
  const insights = buildPlannerInsights(currentTasks, history, config.currentMetaId);
  const candidates: Array<{ task: PlannerDraftTask; priority: number }> = [];

  currentTasks
    .filter((task) => task.status === 'pending' || task.status === 'started')
    .sort((a, b) => pendingPriority(b) - pendingPriority(a))
    .forEach((task) => {
      candidates.push({
        priority: 100 + pendingPriority(task),
        task: {
          discipline: task.discipline,
          format: task.format,
          description: `Pendência da meta atual: ${task.description}`,
          durationMinutes: clamp(task.durationMinutes || 60, 30, 180),
          relevance: task.relevance,
          reason: 'carry-pending',
          sourceTaskId: task.id,
        },
      });
    });

  insights.disciplineInsights.forEach((insight) => {
    if (insight.loadState === 'underloaded') {
      candidates.push({
        priority: insightPriority(insight),
        task: buildGeneratedTask(
          insight.discipline,
          'rebalance',
          `Revisão curta + questões para reforçar relevância ${insight.averageRelevance || 8}`,
          60,
          clamp(insight.averageRelevance || 8, 7, 10),
        ),
      });
    }

    if (insight.loadState === 'neglected') {
      candidates.push({
        priority: insightPriority(insight),
        task: buildGeneratedTask(
          insight.discipline,
          'retake',
          'Retomada mínima: revisar erros/lei seca antes de a disciplina esfriar',
          60,
          8,
        ),
      });
    }

    if (insight.currentTasks === 0 && insight.historyAppearances > 0 && insight.loadState !== 'neglected') {
      candidates.push({
        priority: 35 + insight.historyAppearances,
        task: buildGeneratedTask(
          insight.discipline,
          'maintenance',
          'Manutenção leve baseada no padrão histórico da LS',
          45,
          7,
        ),
      });
    }
  });

  const deduped = new Map<string, { task: PlannerDraftTask; priority: number }>();
  candidates.forEach((candidate) => {
    const key = plannerDraftTaskKey(candidate.task);
    const previous = deduped.get(key);
    if (!previous || candidate.priority > previous.priority) {
      deduped.set(key, candidate);
    }
  });

  const sorted = Array.from(deduped.values())
    .sort((a, b) => b.priority - a.priority)
    .map((candidate) => candidate.task);
  const tasks = fitDraft(sorted, maxMinutes, maxTasks);
  const totalMinutes = tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

  const warnings: string[] = [];
  const dropped = sorted.length - tasks.length;
  if (dropped > 0) {
    warnings.push(`${dropped} sugestão(ões) ficaram fora por limite de carga/tarefas.`);
  }
  if (totalMinutes < maxMinutes * 0.6 && sorted.length > tasks.length) {
    warnings.push('A carga ficou baixa porque as tarefas restantes não cabiam nos limites definidos.');
  }

  return summarizeDraftTasks(tasks, warnings);
};
