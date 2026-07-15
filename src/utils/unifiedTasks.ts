import type { PlannerTask, PlannerTaskStatus } from '../types';

export type TaskQuickView = 'all' | 'today' | 'started' | 'pending' | 'completed';

export const normalizeTaskSearch = (value: string) => value
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

export const filterPlannerTaskDiscovery = (
  tasks: PlannerTask[],
  input: { query: string; discipline: string; view: TaskQuickView; today: string },
) => {
  const query = normalizeTaskSearch(input.query);
  return tasks.filter((task) => {
    const searchText = normalizeTaskSearch([
      task.number, task.metaNumber, task.discipline, task.format, task.description,
      task.details, task.materialHint, task.planejamento,
    ].filter((value) => value !== undefined).join(' '));
    const viewMatches = input.view === 'all'
      || (input.view === 'today' && task.scheduledDate === input.today)
      || (input.view === 'started' && (['started', 'failed'] as PlannerTaskStatus[]).includes(task.status))
      || task.status === input.view;
    return (!query || searchText.includes(query))
      && (!input.discipline || task.discipline === input.discipline)
      && viewMatches;
  });
};
