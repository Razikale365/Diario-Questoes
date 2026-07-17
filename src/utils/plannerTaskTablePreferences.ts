import { PlannerTask } from '../types';

export type PlannerTaskColumnId =
  | 'number'
  | 'discipline'
  | 'format'
  | 'description'
  | 'duration'
  | 'performance'
  | 'status'
  | 'relevance'
  | 'schedule';

export type PlannerTaskSort = {
  column: PlannerTaskColumnId;
  direction: 'asc' | 'desc';
} | null;

export interface PlannerTaskTablePreferences {
  version: 1;
  order: PlannerTaskColumnId[];
  hidden: PlannerTaskColumnId[];
  sort: PlannerTaskSort;
}

export const PLANNER_TASK_TABLE_PREFERENCES_KEY = 'ls_planner_task_table_preferences_v1';

export const DEFAULT_PLANNER_TASK_COLUMNS: PlannerTaskColumnId[] = [
  'number',
  'discipline',
  'format',
  'description',
  'duration',
  'performance',
  'status',
  'relevance',
  'schedule',
];

export const DEFAULT_PLANNER_TASK_TABLE_PREFERENCES: PlannerTaskTablePreferences = {
  version: 1,
  order: [...DEFAULT_PLANNER_TASK_COLUMNS],
  hidden: [],
  sort: null,
};

const knownColumns = new Set<string>(DEFAULT_PLANNER_TASK_COLUMNS);

const isColumnId = (value: unknown): value is PlannerTaskColumnId => (
  typeof value === 'string' && knownColumns.has(value)
);

const cloneDefaults = (): PlannerTaskTablePreferences => ({
  version: 1,
  order: [...DEFAULT_PLANNER_TASK_COLUMNS],
  hidden: [],
  sort: null,
});

const uniqueKnownColumns = (value: unknown): PlannerTaskColumnId[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PlannerTaskColumnId>();
  const result: PlannerTaskColumnId[] = [];
  for (const candidate of value) {
    if (!isColumnId(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
};

export const parsePlannerTaskTablePreferences = (
  raw: string | null | undefined,
): PlannerTaskTablePreferences => {
  if (!raw) return cloneDefaults();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return cloneDefaults();
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
    return cloneDefaults();
  }

  const candidate = parsed as { order?: unknown; hidden?: unknown; sort?: unknown };
  const storedOrder = uniqueKnownColumns(candidate.order);
  const order = [
    ...storedOrder,
    ...DEFAULT_PLANNER_TASK_COLUMNS.filter((column) => !storedOrder.includes(column)),
  ];
  let hidden = uniqueKnownColumns(candidate.hidden);
  if (hidden.length >= DEFAULT_PLANNER_TASK_COLUMNS.length) {
    hidden = hidden.filter((column) => column !== 'number');
  }

  let sort: PlannerTaskSort = null;
  if (candidate.sort && typeof candidate.sort === 'object') {
    const storedSort = candidate.sort as { column?: unknown; direction?: unknown };
    if (
      isColumnId(storedSort.column)
      && (storedSort.direction === 'asc' || storedSort.direction === 'desc')
    ) {
      sort = { column: storedSort.column, direction: storedSort.direction };
    }
  }

  return { version: 1, order, hidden, sort };
};

export const movePlannerTaskColumn = (
  preferences: PlannerTaskTablePreferences,
  activeId: PlannerTaskColumnId,
  overId: PlannerTaskColumnId,
): PlannerTaskTablePreferences => {
  if (!isColumnId(activeId) || !isColumnId(overId) || activeId === overId) return preferences;
  const from = preferences.order.indexOf(activeId);
  const to = preferences.order.indexOf(overId);
  if (from < 0 || to < 0) return preferences;
  const order = [...preferences.order];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return { ...preferences, order };
};

export const setPlannerTaskColumnHidden = (
  preferences: PlannerTaskTablePreferences,
  column: PlannerTaskColumnId,
  hidden: boolean,
): PlannerTaskTablePreferences => {
  if (!isColumnId(column)) return preferences;
  const current = new Set(preferences.hidden);
  if (hidden) {
    const visibleCount = preferences.order.filter((id) => !current.has(id)).length;
    if (visibleCount <= 1 || current.has(column)) return preferences;
    current.add(column);
  } else {
    if (!current.has(column)) return preferences;
    current.delete(column);
  }
  return { ...preferences, hidden: preferences.order.filter((id) => current.has(id)) };
};

export const nextPlannerTaskSort = (
  current: PlannerTaskSort,
  column: PlannerTaskColumnId,
): PlannerTaskSort => {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
};

type SortValue = number | string | null | undefined;

const valueForColumn = (task: PlannerTask, column: PlannerTaskColumnId): SortValue => {
  switch (column) {
    case 'number': return task.number;
    case 'discipline': return task.discipline;
    case 'format': return task.format;
    case 'description': return task.description;
    case 'duration': return task.durationMinutes;
    case 'performance': return task.performance;
    case 'status': return task.status;
    case 'relevance': return task.relevance;
    case 'schedule': return task.scheduledDate
      ? `${task.scheduledDate}T${task.startTime || '00:00'}`
      : null;
  }
};

const isMissing = (value: SortValue) => (
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
);

const compareValues = (left: Exclude<SortValue, null | undefined>, right: Exclude<SortValue, null | undefined>) => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'pt-BR', { sensitivity: 'base', numeric: true });
};

export const sortPlannerTasks = (tasks: PlannerTask[], sort: PlannerTaskSort): PlannerTask[] => {
  if (!sort) return [...tasks];
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftValue = valueForColumn(left.task, sort.column);
      const rightValue = valueForColumn(right.task, sort.column);
      const leftMissing = isMissing(leftValue);
      const rightMissing = isMissing(rightValue);
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
      if (!leftMissing && !rightMissing) {
        const primary = compareValues(
          leftValue as Exclude<SortValue, null | undefined>,
          rightValue as Exclude<SortValue, null | undefined>,
        );
        if (primary !== 0) return sort.direction === 'asc' ? primary : -primary;
      }
      const numberTie = left.task.number - right.task.number;
      if (numberTie !== 0) return numberTie;
      const idTie = left.task.id.localeCompare(right.task.id, 'pt-BR', { numeric: true });
      return idTie || left.index - right.index;
    })
    .map(({ task }) => task);
};
