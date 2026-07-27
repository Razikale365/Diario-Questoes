export const getElapsedSeconds = (
  accumulatedSeconds: number,
  startedAtMs: number | null,
  nowMs: number,
) => accumulatedSeconds + (startedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)));

export const formatElapsedSeconds = (seconds: number) => {
  const normalized = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remainingSeconds = normalized % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(minutes)}:${pad(remainingSeconds)}`;
};
