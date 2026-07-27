import type {
  CalendarPrecision,
  CalendarPriorityTier,
  SprintCalendarDocument,
} from '../api/sprintCalendar';

export interface CalendarPreviewEntry {
  id: string;
  date: string;
  durationMinutes: number;
  priorityTier: CalendarPriorityTier;
  precision: CalendarPrecision;
  title: string;
  topicHint?: string;
  sourcePlanTaskId: number | null;
  plannerTaskId?: string;
  taskNumber?: number;
  discipline?: string;
  isDraft: boolean;
  isCompleted: boolean;
}

export interface CalendarTaskIdentity {
  sourcePlanTaskId: number;
  plannerTaskId: string;
  taskNumber: number;
  discipline: string;
}

export interface CalendarPreviewDaySummary {
  date: string;
  durationMinutes: number;
  blockCount: number;
  priorityTier: CalendarPriorityTier;
  focusTitle: string;
  focusTopicHint?: string;
  focusPlannerTaskId?: string;
  focusTaskNumber?: number;
  focusDiscipline?: string;
  isDraft: boolean;
}

const priorityRank: Record<CalendarPriorityTier, number> = {
  critical: 0,
  high: 1,
  maintenance: 2,
  protected: 3,
};

const actionText = (action: Record<string, unknown> | null, field: 'title' | 'topicHint') => {
  const value = action?.[field];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

export function projectCalendarPreviewEntries(
  document: SprintCalendarDocument | null,
  taskIdentities: CalendarTaskIdentity[] = [],
): CalendarPreviewEntry[] {
  if (!document) return [];
  const itemById = new Map(document.items.map((item) => [item.id, item]));
  const identityBySourceTaskId = new Map(taskIdentities.map((task) => [task.sourcePlanTaskId, task]));
  return document.assignments.flatMap((assignment) => {
    const item = itemById.get(assignment.itemId);
    if (!item || item.kind !== 'source_task') return [];
    const identity = item.sourcePlanTaskId === null ? undefined : identityBySourceTaskId.get(item.sourcePlanTaskId);
    return [{
      id: `sprint-calendar-${assignment.id}`,
      date: assignment.date,
      durationMinutes: assignment.durationMinutes,
      priorityTier: assignment.priorityTier,
      precision: assignment.precision,
      title: item.title,
      topicHint: actionText(assignment.action, 'topicHint'),
      sourcePlanTaskId: item.sourcePlanTaskId,
      plannerTaskId: identity?.plannerTaskId,
      taskNumber: identity?.taskNumber,
      discipline: identity?.discipline,
      isDraft: document.run.decision === 'draft',
      isCompleted: item.state === 'completed',
    }];
  });
}

export function filterCalendarPreviewEntries(
  entries: CalendarPreviewEntry[],
  hideCompleted: boolean,
): CalendarPreviewEntry[] {
  return hideCompleted ? entries.filter((entry) => !entry.isCompleted) : entries;
}

export function summarizeCalendarPreviewByDay(
  document: SprintCalendarDocument | null,
  taskIdentities: CalendarTaskIdentity[] = [],
): CalendarPreviewDaySummary[] {
  const entriesByDate = projectCalendarPreviewEntries(document, taskIdentities).reduce<Record<string, CalendarPreviewEntry[]>>((byDate, entry) => {
    (byDate[entry.date] ||= []).push(entry);
    return byDate;
  }, {});

  return Object.entries(entriesByDate)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entries]) => {
      const focus = [...entries].sort((left, right) => priorityRank[left.priorityTier] - priorityRank[right.priorityTier])[0];
      return {
        date,
        durationMinutes: entries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
        blockCount: entries.length,
        priorityTier: focus.priorityTier,
        focusTitle: focus.title,
        focusTopicHint: focus.topicHint,
        focusPlannerTaskId: focus.plannerTaskId,
        focusTaskNumber: focus.taskNumber,
        focusDiscipline: focus.discipline,
        isDraft: focus.isDraft,
      };
    });
}
