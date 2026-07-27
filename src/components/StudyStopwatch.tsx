import React, { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, TimerReset } from 'lucide-react';

import { formatElapsedSeconds, getElapsedSeconds } from '../utils/studyStopwatch';

interface StudyStopwatchProps {
  label: string;
  compact?: boolean;
}

export const StudyStopwatch: React.FC<StudyStopwatchProps> = ({ label, compact = false }) => {
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isRunning = startedAtMs !== null;
  const elapsedSeconds = getElapsedSeconds(accumulatedSeconds, startedAtMs, nowMs);

  useEffect(() => {
    if (!isRunning) return undefined;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  const toggleRunning = () => {
    const currentNow = Date.now();
    if (startedAtMs === null) {
      setNowMs(currentNow);
      setStartedAtMs(currentNow);
      return;
    }
    setAccumulatedSeconds(getElapsedSeconds(accumulatedSeconds, startedAtMs, currentNow));
    setNowMs(currentNow);
    setStartedAtMs(null);
  };

  const reset = () => {
    const currentNow = Date.now();
    setAccumulatedSeconds(0);
    setNowMs(currentNow);
    setStartedAtMs(startedAtMs === null ? null : currentNow);
  };

  return (
    <div className={`flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5 ${compact ? '' : 'shadow-inner'}`}>
      <TimerReset className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-purple-300`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <output className={`${compact ? 'min-w-[42px] text-[11px]' : 'min-w-[58px] text-xs'} font-black tabular-nums text-white`} aria-label={`${label}: ${formatElapsedSeconds(elapsedSeconds)}`}>
        {formatElapsedSeconds(elapsedSeconds)}
      </output>
      <button
        type="button"
        onClick={toggleRunning}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-200 transition-colors hover:bg-purple-500/30 hover:text-white"
        title={isRunning ? `Pausar ${label.toLowerCase()}` : `Iniciar ${label.toLowerCase()}`}
        aria-label={isRunning ? `Pausar ${label.toLowerCase()}` : `Iniciar ${label.toLowerCase()}`}
      >
        {isRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={reset}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/10 hover:text-white"
        title={`Zerar ${label.toLowerCase()}`}
        aria-label={`Zerar ${label.toLowerCase()}`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
