export interface TaskExecutionDraft {
  performedOn: string;
  taskMinutes: string;
  exerciseMinutes: string;
  questionsTotal: string;
  correctCount: string;
  wrongCount: string;
  doubtCount: string;
  energyAfter: number;
  notes: string;
}

export interface ParsedTaskExecutionDraftValue {
  performedOn: string;
  taskMinutes: number;
  exerciseMinutes: number;
  questionsTotal: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  energyAfter: number;
  notes: string;
  performanceBp: number | null;
}

export type ParsedTaskExecutionDraft =
  | { ok: true; value: ParsedTaskExecutionDraftValue }
  | { ok: false; errors: Partial<Record<keyof TaskExecutionDraft, string>> };

const integer = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : null;

const isCurrentOrPastDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed <= today;
};

const derivedPerformanceBp = (correctCount: number, wrongCount: number) => {
  const answered = correctCount + wrongCount;
  return answered === 0 ? null : Math.round((correctCount * 10000) / answered);
};

export const parseTaskExecutionDraft = (draft: TaskExecutionDraft): ParsedTaskExecutionDraft => {
  const errors: Partial<Record<keyof TaskExecutionDraft, string>> = {};
  const taskMinutes = integer(draft.taskMinutes);
  const exerciseMinutes = integer(draft.exerciseMinutes);
  const questionsTotal = integer(draft.questionsTotal);
  const correctCount = integer(draft.correctCount);
  const wrongCount = integer(draft.wrongCount);
  const doubtCount = integer(draft.doubtCount);

  if (!isCurrentOrPastDate(draft.performedOn)) errors.performedOn = 'Use uma data válida que não seja futura';
  if (taskMinutes === null || taskMinutes > 720) errors.taskMinutes = 'Use minutos entre 0 e 720';
  if (exerciseMinutes === null || exerciseMinutes > 720 || (taskMinutes !== null && exerciseMinutes > taskMinutes)) {
    errors.exerciseMinutes = 'Use minutos entre 0 e 720';
  }
  if (questionsTotal === null || questionsTotal > 10000) errors.questionsTotal = 'Use um total entre 0 e 10000';
  if (correctCount === null || correctCount > 10000) errors.correctCount = 'Use uma contagem válida';
  if (wrongCount === null || wrongCount > 10000) errors.wrongCount = 'Use uma contagem válida';
  if (doubtCount === null || doubtCount > 10000) errors.doubtCount = 'Use uma contagem válida';
  if (questionsTotal !== null && correctCount !== null && wrongCount !== null && correctCount + wrongCount > questionsTotal) {
    errors.correctCount = 'Use uma contagem válida';
    errors.wrongCount = 'Use uma contagem válida';
  }
  if (questionsTotal !== null && doubtCount !== null && doubtCount > questionsTotal) {
    errors.doubtCount = 'Use uma contagem válida';
  }
  if (!Number.isInteger(draft.energyAfter) || draft.energyAfter < 1 || draft.energyAfter > 5) {
    errors.energyAfter = 'Escolha uma energia entre 1 e 5';
  }
  if (typeof draft.notes !== 'string') errors.notes = 'Use observações em texto';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      performedOn: draft.performedOn,
      taskMinutes: taskMinutes!,
      exerciseMinutes: exerciseMinutes!,
      questionsTotal: questionsTotal!,
      correctCount: correctCount!,
      wrongCount: wrongCount!,
      doubtCount: doubtCount!,
      energyAfter: draft.energyAfter,
      notes: draft.notes,
      performanceBp: derivedPerformanceBp(correctCount!, wrongCount!),
    },
  };
};

/**
 * Transitional compatibility for PlannerArea until Task 4 adopts TaskExecutionDraft.
 * It is deliberately not part of the execution request contract: durable execution
 * performance is derived only from answered counts above.
 */
export interface TaskResultDraft {
  spentMinutes: string;
  performance: string;
}

export type ParsedTaskResultDraft =
  | { ok: true; value: { spentMinutes: number; performance: number } }
  | { ok: false; errors: Partial<Record<keyof TaskResultDraft, string>> };

export const parseTaskResultDraft = (draft: TaskResultDraft): ParsedTaskResultDraft => {
  const errors: Partial<Record<keyof TaskResultDraft, string>> = {};
  const spentMinutes = integer(draft.spentMinutes);
  const performance = integer(draft.performance);
  if (spentMinutes === null || spentMinutes > 240) errors.spentMinutes = 'Use minutos entre 0 e 240';
  if (performance === null || performance > 100) errors.performance = 'Use um percentual entre 0 e 100';
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value: { spentMinutes: spentMinutes!, performance: performance! } };
};
