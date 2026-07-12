import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Flag,
  Loader2,
  Pause,
  Play,
  Save,
  SkipForward,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import type { MaterialSummary } from '../api/inventory';
import {
  checkpointStudySession,
  fetchActiveStudySession,
  fetchProgress,
  finishStudySession,
  inspectMaterial,
  skipStudySession,
  startStudySession,
  type ProgressState,
  type SkipReason,
  type StudySession,
} from '../api/sessions';
import {
  buildSessionView,
  clampConfirmedPage,
  elapsedMinutesToSeconds,
  elapsedSecondsToMinutes,
  skipReasonChoices,
} from '../domain/sessionView';

interface StudySessionPanelProps {
  targetSlug: string;
  lessonId: number;
  material: MaterialSummary;
  materialLabel: string;
  plannerBlockId?: number;
  onPlannerStateChange?: () => void;
}

type SessionAction = 'start' | 'checkpoint' | 'partial' | 'complete' | 'failed' | 'skip';

const progressLabel: Record<ProgressState['status'], string> = {
  unread: 'Não iniciado',
  in_progress: 'Em andamento',
  covered: 'Coberto',
  stale: 'Desatualizado',
  weak: 'Fraco',
  strong: 'Forte',
};

const errorMessage = (error: unknown): string => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Falha inesperada na sessão local.';
};

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const newIdempotencyKey = (
  targetSlug: string,
  lessonId: number,
  materialId: number,
): string => {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `study-${targetSlug}-${lessonId}-${materialId}-${random}`;
};

export const StudySessionPanel: React.FC<StudySessionPanelProps> = ({
  targetSlug,
  lessonId,
  material,
  materialLabel,
  plannerBlockId,
  onPlannerStateChange,
}) => {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [session, setSession] = useState<StudySession | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(material.pageCount);
  const [confirmedPage, setConfirmedPage] = useState(1);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [skipReason, setSkipReason] = useState<SkipReason>('lack_of_time');
  const [loading, setLoading] = useState(material.available);
  const [action, setAction] = useState<SessionAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const startKeyRef = useRef<string | null>(null);

  const loadSession = useCallback(async (signal?: AbortSignal) => {
    if (!material.available) {
      setLoading(false);
      setProgress(null);
      setSession(null);
      return;
    }
    const storedProgress = await fetchProgress(
      targetSlug,
      lessonId,
      material.id,
      signal,
    );
    let activeSession: StudySession | null = null;
    try {
      activeSession = await fetchActiveStudySession(
        targetSlug,
        lessonId,
        material.id,
        signal,
      );
    } catch (error: unknown) {
      if (!(error instanceof StudyOsApiError && error.status === 404)) throw error;
    }
    if (activeSession && material.pageCount === null) {
      const inspection = await inspectMaterial(material.id, targetSlug);
      setPageCount(inspection.pageCount);
    }
    setProgress(storedProgress);
    setSession(activeSession);
    setConfirmedPage(Math.max(
      storedProgress.cursorPage,
      activeSession?.endPage ?? activeSession?.startPage ?? storedProgress.cursorPage,
    ));
    setElapsedMinutes(elapsedSecondsToMinutes(activeSession?.elapsedSeconds ?? 0));
    setLoading(false);
  }, [lessonId, material.available, material.id, material.pageCount, targetSlug]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(material.available);
    setProgress(null);
    setSession(null);
    setPageCount(material.pageCount);
    setConfirmedPage(1);
    setElapsedMinutes(0);
    setNotice(null);
    setAction(null);
    startKeyRef.current = null;
    loadSession(controller.signal).catch((error: unknown) => {
      if (isAbort(error)) return;
      setLoading(false);
      setNotice(errorMessage(error));
    });
    return () => controller.abort();
  }, [loadSession, material.available, material.pageCount]);

  const view = useMemo(
    () => buildSessionView(progress, material.available),
    [material.available, progress],
  );

  const minimumPage = progress?.cursorPage ?? session?.startPage ?? 1;
  const minimumMinutes = elapsedSecondsToMinutes(session?.elapsedSeconds ?? 0);
  const boundedPage = clampConfirmedPage(confirmedPage, minimumPage, pageCount);
  const viewerUrl = `${material.fileUrl}?targetSlug=${encodeURIComponent(targetSlug)}#page=${view.startPage}`;
  const absoluteViewerUrl = new URL(viewerUrl, window.location.href).toString();

  const refreshAfterConflict = async (error: unknown) => {
    setNotice(errorMessage(error));
    if (error instanceof StudyOsApiError && [409, 422].includes(error.status)) {
      try {
        await loadSession();
      } catch (refreshError: unknown) {
        setNotice(errorMessage(refreshError));
      }
    }
  };

  const handleStart = async () => {
    if (!material.available) return;
    const viewer = window.open(absoluteViewerUrl, 'study-os-material');
    if (!viewer) {
      setNotice('O navegador bloqueou a janela do PDF. Libere pop-ups para este app local.');
      return;
    }
    if (session?.state === 'active') {
      return;
    }

    setAction('start');
    setNotice(null);
    try {
      const inspection = await inspectMaterial(material.id, targetSlug);
      setPageCount(inspection.pageCount);
      startKeyRef.current ??= newIdempotencyKey(targetSlug, lessonId, material.id);
      const started = await startStudySession({
        targetSlug,
        lessonId,
        materialId: material.id,
        ...(plannerBlockId ? { plannerBlockId } : {}),
      }, startKeyRef.current);
      setProgress(started.progress);
      setSession(started.session);
      setConfirmedPage(started.progress.cursorPage);
      setElapsedMinutes(elapsedSecondsToMinutes(started.session.elapsedSeconds));
      const confirmedUrl = new URL(started.openUrl, window.location.href).toString();
      if (confirmedUrl !== absoluteViewerUrl) {
        window.open(confirmedUrl, 'study-os-material');
      }
      onPlannerStateChange?.();
    } catch (error: unknown) {
      viewer.close();
      await refreshAfterConflict(error);
    } finally {
      setAction(null);
    }
  };

  const runCheckpoint = async () => {
    if (!session) return;
    setAction('checkpoint');
    setNotice(null);
    try {
      const result = await checkpointStudySession(session.id, {
        endPage: boundedPage,
        elapsedSeconds: elapsedMinutesToSeconds(elapsedMinutes),
        expectedVersion: session.version,
      });
      setSession(result.session);
      setProgress(result.progress);
      setConfirmedPage(result.progress.cursorPage);
      setNotice(`Checkpoint salvo na página ${result.progress.cursorPage}.`);
    } catch (error: unknown) {
      await refreshAfterConflict(error);
    } finally {
      setAction(null);
    }
  };

  const runFinish = async (outcome: 'partial' | 'completed' | 'failed') => {
    if (!session) return;
    const nextAction: SessionAction = outcome === 'partial'
      ? 'partial'
      : outcome === 'completed'
        ? 'complete'
        : 'failed';
    setAction(nextAction);
    setNotice(null);
    try {
      const result = await finishStudySession(session.id, {
        outcome,
        endPage: boundedPage,
        elapsedSeconds: elapsedMinutesToSeconds(elapsedMinutes),
        questionsDone: 0,
        correctCount: 0,
        wrongCount: 0,
        doubtCount: 0,
        favoriteCount: 0,
        notes: '',
        expectedVersion: session.version,
      });
      setProgress(result.progress);
      setSession(null);
      setConfirmedPage(result.progress.cursorPage);
      startKeyRef.current = null;
      setNotice(outcome === 'completed'
        ? 'Aula concluída e cursor confirmado.'
        : outcome === 'failed'
          ? 'Dificuldade registrada para o próximo planejamento.'
          : `Sessão parcial salva na página ${result.progress.cursorPage}.`);
      onPlannerStateChange?.();
    } catch (error: unknown) {
      await refreshAfterConflict(error);
    } finally {
      setAction(null);
    }
  };

  const runSkip = async () => {
    if (!session) return;
    setAction('skip');
    setNotice(null);
    try {
      const result = await skipStudySession(session.id, {
        reason: skipReason,
        notes: '',
        expectedVersion: session.version,
      });
      setProgress(result.progress);
      setSession(null);
      setConfirmedPage(result.progress.cursorPage);
      startKeyRef.current = null;
      setNotice('Pulo registrado sem perder o ponto de retomada.');
      onPlannerStateChange?.();
    } catch (error: unknown) {
      await refreshAfterConflict(error);
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="min-w-0 border border-[#84cc16]/35 bg-[#84cc16]/5">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <FileText className="h-4 w-4 text-[#84cc16]" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 truncate text-xs font-black text-white" title={material.relativePath}>{materialLabel}</p>
            <span className="text-[9px] font-black uppercase tracking-widest text-[#bef264]">Primário</span>
          </div>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Confiança {material.trustLevel}
            {progress ? ` · ${progressLabel[progress.status]}` : ''}
            {pageCount ? ` · ${pageCount} páginas` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={loading || action !== null || !material.available}
          className="col-span-2 flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#84cc16] px-3 text-[10px] font-black uppercase text-black hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-45 sm:col-span-1 sm:w-auto"
        >
          {loading || action === 'start'
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          {loading ? 'Carregando' : view.commandLabel}
        </button>
      </div>

      {session ? (
        <div className="border-t border-[#84cc16]/20 bg-[#111]/65 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#d9f99d]">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              Sessão ativa · início p. {session.startPage}
            </div>
            <a
              href={viewerUrl}
              target="study-os-material"
              rel="noreferrer"
              className="flex h-7 items-center gap-1 rounded px-2 text-[10px] font-black uppercase text-gray-300 hover:bg-white/10"
            >
              PDF <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(120px,0.7fr)_minmax(120px,0.7fr)_minmax(0,1.6fr)]">
            <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Página confirmada
              <input
                type="number"
                min={minimumPage}
                max={pageCount ?? undefined}
                value={confirmedPage}
                onChange={(event) => setConfirmedPage(Number(event.target.value))}
                onBlur={() => setConfirmedPage(boundedPage)}
                className="h-9 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-2 text-sm font-black text-white outline-none focus:border-[#84cc16]"
              />
            </label>
            <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Minutos totais
              <input
                type="number"
                min={minimumMinutes}
                step="1"
                value={elapsedMinutes}
                onChange={(event) => setElapsedMinutes(Math.max(minimumMinutes, Number(event.target.value)))}
                className="h-9 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-2 text-sm font-black text-white outline-none focus:border-[#84cc16]"
              />
            </label>
            <div className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500 sm:col-span-2 lg:col-span-1">
              Motivo do pulo
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1">
                <select
                  value={skipReason}
                  onChange={(event) => setSkipReason(event.target.value as SkipReason)}
                  className="h-9 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-2 text-xs font-bold normal-case text-white outline-none focus:border-yellow-300"
                >
                  {skipReasonChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>{choice.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runSkip}
                  disabled={action !== null}
                  className="flex h-9 items-center gap-1 rounded border border-yellow-300/25 bg-yellow-300/5 px-2 text-[10px] font-black uppercase text-yellow-100 hover:bg-yellow-300/10 disabled:opacity-40"
                >
                  {action === 'skip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
                  Pular
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <SessionCommand
              label="Checkpoint"
              icon={Save}
              busy={action === 'checkpoint'}
              disabled={action !== null}
              onClick={runCheckpoint}
            />
            <SessionCommand
              label="Salvar parcial"
              icon={Pause}
              busy={action === 'partial'}
              disabled={action !== null}
              onClick={() => runFinish('partial')}
            />
            <SessionCommand
              label="Concluir aula"
              icon={CheckCircle2}
              busy={action === 'complete'}
              disabled={action !== null || !view.canComplete}
              accent="success"
              onClick={() => runFinish('completed')}
            />
            <SessionCommand
              label="Registrar falha"
              icon={Flag}
              busy={action === 'failed'}
              disabled={action !== null}
              accent="danger"
              onClick={() => runFinish('failed')}
            />
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start gap-2 border-t border-white/5 px-3 py-2 text-xs font-bold text-yellow-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-300" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
};

const SessionCommand: React.FC<{
  label: string;
  icon: React.ElementType;
  busy: boolean;
  disabled: boolean;
  accent?: 'success' | 'danger';
  onClick: () => void;
}> = ({ label, icon: Icon, busy, disabled, accent, onClick }) => {
  const color = accent === 'success'
    ? 'border-[#84cc16]/35 bg-[#84cc16]/10 text-[#d9f99d] hover:bg-[#84cc16]/20'
    : accent === 'danger'
      ? 'border-red-300/25 bg-red-300/5 text-red-100 hover:bg-red-300/10'
      : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 items-center gap-1.5 rounded border px-2.5 text-[10px] font-black uppercase disabled:cursor-not-allowed disabled:opacity-40 ${color}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
};
