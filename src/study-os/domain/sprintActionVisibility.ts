import type { SourcePlanTask, SprintAction } from '../api/sprint';

export const visibleSprintActions = (actions: SprintAction[], sourceTasks: SourcePlanTask[]) => {
  if (sourceTasks.length === 0) return actions;
  const numbered = sourceTasks.filter((task) => task.metaNumber !== null);
  const latestMeta = numbered.length > 0 ? Math.max(...numbered.map((task) => task.metaNumber as number)) : null;
  const currentTaskIds = new Set((latestMeta === null ? sourceTasks : numbered.filter((task) => task.metaNumber === latestMeta))
    .map((task) => task.id));
  return actions.filter((action) => action.sourcePlanTaskId === null || currentTaskIds.has(action.sourcePlanTaskId));
};

export const primarySprintActions = (actions: SprintAction[], limit = 4) =>
  actions
    .filter((action) => !['completed', 'failed', 'skipped'].includes(action.state))
    .slice(0, Math.max(1, limit));
