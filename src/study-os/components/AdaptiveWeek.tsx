import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import {
  fetchPlannerWeek,
  generatePlannerWeek,
  refreshPlannerWeek,
  type PlannerWeek,
  type PlannerWeekSlot,
} from '../api/planner';
import {
  adaptationReasonLabel,
  buildAdaptiveWeekColumns,
  getPlannerWeekStart,
} from '../domain/adaptiveView';
import { buildSourceChoiceView } from '../domain/strategyView';

interface AdaptiveWeekProps {
  targetSlug: string;
  selectedDate: string;
  refreshToken: number;
  onDateChange: (date: string) => void;
  onError: (message: string) => void;
  showToast: (message: string) => void;
}

const errorText = (error: unknown) => (
  error instanceof Error ? error.message : 'Não foi possível carregar a semana adaptativa.'
);

const requestKey = (kind: string, targetSlug: string, weekStart: string) => (
  `${kind}-${targetSlug}-${weekStart}-${Date.now().toString(36)}`
);

const dateLabel = (date: string) => new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  timeZone: 'UTC',
}).format(new Date(`${date}T00:00:00Z`)).replace('.', '');

const kindLabel: Record<PlannerWeekSlot['blockKind'], string> = {
  theory: 'Teoria',
  questions: 'TEC',
  review: 'Revisão',
};

const kindTone: Record<PlannerWeekSlot['blockKind'], string> = {
  theory: 'border-sky-400',
  questions: 'border-[#84cc16]',
  review: 'border-amber-300',
};

export const AdaptiveWeek: React.FC<AdaptiveWeekProps> = ({
  targetSlug,
  selectedDate,
  refreshToken,
  onDateChange,
  onError,
  showToast,
}) => {
  const weekStart = useMemo(() => getPlannerWeekStart(selectedDate), [selectedDate]);
  const [week, setWeek] = useState<PlannerWeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadWeek = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setWeek(await fetchPlannerWeek(targetSlug, weekStart, signal));
    } catch (error: unknown) {
      if (signal?.aborted) return;
      if (error instanceof StudyOsApiError && error.status === 404) {
        setWeek(null);
      } else {
        onError(errorText(error));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [onError, targetSlug, weekStart]);

  useEffect(() => {
    const controller = new AbortController();
    void loadWeek(controller.signal);
    return () => controller.abort();
  }, [loadWeek, refreshToken]);

  const calculateWeek = async () => {
    setBusy(true);
    try {
      const next = week
        ? await refreshPlannerWeek({
            previousWeekRunId: week.run.id,
            targetSlug,
            weekStart,
          }, requestKey('refresh-week', targetSlug, weekStart))
        : await generatePlannerWeek({ targetSlug, weekStart }, requestKey('generate-week', targetSlug, weekStart));
      setWeek(next);
      showToast(next.run.status === 'generated'
        ? 'Semana adaptativa calculada.'
        : `Semana salva com ${next.run.shortfallCount} lacuna(s) explícita(s).`);
    } catch (error: unknown) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns = week ? buildAdaptiveWeekColumns(week, selectedDate) : [];

  return (
    <section className="border-t border-white/10 py-4" aria-labelledby="adaptive-week-title">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-sky-300" />
            <h3 id="adaptive-week-title" className="text-xs font-black uppercase tracking-widest text-gray-200">Previsão da semana</h3>
          </div>
          <p className="mt-1 text-[10px] font-bold text-gray-500">
            {week ? `Run semanal #${week.run.id} · ${week.slots.length} blocos reais` : `Semana de ${dateLabel(weekStart)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={calculateWeek}
          disabled={busy || loading}
          className="flex h-9 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase text-gray-100 hover:bg-white/10 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {week ? 'Recalcular' : 'Gerar semana'}
        </button>
      </header>

      {loading ? (
        <div className="flex h-28 items-center justify-center gap-2 border-y border-white/10 text-xs font-bold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando previsão...
        </div>
      ) : week ? (
        <div className="overflow-x-auto border-y border-white/10">
          <div className="grid min-w-[1120px] grid-cols-7 divide-x divide-white/10">
            {columns.map((column) => (
              <div key={column.date} className={column.selected ? 'bg-[#84cc16]/[0.04]' : ''}>
                <button
                  type="button"
                  onClick={() => onDateChange(column.date)}
                  className={`flex h-11 w-full items-center justify-between border-b px-3 text-left text-[10px] font-black uppercase ${column.selected ? 'border-[#84cc16] text-[#bef264]' : 'border-white/10 text-gray-400 hover:bg-white/[0.03]'}`}
                >
                  <span>{dateLabel(column.date)}</span>
                  <span className="text-gray-600">{column.slots.length}</span>
                </button>
                <div className="min-h-44">
                  {column.slots.length ? column.slots.map((slot) => {
                    const sourceView = buildSourceChoiceView(slot.sourceChoice);
                    return <button
                      key={slot.id}
                      type="button"
                      onClick={() => onDateChange(column.date)}
                      className={`block w-full border-b border-l-2 border-white/5 px-2.5 py-2 text-left hover:bg-white/[0.03] ${kindTone[slot.blockKind]}`}
                    >
                      <span className="flex items-center justify-between gap-2 text-[9px] font-black uppercase text-gray-500">
                        <span>#{slot.position} · {kindLabel[slot.blockKind]}</span>
                        {slot.state === 'materialized' ? <CheckCircle2 className="h-3 w-3 text-[#84cc16]" /> : null}
                      </span>
                      <span className="mt-1 block truncate text-[11px] font-black text-white">{slot.evidence.discipline}</span>
                      <span className="block truncate text-[10px] font-semibold text-gray-500">{slot.evidence.topic}</span>
                      <span className="mt-1 block text-[9px] font-bold text-gray-600">{slot.durationMinutes} min{slot.plannedQuestions ? ` · ${slot.plannedQuestions} q.` : ''}</span>
                      <span className="mt-1 block truncate text-[9px] font-black text-sky-300">{sourceView.label} · {sourceView.displayName}</span>
                      {sourceView.alternatives[0] ? <span className="block truncate text-[9px] font-semibold text-gray-600">vs. {sourceView.alternatives[0].label} · {sourceView.alternatives[0].decision}</span> : null}
                      <span className={slot.evidence.adaptationReason === 'weekly_diverged_current_evidence' ? 'mt-1 block text-[9px] font-black text-amber-200' : 'mt-1 block text-[9px] font-bold text-gray-600'}>
                        {adaptationReasonLabel(slot.evidence.adaptationReason)}
                      </span>
                    </button>;
                  }) : <p className="px-3 py-4 text-[10px] font-bold text-gray-700">Sem bloco executável</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-28 flex-col items-center justify-center border-y border-dashed border-white/10 text-center">
          <CalendarRange className="h-5 w-5 text-gray-700" />
          <p className="mt-2 text-xs font-black text-gray-300">Semana ainda não calculada</p>
        </div>
      )}

      {week?.run.shortfallReasons.length ? (
        <details className="mt-2 border-t border-amber-300/10 pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-black uppercase text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" /> {week.run.shortfallCount} lacuna(s) na semana
          </summary>
          <ul className="mt-2 grid gap-1 text-[10px] font-semibold text-amber-100/70 md:grid-cols-2">
            {week.run.shortfallReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
};
