import type { PlannerTask, PlannerTaskBlockKind, PlannerTaskSource } from '../types';
import { mergePlannerTasks } from '../utils/planner';
import type { SourcePlanTask, SourcePlanTaskInput, SprintSourceTaskKind } from './api/sprint';


const textValue = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const plannerSource = (task: SourcePlanTask): PlannerTaskSource => {
  const stored = task.provenance.plannerSource;
  if (stored === 'ls-meta-text' || stored === 'ls-meta-pdf' || stored === 'manual' || stored === 'generated') {
    return stored;
  }
  return task.sourceKind === 'manual' ? 'manual' : 'ls-meta-text';
};

const blockKind = (task: SourcePlanTask): PlannerTaskBlockKind | undefined => {
  if (task.taskKind === 'theory' || task.taskKind === 'questions' || task.taskKind === 'review') {
    return task.taskKind;
  }
  return undefined;
};

const calendarDate = (task: SourcePlanTask): string | undefined => {
  if (!task.scheduledDate || task.backlog) return undefined;
  if (task.cycle && task.scheduledDate > task.cycle.endsOn) return undefined;
  return task.scheduledDate;
};

const fallbackTimestamp = (scheduledDate: string | undefined) =>
  scheduledDate ? `${scheduledDate}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';

export const sourceTaskKind = (task: PlannerTask): SprintSourceTaskKind => {
  if (task.plannedBlockKind) return task.plannedBlockKind;
  const text = `${task.discipline} ${task.format} ${task.description}`.toLocaleLowerCase('pt-BR');
  if (text.includes('simulad')) return 'simulation';
  if (text.includes('discurs')) return 'discursive';
  if (text.includes('revis')) return 'review';
  if (text.includes('quest')) return 'questions';
  if (text.includes('pdf') || text.includes('teoria') || text.includes('leitura')) return 'theory';
  return 'mixed';
};

export const externalSourceTaskId = (task: PlannerTask): string => {
  const lsSource = task.plannerSourceKind === 'ls' || task.source.startsWith('ls-meta-');
  if (!lsSource || task.metaNumber === undefined || task.number < 0) return task.id;
  const target = (task.targetSlug || 'sefaz_ce').replaceAll('_', '-');
  return `ls-${target}-meta-${task.metaNumber}-task-${task.number}`;
};

export const sourcePlanTaskInput = (task: PlannerTask): SourcePlanTaskInput => ({
  externalTaskId: externalSourceTaskId(task),
  scheduledDate: task.scheduledDate || null,
  sourceOrder: task.number,
  discipline: task.discipline,
  topicHint: task.description,
  taskKind: sourceTaskKind(task),
  description: task.description,
  details: task.details || '',
  materialHint: task.materialHint || '',
  estimatedMinutes: Math.max(1, task.durationMinutes || task.estimatedMinutes || 60),
  spentMinutes: Math.max(0, task.spentMinutes || 0),
  relevance: Math.max(0, Math.min(10, task.relevance)),
  status: task.status === 'failed' ? 'pending' : task.status,
  performanceBp: task.performance === null
    ? null
    : Math.max(0, Math.min(10000, Math.round(task.performance * 100))),
  linkedStudyTaskId: task.linkedStudyTaskId || null,
  provenance: {
    origin: 'planner-local-sync',
    browserTaskId: task.id,
    plannerSource: task.source,
    planejamento: task.planejamento || '',
    metaNumber: task.metaNumber ?? null,
    startTime: task.startTime || null,
    format: task.format,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    plannedQuestions: task.plannedQuestions ?? null,
    tecUrl: task.sourceUrl || null,
    lastOutcome: task.lastOutcome || null,
  },
});

export const currentSourcePlanTasks = (tasks: SourcePlanTask[]): SourcePlanTask[] => {
  const numbered = tasks.filter((task) => task.metaNumber !== null);
  if (numbered.length === 0) return tasks;
  const latestMeta = Math.max(...numbered.map((task) => task.metaNumber as number));
  return numbered.filter((task) => task.metaNumber === latestMeta);
};

const latestLsMeta = (tasks: PlannerTask[]): number | null => {
  const metas = tasks
    .filter((task) => task.plannerSourceKind === 'ls' || task.source.startsWith('ls-meta-'))
    .map((task) => task.metaNumber)
    .filter((value): value is number => value !== undefined);
  return metas.length > 0 ? Math.max(...metas) : null;
};

export const mergeRestoredSourcePlanTasks = (
  existing: PlannerTask[],
  persisted: PlannerTask[],
): PlannerTask[] => {
  const persistedMeta = latestLsMeta(persisted);
  const localMeta = latestLsMeta(existing);
  if (persistedMeta !== null && localMeta !== null && localMeta > persistedMeta) return existing;
  if (persistedMeta === null) return mergePlannerTasks(existing, persisted);

  const retained = existing.filter((task) => {
    const isLsTask = task.plannerSourceKind === 'ls' || task.source.startsWith('ls-meta-');
    return !isLsTask || task.metaNumber === persistedMeta;
  });
  const retainedById = new Map(retained.map((task) => [task.id, task]));
  const retainedBySourcePosition = new Map(
    retained
      .filter((task) => task.metaNumber !== undefined)
      .map((task) => [`${task.metaNumber}:${task.number}`, task]),
  );
  const restored = persisted.map((task) => {
    const local = retainedById.get(task.id)
      || (task.metaNumber === undefined
        ? undefined
        : retainedBySourcePosition.get(`${task.metaNumber}:${task.number}`));
    if (!local) return task;
    const localUpdatedAt = Date.parse(local.updatedAt);
    const persistedUpdatedAt = Date.parse(task.updatedAt);
    if (
      task.status === 'completed'
      && task.scheduleOrigin === 'source'
      && local.schedulePinned !== true
    ) {
      return {
        ...task,
        linkedStudyTaskId: local.linkedStudyTaskId ?? task.linkedStudyTaskId,
        scheduledDate: local.schedulePinned ? local.scheduledDate : task.scheduledDate,
        startTime: local.schedulePinned ? local.startTime : task.startTime,
        scheduleOrigin: local.schedulePinned ? local.scheduleOrigin : task.scheduleOrigin,
        schedulePinned: local.schedulePinned || task.schedulePinned,
      };
    }
    const localIsNewer = Number.isFinite(localUpdatedAt)
      && (!Number.isFinite(persistedUpdatedAt) || localUpdatedAt > persistedUpdatedAt);
    if (localIsNewer) return local;
    const localHasAuthority = local.status === 'completed'
      || local.status === 'started'
      || local.status === 'failed'
      || local.scheduleOrigin === 'manual'
      || local.schedulePinned === true;
    if (!localHasAuthority) return task;
    return {
      ...task,
      status: local.status,
      completedAt: local.completedAt,
      lastOutcome: local.lastOutcome,
      spentMinutes: local.spentMinutes,
      performance: local.performance,
      linkedStudyTaskId: local.linkedStudyTaskId ?? task.linkedStudyTaskId,
      scheduledDate: local.scheduledDate,
      startTime: local.startTime,
      scheduleOrigin: local.scheduleOrigin,
      schedulePinned: local.schedulePinned,
      updatedAt: local.updatedAt,
    };
  });
  return mergePlannerTasks(retained, restored);
};

export const plannerTaskFromSourcePlan = (task: SourcePlanTask): PlannerTask => {
  const scheduledDate = calendarDate(task);
  const timestamp = fallbackTimestamp(scheduledDate);
  const plannedQuestions = numberValue(task.provenance.plannedQuestions);
  const observedOn = textValue(task.provenance.observedOn);
  return {
    id: task.externalTaskId,
    number: task.sourceOrder,
    metaNumber: task.metaNumber ?? undefined,
    planejamento: textValue(task.provenance.planejamento, task.planLabel),
    discipline: task.discipline,
    format: textValue(task.provenance.format, task.taskKind),
    description: task.description,
    details: task.details || undefined,
    spentMinutes: task.spentMinutes,
    estimatedMinutes: task.estimatedMinutes,
    performance: task.performanceBp === null ? null : task.performanceBp / 100,
    status: task.status,
    relevance: task.relevance,
    scheduledDate,
    startTime: textValue(task.provenance.startTime) || undefined,
    durationMinutes: task.estimatedMinutes,
    source: plannerSource(task),
    plannerSourceKind: task.sourceKind === 'trilha' ? 'trilha_estrategica' : task.sourceKind,
    targetSlug: task.targetSlug,
    plannedBlockKind: blockKind(task),
    plannedQuestions: plannedQuestions === undefined ? undefined : Math.max(0, Math.round(plannedQuestions)),
    materialHint: task.materialHint || undefined,
    sourceUrl: textValue(task.provenance.tecUrl) || undefined,
    linkedStudyTaskId: task.linkedStudyTaskId || undefined,
    completedAt: task.status === 'completed'
      ? textValue(task.provenance.completedAt) || (observedOn ? `${observedOn}T12:00:00-03:00` : timestamp)
      : undefined,
    lastOutcome: task.status === 'completed' ? 'completed' : undefined,
    scheduleOrigin: task.provenance.origin === 'ls-visible-history' ? 'source' : undefined,
    createdAt: textValue(task.provenance.createdAt, timestamp),
    updatedAt: textValue(task.provenance.updatedAt, timestamp),
  };
};
