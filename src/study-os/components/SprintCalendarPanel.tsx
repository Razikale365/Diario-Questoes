import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Flame,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Snowflake,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import {
  applySprintCalendarRun,
  fetchSprintCalendarHead,
  previewSprintCalendar,
  type CalendarPriorityTier,
  type SprintCalendarDocument,
} from '../api/sprintCalendar';
import { buildSprintCalendarView } from '../domain/sprintCalendarView';


interface SprintCalendarPanelProps {
  targetSlug: string;
  startDate: string;
  endDate: string;
  onNotice?: (message: string) => void;
}

const precisionTone = {
  Exato: 'border-[#84cc16]/45 bg-[#84cc16]/[0.07]',
  Provisório: 'border-dashed border-amber-300/45 bg-amber-300/[0.06]',
  Protegido: 'border-cyan-300/45 bg-cyan-300/[0.07]',
} as const;

const priorityTone: Record<CalendarPriorityTier, string> = {
  critical: 'bg-rose-400',
  high: 'bg-amber-300',
  maintenance: 'bg-sky-300',
  protected: 'bg-cyan-200',
};

const priorityLabel: Record<CalendarPriorityTier, string> = {
  critical: 'Crítica',
  high: 'Alta',
  maintenance: 'Manutenção',
  protected: 'Protegida',
};

const priorityLegend: ReadonlyArray<{
  tier: CalendarPriorityTier;
  temperature: string;
  icon: typeof Flame;
}> = [
  { tier: 'critical', temperature: 'quente', icon: Flame },
  { tier: 'high', temperature: 'quente', icon: Flame },
  { tier: 'maintenance', temperature: 'frio', icon: Snowflake },
  { tier: 'protected', temperature: 'frio', icon: ShieldCheck },
];

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const shortWeekday = (value: string) => localDate(value).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const shortDate = (value: string) => localDate(value).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

const mutationKey = (prefix: string) => {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
};

const messageForError = (error: unknown) => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Não foi possível atualizar o horizonte.';
};

export const SprintCalendarPanel: React.FC<SprintCalendarPanelProps> = ({
  targetSlug,
  startDate,
  endDate,
  onNotice,
}) => {
  const [document, setDocument] = useState<SprintCalendarDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutationControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const head = await fetchSprintCalendarHead(targetSlug, startDate, signal);
      if (!signal?.aborted) setDocument(head);
    } catch (loadError) {
      if (!signal?.aborted) setError(messageForError(loadError));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [startDate, targetSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setBusy(null);
    return () => {
      mutationControllerRef.current?.abort();
      mutationControllerRef.current = null;
    };
  }, [endDate, startDate, targetSlug]);

  const view = useMemo(
    () => document ? buildSprintCalendarView(document) : null,
    [document],
  );
  const placeholderCount = useMemo(
    () => document?.items.filter((item) => item.kind === 'future_cycle_capacity').length ?? 0,
    [document],
  );
  const motorWarnings = useMemo(() => document ? [...new Set([
    ...document.run.warnings,
    ...document.run.shortfalls,
    ...document.days.flatMap((day) => day.warnings),
  ])] : [], [document]);

  const createPreview = async () => {
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setBusy('preview');
    setError(null);
    try {
      const expectedRunId = document?.run.decision === 'applied'
        ? document.run.id
        : document?.run.baseAppliedRunId ?? null;
      const next = await previewSprintCalendar({
        targetSlug,
        startDate,
        endDate,
        expectedRunId,
        mode: 'reflow_open',
      }, mutationKey('calendar-preview'), controller.signal);
      if (mutationControllerRef.current === controller && !controller.signal.aborted) {
        setDocument(next);
        onNotice?.('Prévia pronta. Revise as mudanças antes de aplicar.');
      }
    } catch (previewError) {
      if (mutationControllerRef.current === controller && !controller.signal.aborted) {
        setError(messageForError(previewError));
      }
    } finally {
      if (mutationControllerRef.current === controller) {
        mutationControllerRef.current = null;
        setBusy(null);
      }
    }
  };

  const applyPreview = async () => {
    if (!document || document.run.decision !== 'draft') return;
    mutationControllerRef.current?.abort();
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    setBusy('apply');
    setError(null);
    try {
      const applied = await applySprintCalendarRun(document.run.id, {
        expectedRunId: document.run.baseAppliedRunId,
        expectedOverrideVersions: document.overrideVersions,
      }, mutationKey('calendar-apply'), controller.signal);
      if (mutationControllerRef.current === controller && !controller.signal.aborted) {
        setDocument(applied);
        onNotice?.('Organização aplicada. Concluídas e pins foram preservados.');
      }
    } catch (applyError) {
      if (mutationControllerRef.current === controller && !controller.signal.aborted) {
        setError(messageForError(applyError));
      }
    } finally {
      if (mutationControllerRef.current === controller) {
        mutationControllerRef.current = null;
        setBusy(null);
      }
    }
  };

  return (
    <section aria-label="Horizonte do Sprint" className="border-y border-[#404040] bg-[#151817] px-3 py-3 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#bef264]">
            <CalendarDays className="h-4 w-4" /> Plano de voo
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-base font-black text-white">Horizonte adaptativo</h2>
            <span className="text-[10px] font-bold text-gray-500">
              {startDate} → {endDate} · {view?.totals.assignments ?? 0} blocos
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold text-gray-400">
            Metas liberadas são exatas; dias futuros reservam capacidade sem inventar tarefas.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void createPreview()}
            disabled={busy !== null || loading}
            className="inline-flex h-9 items-center gap-2 rounded border border-[#84cc16]/35 bg-[#84cc16]/10 px-3 text-[10px] font-black uppercase text-[#d9f99d] transition-colors hover:bg-[#84cc16]/20 disabled:opacity-50"
          >
            {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Auto-organizar
          </button>
          {document?.run.decision === 'draft' ? (
            <button
              type="button"
              onClick={() => void applyPreview()}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-2 rounded bg-[#84cc16] px-3 text-[10px] font-black uppercase text-black transition-colors hover:bg-[#a3e635] disabled:opacity-50"
            >
              {busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aplicar organização
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-white/[0.07] py-2 text-[9px] font-black uppercase tracking-wide text-gray-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#84cc16]" /> Exato</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-dashed border-amber-200" /> Provisório</span>
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3 w-3 text-cyan-200" /> Protegido</span>
        {placeholderCount > 0 ? (
          <span className="ml-auto text-amber-200">{placeholderCount} × Capacidade reservada</span>
        ) : null}
      </div>

      <div aria-label="Legenda de prioridade" className="mt-2 flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-wide">
        {priorityLegend.map(({ tier, temperature, icon: PriorityIcon }) => (
          <span key={tier} className="inline-flex items-center gap-1.5 border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-300">
            <PriorityIcon className="h-3 w-3" aria-hidden="true" />
            <span className={`h-1.5 w-4 rounded-full ${priorityTone[tier]}`} aria-hidden="true" />
            {priorityLabel[tier]} · {temperature}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="grid min-h-24 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#84cc16]" /></div>
      ) : view ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2 [scrollbar-color:#4b5563_transparent]">
          {view.days.map((day) => {
            const loadRatio = day.capacityMinutes > 0
              ? Math.min(100, Math.round(day.minutes / day.capacityMinutes * 100))
              : 0;
            return (
              <article
                key={day.date}
                title={`${day.itemCount} tarefas · ${day.minutes} de ${day.capacityMinutes} minutos`}
                className={`min-w-[8.2rem] border px-3 py-2.5 text-left ${precisionTone[day.label]}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{shortWeekday(day.date)}</span>
                  {day.hottestPriority ? (
                    <span
                      aria-label={`Prioridade ${priorityLabel[day.hottestPriority]}`}
                      className="inline-flex items-center gap-1 text-[8px] font-black uppercase text-gray-300"
                    >
                      <span className={`h-1.5 w-4 rounded-full ${priorityTone[day.hottestPriority]}`} aria-hidden="true" />
                      {priorityLabel[day.hottestPriority]}
                    </span>
                  ) : null}
                </span>
                <strong className="mt-1 block text-lg font-black text-white">{shortDate(day.date)}</strong>
                <span className="mt-1 block text-[9px] font-black uppercase text-gray-400">{day.label}</span>
                <span className="mt-2 block text-[10px] font-bold text-gray-300">
                  {day.itemCount} tarefas · {day.minutes} min
                </span>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10">
                  <span className={`block h-full rounded-full ${day.overCapacity ? 'bg-rose-400' : 'bg-[#84cc16]'}`} style={{ width: `${loadRatio}%` }} />
                </span>
                <span className={`mt-1 block text-[9px] font-bold ${day.overCapacity ? 'text-rose-200' : 'text-gray-500'}`}>
                  {day.completedCount > 0 ? `${day.completedCount} concluídas · ` : ''}{day.minutes}/{day.capacityMinutes} min
                </span>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 flex min-h-24 flex-col items-center justify-center border border-dashed border-white/10 px-4 text-center">
          <RefreshCw className="h-5 w-5 text-gray-600" />
          <p className="mt-2 text-xs font-black text-gray-300">Ainda sem horizonte aplicado</p>
          <p className="mt-1 text-[10px] font-semibold text-gray-600">Use Auto-organizar para gerar uma prévia reversível.</p>
        </div>
      )}

      {document?.run.decision === 'draft' ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-gray-400">
          <span className="text-[#bef264]">Prévia, nada mudou ainda</span>
          <span>{document.diff.added} adicionadas</span>
          <span>{document.diff.moved} movidas</span>
          <span>{document.diff.preserved} preservadas</span>
          <span>{document.diff.completed} concluídas</span>
          {document.diff.noSpace > 0 ? <span className="text-rose-200">{document.diff.noSpace} sem espaço</span> : null}
        </div>
      ) : null}

      {motorWarnings.length > 0 ? (
        <details className="mt-2 border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-[10px] text-amber-50">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-black uppercase tracking-wide text-amber-200">
            <TriangleAlert className="h-3.5 w-3.5" /> Avisos do motor · {motorWarnings.length}
          </summary>
          <ul className="mt-2 space-y-1 pl-5 font-semibold text-amber-100/80">
            {motorWarnings.map((warning) => <li key={warning} className="list-disc">{warning}</li>)}
          </ul>
        </details>
      ) : null}

      {error ? (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-100">
          <span>{error}</span>
          <button type="button" title="Fechar aviso" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
        </div>
      ) : null}
    </section>
  );
};
