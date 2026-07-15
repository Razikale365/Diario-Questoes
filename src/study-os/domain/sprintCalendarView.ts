import type {
  CalendarDecision,
  CalendarPriorityTier,
  SprintCalendarDocument,
} from '../api/sprintCalendar';


export interface SprintCalendarDayView {
  date: string;
  label: 'Exato' | 'Provisório' | 'Protegido';
  minutes: number;
  capacityMinutes: number;
  itemCount: number;
  completedCount: number;
  overCapacity: boolean;
  hottestPriority: CalendarPriorityTier | null;
}

export interface SprintCalendarView {
  runId: number;
  decision: CalendarDecision;
  totals: {
    days: number;
    assignments: number;
    completed: number;
    overCapacityDays: number;
  };
  days: SprintCalendarDayView[];
}

const precisionLabel = {
  exact: 'Exato',
  provisional: 'Provisório',
  protected: 'Protegido',
} as const;

const priorityRank: Record<CalendarPriorityTier, number> = {
  protected: 0,
  maintenance: 1,
  high: 2,
  critical: 3,
};

export function buildSprintCalendarView(document: SprintCalendarDocument): SprintCalendarView {
  const itemState = new Map(document.items.map((item) => [item.id, item.state]));
  const dayIndex = new Map<string, SprintCalendarDayView>();
  for (const day of document.days) {
    dayIndex.set(day.date, {
      date: day.date,
      label: precisionLabel[day.precision],
      minutes: day.reservedMinutes,
      capacityMinutes: day.availableMinutes,
      itemCount: 0,
      completedCount: 0,
      overCapacity: day.overageMinutes > 0,
      hottestPriority: null,
    });
  }
  for (const assignment of document.assignments) {
    const day = dayIndex.get(assignment.date);
    if (!day) continue;
    day.itemCount += 1;
    day.completedCount += Number(itemState.get(assignment.itemId) === 'completed');
    if (day.hottestPriority === null
      || priorityRank[assignment.priorityTier] > priorityRank[day.hottestPriority]) {
      day.hottestPriority = assignment.priorityTier;
    }
  }
  const days = [...dayIndex.values()];
  return {
    runId: document.run.id,
    decision: document.run.decision,
    totals: {
      days: days.length,
      assignments: document.assignments.length,
      completed: document.items.filter((item) => item.state === 'completed').length,
      overCapacityDays: days.filter((day) => day.overCapacity).length,
    },
    days,
  };
}
