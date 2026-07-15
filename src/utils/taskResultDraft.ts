export interface TaskResultDraft {
  spentMinutes: string;
  performance: string;
}

export type ParsedTaskResultDraft =
  | { ok: true; value: { spentMinutes: number; performance: number } }
  | { ok: false; errors: Partial<Record<keyof TaskResultDraft, string>> };

const integer = (value: string) => /^\d+$/.test(value.trim()) ? Number(value) : null;

export const parseTaskResultDraft = (draft: TaskResultDraft): ParsedTaskResultDraft => {
  const errors: Partial<Record<keyof TaskResultDraft, string>> = {};
  const spentMinutes = integer(draft.spentMinutes);
  const performance = integer(draft.performance);
  if (spentMinutes === null || spentMinutes < 0 || spentMinutes > 240) errors.spentMinutes = 'Use minutos entre 0 e 240';
  if (performance === null || performance < 0 || performance > 100) errors.performance = 'Use um percentual entre 0 e 100';
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, value: { spentMinutes: spentMinutes!, performance: performance! } };
};
