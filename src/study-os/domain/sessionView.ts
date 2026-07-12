import type { ProgressState, SkipReason } from '../api/sessions';

export interface SessionView {
  commandLabel: string;
  startPage: number;
  canComplete: boolean;
}

export const skipReasonChoices: ReadonlyArray<{
  value: SkipReason;
  label: string;
}> = [
  { value: 'lack_of_time', label: 'Faltou tempo' },
  { value: 'fatigue', label: 'Cansaço' },
  { value: 'wrong_material', label: 'Material errado' },
  { value: 'blocked_prerequisite', label: 'Pré-requisito pendente' },
  { value: 'too_difficult', label: 'Difícil demais' },
  { value: 'other', label: 'Outro motivo' },
];

export function buildSessionView(
  progress: ProgressState | null,
  available = true,
): SessionView {
  const startPage = progress?.cursorPage ?? 1;
  if (!available) {
    return {
      commandLabel: 'Material ausente',
      startPage,
      canComplete: false,
    };
  }
  return {
    commandLabel: progress && progress.status !== 'unread'
      ? `Continuar p. ${startPage}`
      : 'Começar',
    startPage,
    canComplete: !progress || !['covered', 'strong'].includes(progress.status),
  };
}

export function clampConfirmedPage(
  value: number,
  minimumPage: number,
  pageCount: number | null,
): number {
  const minimum = Math.max(1, Math.floor(minimumPage));
  if (!Number.isFinite(value)) return minimum;
  const integral = Math.floor(value);
  const maximum = pageCount === null
    ? Number.POSITIVE_INFINITY
    : Math.max(minimum, Math.floor(pageCount));
  return Math.min(maximum, Math.max(minimum, integral));
}

export function elapsedMinutesToSeconds(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes * 60);
}

export function elapsedSecondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}
