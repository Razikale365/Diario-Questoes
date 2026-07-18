import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Target,
  Timer,
  X,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import { TaskExecutionFields } from '../../components/TaskExecutionFields';
import { parseTaskExecutionDraft, type TaskExecutionDraft } from '../../utils/taskResultDraft';
import { announceStudyOsDataChanged } from '../dataChanged';
import {
  buildSprintActionExecutionInput,
  mergeSavedSprintAction,
  resultRefreshNotice,
  subscribeStudyOsDataChanged,
} from './executionUiState';
import { createCalendarRequestGate } from './SprintCalendarControl';
import {
  fetchOptionalSprintDay,
  fetchSourcePlanTasks,
  fetchSprintConfig,
  fetchSprintEvidence,
  fetchSprintProjection,
  fetchSprintTrajectory,
  generateSprintDay,
  recordSourceTaskExecution,
  refreshSprintDay,
  updateSprintAction,
  type SprintAction,
  type SprintActionState,
  type SprintConfig,
  type SprintDay,
  type SprintEvidenceList,
  type SprintProjection,
  type SprintRecommendation,
  type SprintTrajectory,
  type SourcePlanTask,
} from '../api/sprint';


interface SprintCommandCenterProps {
  targetSlug: string;
  onOpenSourceTask: (taskId: string) => void;
  showToast: (message: string) => void;
}

interface ResultDraft {
  state: Extract<SprintActionState, 'completed' | 'skipped' | 'failed'>;
  actualMinutes: number;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  energyAfter: number;
}

const executionDraftForAction = (action: SprintAction, energy: number): TaskExecutionDraft => ({
  performedOn: isoToday(),
  taskMinutes: `${action.durationMinutes}`,
  exerciseMinutes: '0',
  questionsTotal: `${action.plannedQuestions}`,
  correctCount: '0',
  wrongCount: '0',
  doubtCount: '0',
  energyAfter: energy,
  notes: '',
});

const recommendationLabel: Record<SprintRecommendation, string> = {
  execute: 'Executar',
  compress: 'Comprimir',
  defer: 'Adiar',
  extra: 'Intervenção',
};

const recommendationTone: Record<SprintRecommendation, string> = {
  execute: 'border-l-[#84cc16]',
  compress: 'border-l-amber-300',
  defer: 'border-l-rose-400',
  extra: 'border-l-sky-400',
};

const recommendationBadge: Record<SprintRecommendation, string> = {
  execute: 'border-[#84cc16]/30 bg-[#84cc16]/10 text-[#bef264]',
  compress: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  defer: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  extra: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
};

const isoToday = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const shiftDate = (value: string, delta: number) => {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + delta);
  return next.toISOString().slice(0, 10);
};

const formatDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', {
  weekday: 'long', day: '2-digit', month: 'long',
});

const mutationKey = (prefix: string, date: string) => {
  const suffix = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${date}-${suffix}`;
};

const errorMessage = (error: unknown) => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Falha inesperada no Sprint local.';
};

export const defaultSprintResult = (action: SprintAction, energy: number): ResultDraft => ({
  state: 'completed',
  actualMinutes: action.durationMinutes,
  questionsDone: 0,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  energyAfter: energy,
});

export const sprintDecisionState = (
  accept: boolean,
  deferred: boolean,
): SprintActionState => (accept && !deferred ? 'active' : 'skipped');

const promptForAction = (action: SprintAction) => [
  'Estou na reta final da SEFAZ CE 2026, banca FCC.',
  `${action.paper}, ${action.subjectName}: ${action.topicHint || action.title}.`,
  `Bloco de ${action.durationMinutes} minutos${action.plannedQuestions ? ` e ${action.plannedQuestions} questões` : ''}.`,
  `Motivo da prioridade: ${action.whyNow}`,
  action.questionRefs.length
    ? `Vou refazer estas questões locais: ${action.questionRefs.map((item) => item.questionFingerprint).join(', ')}.`
    : '',
  'Ajude apenas na execução deste bloco. Corrija a causa dos erros e termine com uma verificação curta.',
].filter(Boolean).join('\n');

const scoreEntries = (details: Record<string, unknown>) => Object.entries(details);

const formatScoreValue = (value: unknown) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return 'indisponível';
  }
};

const formatPercent = (basisPoints: number | null | undefined) => basisPoints === null || basisPoints === undefined
  ? '—'
  : `${(basisPoints / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

const formatScore = (value: number | null | undefined) => value === null || value === undefined
  ? '—'
  : value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const tecUrlForAction = (action: SprintAction) => {
  const candidate = action.scoreDetails.tecUrl;
  if (typeof candidate !== 'string' || !candidate) return 'https://www.tecconcursos.com.br/questoes/cadernos';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && (parsed.hostname === 'tecconcursos.com.br' || parsed.hostname.endsWith('.tecconcursos.com.br'))
      ? parsed.toString()
      : 'https://www.tecconcursos.com.br/questoes/cadernos';
  } catch {
    return 'https://www.tecconcursos.com.br/questoes/cadernos';
  }
};

export const SprintCommandCenter: React.FC<SprintCommandCenterProps> = ({
  targetSlug,
  onOpenSourceTask,
  showToast,
}) => {
  const [config, setConfig] = useState<SprintConfig | null>(null);
  const [day, setDay] = useState<SprintDay | null>(null);
  const [projection, setProjection] = useState<SprintProjection | null>(null);
  const [trajectory, setTrajectory] = useState<SprintTrajectory | null>(null);
  const [evidence, setEvidence] = useState<SprintEvidenceList | null>(null);
  const [sourceTasks, setSourceTasks] = useState<SourcePlanTask[]>([]);
  const [date, setDate] = useState(isoToday);
  const [energy, setEnergy] = useState(3);
  const [manualOverride, setManualOverride] = useState(false);
  const [overrideP1, setOverrideP1] = useState<number | null>(null);
  const [overrideP2, setOverrideP2] = useState<number | null>(null);
  const [lsBudgetMinutes, setLsBudgetMinutes] = useState(240);
  const [extraBudgetMinutes, setExtraBudgetMinutes] = useState(60);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minimumMode, setMinimumMode] = useState(false);
  const [resultActionId, setResultActionId] = useState<number | null>(null);
  const [resultDraft, setResultDraft] = useState<ResultDraft | null>(null);
  const [executionDraft, setExecutionDraft] = useState<TaskExecutionDraft | null>(null);
  const [executionErrors, setExecutionErrors] = useState<Partial<Record<keyof TaskExecutionDraft, string>>>({});
  const dayRequestGateRef = useRef<ReturnType<typeof createCalendarRequestGate> | null>(null);
  if (!dayRequestGateRef.current) dayRequestGateRef.current = createCalendarRequestGate();

  const refreshAuditState = useCallback(async () => {
    const [nextTrajectory, nextEvidence, nextSourceTasks] = await Promise.all([
      fetchSprintTrajectory(targetSlug),
      fetchSprintEvidence(targetSlug),
      fetchSourcePlanTasks(targetSlug, undefined, true),
    ]);
    setTrajectory(nextTrajectory);
    setEvidence(nextEvidence);
    setSourceTasks(nextSourceTasks.items);
  }, [targetSlug]);

  const load = useCallback(async (parentSignal?: AbortSignal) => {
    const request = dayRequestGateRef.current!.begin(parentSignal);
    setLoading(true);
    setError(null);
    try {
      const [nextConfig, nextDay, nextProjection, nextTrajectory, nextEvidence, nextSourceTasks] = await Promise.all([
        fetchSprintConfig(targetSlug, request.signal),
        fetchOptionalSprintDay(targetSlug, date, request.signal),
        fetchSprintProjection(targetSlug, date, request.signal),
        fetchSprintTrajectory(targetSlug, request.signal),
        fetchSprintEvidence(targetSlug, request.signal),
        fetchSourcePlanTasks(targetSlug, undefined, true, request.signal),
      ]);
      dayRequestGateRef.current!.applyIfCurrent(request, () => {
        setConfig(nextConfig);
        setDay(nextDay);
        setProjection(nextDay?.projection ?? nextProjection);
        setTrajectory(nextTrajectory);
        setEvidence(nextEvidence);
        setSourceTasks(nextSourceTasks.items);
        setLsBudgetMinutes(nextDay?.capacity.lsBudgetMinutes ?? nextConfig.lsBudgetMinutes);
        setExtraBudgetMinutes(nextDay?.capacity.extraBudgetMinutes ?? nextConfig.extraBudgetMinutes);
        if (nextDay) {
          setEnergy(nextDay.capacity.energyLevel);
          const isManual = nextDay.projectionOrigin === 'manual';
          setManualOverride(isManual);
          setOverrideP1(isManual ? nextDay.projections.p1 : null);
          setOverrideP2(isManual ? nextDay.projections.p2 : null);
        } else {
          setManualOverride(false);
          setOverrideP1(null);
          setOverrideP2(null);
        }
      });
    } catch (loadError) {
      dayRequestGateRef.current!.applyIfCurrent(request, () => setError(errorMessage(loadError)));
    } finally {
      dayRequestGateRef.current!.applyIfCurrent(request, () => setLoading(false));
    }
  }, [date, targetSlug]);

  const projectedP1 = projection?.p1.projected ?? day?.projections.p1 ?? null;
  const projectedP2 = projection?.p2.projected ?? day?.projections.p2 ?? null;
  const effectiveP1 = manualOverride ? overrideP1 : projectedP1;
  const effectiveP2 = manualOverride ? overrideP2 : projectedP2;

  const currentCycle = useMemo(() => sourceTasks
    .map((task) => task.cycle)
    .filter((cycle): cycle is NonNullable<SourcePlanTask['cycle']> => cycle !== null)
    .filter((cycle, index, cycles) => cycles.findIndex((candidate) => candidate.id === cycle.id) === index)
    .sort((left, right) => right.startsOn.localeCompare(left.startsOn))
    .find((cycle) => cycle.startsOn <= date && date <= cycle.endsOn) ?? null, [date, sourceTasks]);

  const backlogTasks = useMemo(() => sourceTasks
    .filter((task) => task.backlog?.state === 'candidate')
    .sort((left, right) => (right.backlog?.returnScoreMilli ?? 0) - (left.backlog?.returnScoreMilli ?? 0)), [sourceTasks]);

  const aggregateFragilityBp = projection?.subjects.reduce(
    (maximum, subject) => Math.max(maximum, subject.fragilityBp),
    0,
  ) ?? null;
  const daysRemaining = day?.daysRemaining ?? (config
    ? Math.max(0, Math.ceil((new Date(`${config.objectiveDate}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000))
    : null);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    return subscribeStudyOsDataChanged(window, targetSlug, ['sprint-day'], () => void load());
  }, [load, targetSlug]);

  useEffect(() => () => dayRequestGateRef.current?.dispose(), [targetSlug]);

  const createDay = async (
    refresh: boolean,
    announce = true,
  ): Promise<SprintDay | null> => {
    const mutationRequest = dayRequestGateRef.current!.begin();
    setLoading(false);
    setBusy(refresh ? 'refresh' : 'generate');
    setError(null);
    try {
      const input = {
        targetSlug,
        date,
        energyLevel: energy,
        lsBudgetMinutes,
        extraBudgetMinutes,
        ...(manualOverride && effectiveP1 !== null && effectiveP2 !== null
          ? { p1Projection: effectiveP1, p2Projection: effectiveP2 }
          : {}),
      };
      const next = refresh
        ? await refreshSprintDay(input, mutationKey('refresh-sprint', date))
        : await generateSprintDay(input, mutationKey('generate-sprint', date));
      if (!dayRequestGateRef.current!.isCurrent(mutationRequest)) return null;
      setDay(next);
      setProjection(next.projection ?? projection);
      setMinimumMode(false);
      try {
        await refreshAuditState();
      } catch (auditError) {
        setError(`Dia atualizado, mas a auditoria não foi recarregada: ${errorMessage(auditError)}`);
        return null;
      }
      if (announce) showToast(refresh ? 'Dia recalculado.' : 'Sprint do dia gerado.');
      return next;
    } catch (mutationError) {
      setError(errorMessage(mutationError));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const confirmAction = async (action: SprintAction, accept: boolean) => {
    setBusy(`action-${action.id}`);
    try {
      const deferred = action.recommendation === 'defer';
      const saved = await updateSprintAction(action.id, {
        expectedVersion: action.version,
        decision: accept ? 'accepted' : 'rejected',
        state: sprintDecisionState(accept, deferred),
        questionsDone: 0,
        correctCount: 0,
        wrongCount: 0,
        doubtCount: 0,
      }, mutationKey(`decision-${action.id}`, date));
      setDay((current) => current ? {
        ...current,
        actions: current.actions.map((item) => item.id === saved.id ? saved : item),
      } : current);
      if (accept && deferred) await createDay(true);
      else showToast(accept ? 'Decisão confirmada.' : 'Sugestão recusada.');
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(null);
    }
  };

  const submitResult = async (action: SprintAction) => {
    if (!resultDraft || !executionDraft || action.sourcePlanTaskId === null) return;
    const parsed = parseTaskExecutionDraft(executionDraft);
    if (!parsed.ok) {
      setExecutionErrors(parsed.errors);
      return;
    }
    setBusy(`result-${action.id}`);
    try {
      const { performanceBp: _derivedPerformanceBp, ...executionInput } = parsed.value;
      const saved = await recordSourceTaskExecution(
        action.sourcePlanTaskId,
        buildSprintActionExecutionInput(action, resultDraft.state, executionInput),
        mutationKey(`result-${action.id}`, date),
      );
      setDay((current) => current ? mergeSavedSprintAction(current, saved) : current);
      setResultActionId(null);
      setResultDraft(null);
      setExecutionDraft(null);
      setExecutionErrors({});
      setEnergy(parsed.value.energyAfter);
      const refreshed = await createDay(true, false);
      if (!refreshed) {
        try {
          await refreshAuditState();
        } catch (auditError) {
          setError(`Resultado salvo; recálculo e auditoria pendentes: ${errorMessage(auditError)}`);
        }
      }
      announceStudyOsDataChanged({
        targetSlug,
        taskId: action.sourcePlanTaskId,
        resources: ['source-plan', 'sprint-day', 'calendar', 'evidence'],
      });
      showToast(resultRefreshNotice(Boolean(refreshed)));
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(null);
    }
  };

  const copyPrompt = async (action: SprintAction) => {
    try {
      await navigator.clipboard.writeText(promptForAction(action));
      showToast('Prompt do bloco copiado.');
    } catch {
      showToast('Não foi possível copiar o prompt.');
    }
  };

  const visibleActions = useMemo(() => {
    if (!day) return [];
    if (!minimumMode) return day.actions;
    const ids = new Set(day.minimumViable.actionIds);
    return day.actions.filter((action) => ids.has(action.id));
  }, [day, minimumMode]);

  const lsActions = visibleActions.filter((action) => action.sourcePlanTaskId !== null);
  const extraActions = visibleActions.filter((action) => action.sourcePlanTaskId === null);
  const activeResult = day?.actions.find((action) => action.id === resultActionId) || null;
  if (loading) {
    return (
      <section className="flex min-h-48 items-center justify-center border-y border-white/10 bg-[#202020]">
        <Loader2 className="h-6 w-6 animate-spin text-[#84cc16]" />
      </section>
    );
  }

  return (
    <>
      <section className="overflow-hidden border-y border-[#404040] bg-[#202020]">
      <div className="border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[#bef264]">SEFAZ CE · FCC</span>
              <span className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase text-gray-300">
                {day?.modeLabel || 'Reta final tática'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <strong className="text-3xl font-black text-white">{daysRemaining ?? '—'}</strong>
              <span className="text-xs font-black uppercase tracking-widest text-gray-400">dias para a P1</span>
            </div>
            <p className="mt-1 text-sm font-bold capitalize text-gray-400">{formatDate(date)}</p>
          </div>

          <div className="flex items-center gap-1 rounded border border-white/10 bg-[#171717] p-1">
            <button type="button" title="Dia anterior" onClick={() => setDate((value) => shiftDate(value, -1))} className="grid h-9 w-9 place-items-center rounded text-gray-300 hover:bg-white/10 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setDate(isoToday())} className="h-9 px-3 text-[10px] font-black uppercase text-gray-200 hover:bg-white/10">Hoje</button>
            <button type="button" title="Próximo dia" onClick={() => setDate((value) => shiftDate(value, 1))} className="grid h-9 w-9 place-items-center rounded text-gray-300 hover:bg-white/10 hover:text-white">
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-5">
          <ProjectionMetric
            label="Projeção P1"
            value={effectiveP1}
            target={`piso ${config?.goals.p1Floor ?? 48} · stretch 64`}
            interval={projection ? `${formatScore(projection.p1.low)}–${formatScore(projection.p1.high)}` : null}
            manual={manualOverride}
            onChange={(value) => setOverrideP1(value)}
          />
          <ProjectionMetric
            label="Projeção P2"
            value={effectiveP2}
            target={`piso ${config?.goals.p2Low ?? 63} · stretch 70`}
            interval={projection ? `${formatScore(projection.p2.low)}–${formatScore(projection.p2.high)}` : null}
            manual={manualOverride}
            onChange={(value) => setOverrideP2(value)}
          />
          <div className="col-span-2 min-h-16 border border-[#84cc16]/25 bg-[#84cc16]/[0.06] px-3 py-2 xl:col-span-1">
            <span className="text-[9px] font-black uppercase tracking-widest text-[#bef264]">Meta ponderada</span>
            <div className="mt-1 flex items-baseline justify-between gap-2"><strong className="text-lg font-black text-white">204/240</strong><span className="text-xs font-black text-[#bef264]">85%</span></div>
            <p className="mt-1 text-[9px] font-bold leading-tight text-gray-400">equivalente bruto · não é a nota padronizada da FCC</p>
          </div>
          <CapacityMetric
            lsMinutes={lsBudgetMinutes}
            extraMinutes={extraBudgetMinutes}
            onLsChange={setLsBudgetMinutes}
            onExtraChange={setExtraBudgetMinutes}
          />
          <div className="col-span-2 flex min-h-16 items-center justify-between gap-3 border border-white/10 bg-[#171717] px-3 py-2 xl:col-span-1">
            <div><span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Energia</span><p className="mt-1 text-sm font-black text-white">{energy}/5</p></div>
            <div className="flex gap-1" aria-label="Energia disponível">
              {[1, 2, 3, 4, 5].map((level) => (
                <button key={level} type="button" title={`Energia ${level}`} onClick={() => setEnergy(level)} className={`h-7 w-7 rounded text-[10px] font-black ${energy === level ? 'bg-[#84cc16] text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>{level}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <AuditMetric label="Confiança" value={formatPercent(projection?.confidenceBp)} detail={projection?.formulaVersion ?? 'sem projeção derivada'} />
          <AuditMetric label="Fragilidade" value={formatPercent(aggregateFragilityBp)} detail="maior fragilidade entre as matérias" />
          <AuditMetric label="Origem dominante" value={projection?.dominantOrigin || '—'} detail={`${evidence?.items.length ?? 0} evidências agregadas`} />
          <AuditMetric
            label="Ciclo vigente"
            value={currentCycle ? `Meta ${currentCycle.metaNumber ?? currentCycle.planLabel}` : 'Sem ciclo vigente'}
            detail={currentCycle ? `${currentCycle.startsOn} → ${currentCycle.endsOn}` : `${backlogTasks.length} no backlog`}
          />
        </div>

        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-[10px] font-black uppercase tracking-wide text-gray-300">
          <input
            type="checkbox"
            checked={manualOverride}
            onChange={(event) => {
              const enabled = event.target.checked;
              setManualOverride(enabled);
              setOverrideP1(enabled ? (overrideP1 ?? projectedP1) : null);
              setOverrideP2(enabled ? (overrideP2 ?? projectedP2) : null);
            }}
            className="h-4 w-4 accent-[#84cc16]"
          />
          Usar override manual
          <span className="normal-case tracking-normal text-gray-500">(fica identificado no histórico)</span>
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!day ? (
            <button type="button" onClick={() => void createDay(false)} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded bg-[#84cc16] px-4 text-xs font-black uppercase text-black hover:bg-[#65a30d] disabled:opacity-50">
              {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Gerar dia
            </button>
          ) : (
            <button type="button" onClick={() => void createDay(true)} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded border border-white/15 bg-white/5 px-4 text-xs font-black uppercase text-white hover:bg-white/10 disabled:opacity-50">
              {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Recalcular
            </button>
          )}
          {day && (
            <button type="button" onClick={() => setMinimumMode((value) => !value)} className={`inline-flex h-10 items-center gap-2 rounded border px-4 text-xs font-black uppercase ${minimumMode ? 'border-amber-300/40 bg-amber-300/15 text-amber-100' : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'}`}>
              <ShieldCheck className="h-4 w-4" /> Dia mínimo viável
            </button>
          )}
        </div>
        {error && <div className="mt-3 flex items-center justify-between gap-3 border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm font-bold text-rose-100"><span>{error}</span><button type="button" title="Fechar" onClick={() => setError(null)}><X className="h-4 w-4" /></button></div>}
      </div>

      {day ? (
        <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(19rem,0.85fr)]">
          <div className="border-b border-white/10 p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <QueueSection title="Fila LS" count={lsActions.length} actions={lsActions} busy={busy} resultActionId={resultActionId} onConfirm={confirmAction} onResult={(action) => { setResultActionId(action.id); setResultDraft(defaultSprintResult(action, energy)); setExecutionDraft(executionDraftForAction(action, energy)); setExecutionErrors({}); }} onOpen={onOpenSourceTask} onPrompt={copyPrompt} />
          </div>
          <div className="bg-[#1b1b1b] p-4 sm:p-5">
            <QueueSection title="Intervenções" count={extraActions.length} actions={extraActions} busy={busy} resultActionId={resultActionId} onConfirm={confirmAction} onResult={(action) => { setResultActionId(action.id); setResultDraft(defaultSprintResult(action, energy)); setExecutionDraft(executionDraftForAction(action, energy)); setExecutionErrors({}); }} onOpen={onOpenSourceTask} onPrompt={copyPrompt} />
          </div>
        </div>
      ) : (
        <div className="px-4 py-12 text-center sm:px-5">
          <Target className="mx-auto h-8 w-8 text-gray-600" />
          <p className="mt-3 text-lg font-black text-white">Nenhum Sprint gerado para este dia</p>
          <p className="mt-1 text-sm font-bold text-gray-500">Importe a Meta 47 ou gere apenas as intervenções táticas.</p>
        </div>
      )}

      <details className="border-t border-white/10 bg-[#171717] px-4 py-3 sm:px-5">
        <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.18em] text-gray-300 hover:text-white">Auditoria da calibração, ciclos e trajetória</summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <AuditPanel title="Projeção derivada">
            <dl className="space-y-2 text-xs">
              <AuditRow label="Ponderado" value={projection ? `${formatScore(projection.weighted.projected)}/240` : '—'} />
              <AuditRow label="Faixa 90%" value={projection ? `${formatScore(projection.weighted.low)}–${formatScore(projection.weighted.high)}` : '—'} />
              <AuditRow label="Distância para 204" value={projection ? formatScore(projection.weighted.distanceToTarget) : '—'} />
              <AuditRow label="Confiança" value={formatPercent(projection?.confidenceBp)} />
              <AuditRow label="Origem dominante" value={projection?.dominantOrigin || '—'} />
              <AuditRow label="Origem do dia" value={day?.projectionOrigin || 'sem dia gerado'} />
            </dl>
            {projection?.warnings.length ? <ul className="mt-3 space-y-1 text-[10px] font-semibold text-amber-200">{projection.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul> : null}
          </AuditPanel>

          <AuditPanel title="Ciclo vigente e backlog">
            {currentCycle ? <p className="text-xs font-bold text-gray-300">Meta {currentCycle.metaNumber ?? currentCycle.planLabel}: {currentCycle.startsOn} → {currentCycle.endsOn}</p> : <p className="text-xs font-bold text-gray-500">Nenhum ciclo cobre a data selecionada.</p>}
            <p className="mt-3 text-[9px] font-black uppercase tracking-widest text-gray-500">Backlog da meta encerrada</p>
            <div className="mt-2 space-y-2">
              {backlogTasks.length ? backlogTasks.map((task) => <div key={task.id} className="border border-white/10 bg-white/[0.03] p-2"><p className="text-xs font-black text-gray-200">{task.discipline}</p><p className="mt-1 text-[10px] font-semibold text-gray-500">{task.topicHint || task.description} · retorno {formatScore((task.backlog?.returnScoreMilli ?? 0) / 1000)}</p></div>) : <p className="text-xs font-bold text-gray-600">Sem pendências elegíveis.</p>}
            </div>
          </AuditPanel>

          <AuditPanel title="Trajetória e evidência">
            <p className="text-xs font-bold text-gray-300">{trajectory?.runs.length ?? 0} snapshots congelados · {evidence?.items.length ?? 0} observações agregadas</p>
            <p className="mt-1 text-[10px] font-semibold text-gray-500">{evidence?.unresolvedCount ?? 0} observações sem matéria resolvida</p>
            <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
              {trajectory?.runs.slice().reverse().map((run, index) => <div key={`${run.runId ?? 'latest'}-${run.date ?? index}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/5 pb-2 text-[10px]"><span className="font-bold text-gray-400">{run.date || 'atual'} · {run.projectionOrigin || 'sem origem'}</span><span className="font-black text-gray-200">{formatScore(run.weightedProjected)}/240</span></div>)}
            </div>
          </AuditPanel>
        </div>
      </details>

      </section>
      {activeResult && resultDraft && executionDraft && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#05070d]/85 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="sprint-result-title"
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto border border-white/10 bg-[#262626] p-4 shadow-2xl shadow-black/50 sm:rounded-xl sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-[#bef264]">Registrar execução</p><h3 id="sprint-result-title" className="mt-1 font-black text-white">{activeResult.title}</h3></div>
              <button type="button" aria-label="Fechar registro de execução" title="Fechar" onClick={() => { setResultActionId(null); setResultDraft(null); setExecutionDraft(null); setExecutionErrors({}); }} className="grid h-8 w-8 place-items-center rounded bg-white/5 text-gray-300 hover:bg-white/10"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <ResultSelect value={resultDraft.state} onChange={(value) => setResultDraft({ ...resultDraft, state: value })} />
            </div>
            <div className="mt-3"><TaskExecutionFields draft={executionDraft} errors={executionErrors} onChange={setExecutionDraft} /></div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => void submitResult(activeResult)} disabled={busy !== null} className="inline-flex h-10 items-center gap-2 rounded bg-[#84cc16] px-4 text-xs font-black uppercase text-black hover:bg-[#65a30d] disabled:opacity-50">{busy === `result-${activeResult.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salvar e recalcular</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};

const ProjectionMetric: React.FC<{
  label: string;
  value: number | null;
  target: string;
  interval: string | null;
  manual: boolean;
  onChange: (value: number) => void;
}> = ({ label, value, target, interval, manual, onChange }) => (
  <div className="flex min-h-16 items-center justify-between gap-3 border border-white/10 bg-[#171717] px-3 py-2">
    <span><span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</span><span className="mt-1 block text-[10px] font-bold text-gray-400">{target}</span>{interval && <span className="mt-0.5 block text-[9px] font-semibold text-gray-500">faixa 90% {interval}</span>}</span>
    {manual ? <input aria-label={`${label} manual`} type="number" min={0} max={80} value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))} className="h-9 w-16 rounded border border-amber-300/30 bg-[#0d0d0d] text-center text-lg font-black text-amber-100 outline-none focus:border-amber-300" /> : <strong className="text-xl font-black text-white">{formatScore(value)}</strong>}
  </div>
);

const AuditMetric: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="border border-white/10 bg-[#171717] px-3 py-2">
    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{label}</span>
    <p className="mt-1 truncate text-sm font-black text-white" title={value}>{value}</p>
    <p className="mt-0.5 truncate text-[9px] font-semibold text-gray-600" title={detail}>{detail}</p>
  </div>
);

const AuditPanel: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <section className="border border-white/10 bg-[#202020] p-3">
    <h3 className="mb-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#bef264]">{title}</h3>
    {children}
  </section>
);

const AuditRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3"><dt className="font-semibold text-gray-500">{label}</dt><dd className="text-right font-black text-gray-200">{value}</dd></div>
);

const CapacityMetric: React.FC<{
  lsMinutes: number;
  extraMinutes: number;
  onLsChange: (value: number) => void;
  onExtraChange: (value: number) => void;
}> = ({ lsMinutes, extraMinutes, onLsChange, onExtraChange }) => (
  <div className="col-span-2 flex min-h-16 items-center gap-2 border border-white/10 bg-[#171717] px-3 py-2 xl:col-span-1">
    <Timer className="h-5 w-5 shrink-0 text-sky-300" />
    <label className="min-w-0 flex-1"><span className="block text-[9px] font-black uppercase text-gray-500">Minutos LS</span><input aria-label="Minutos LS" type="number" min={15} max={720} value={lsMinutes} onChange={(event) => onLsChange(Math.max(15, Math.min(720, Number(event.target.value) || 15)))} className="mt-1 h-8 w-full rounded border border-white/10 bg-[#0d0d0d] px-2 text-center text-sm font-black text-white outline-none focus:border-[#84cc16]" /></label>
    <span className="pt-4 text-gray-600">+</span>
    <label className="min-w-0 flex-1"><span className="block text-[9px] font-black uppercase text-gray-500">Minutos extras</span><input aria-label="Minutos extras" type="number" min={0} max={240} value={extraMinutes} onChange={(event) => onExtraChange(Math.max(0, Math.min(240, Number(event.target.value) || 0)))} className="mt-1 h-8 w-full rounded border border-white/10 bg-[#0d0d0d] px-2 text-center text-sm font-black text-white outline-none focus:border-[#84cc16]" /></label>
  </div>
);

interface QueueSectionProps {
  title: string;
  count: number;
  actions: SprintAction[];
  busy: string | null;
  resultActionId: number | null;
  onConfirm: (action: SprintAction, accept: boolean) => void;
  onResult: (action: SprintAction) => void;
  onOpen: (taskId: string) => void;
  onPrompt: (action: SprintAction) => void;
}

const QueueSection: React.FC<QueueSectionProps> = ({ title, count, actions, busy, resultActionId, onConfirm, onResult, onOpen, onPrompt }) => (
  <div>
    <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-[0.2em] text-gray-300">{title}</h2><span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black text-gray-400">{count}</span></div>
    <div className="space-y-2">
      {actions.length ? actions.map((action) => (
        <article key={action.id} className={`border border-white/10 border-l-4 bg-[#242424] p-3 ${recommendationTone[action.recommendation]} ${action.state === 'completed' ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><span className={`rounded border px-2 py-1 text-[9px] font-black uppercase ${recommendationBadge[action.recommendation]}`}>{recommendationLabel[action.recommendation]}</span><span className="text-[9px] font-black uppercase text-gray-500">{action.paper} · {action.durationMinutes} min{action.plannedQuestions ? ` · ${action.plannedQuestions} q` : ''}</span><span className="rounded bg-white/5 px-2 py-1 text-[9px] font-black text-gray-300">Confiança {formatPercent(action.confidenceBp)}</span>{typeof action.scoreDetails.fragilityBp === 'number' && <span className="rounded bg-rose-400/10 px-2 py-1 text-[9px] font-black text-rose-200">Fragilidade {formatPercent(action.scoreDetails.fragilityBp)}</span>}{action.questionRefs.length > 0 && <span className="rounded bg-amber-300/10 px-2 py-1 text-[9px] font-black text-amber-200">{action.questionRefs.length} exatas</span>}</div><h3 className="mt-2 text-sm font-black leading-snug text-white">{action.title}</h3>{action.topicHint && <p className="mt-1 line-clamp-2 text-xs font-bold text-gray-400">{action.topicHint}</p>}</div>
            <span className="text-[9px] font-black uppercase text-gray-500">{action.state === 'pending' ? 'A confirmar' : action.state}</span>
          </div>
          <div className="mt-3 border-l border-white/10 pl-3"><p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Por que agora</p><p className="mt-1 text-xs font-semibold leading-relaxed text-gray-300">{action.whyNow}</p></div>
          {action.rationale.length > 0 && <ul className="mt-2 space-y-1 pl-3 text-[10px] font-semibold leading-relaxed text-gray-500">{action.rationale.map((reason, index) => <li key={`${reason}-${index}`}>• {reason}</li>)}</ul>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {action.externalTaskId && <button type="button" onClick={() => onOpen(action.externalTaskId!)} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#84cc16] px-2.5 text-[10px] font-black uppercase text-black hover:bg-[#65a30d]"><Play className="h-3.5 w-3.5" /> Abrir</button>}
            {action.plannedQuestions > 0 && <a href={tecUrlForAction(action)} target="study-os-tec" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded border border-sky-400/25 bg-sky-400/10 px-2.5 text-[10px] font-black uppercase text-sky-100 hover:bg-sky-400/20">TEC <ExternalLink className="h-3.5 w-3.5" /></a>}
            <button type="button" onClick={() => void onPrompt(action)} className="inline-flex h-8 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2.5 text-[10px] font-black uppercase text-gray-200 hover:bg-white/10"><ClipboardCopy className="h-3.5 w-3.5" /> Prompt ChatGPT</button>
            {action.state === 'pending' && <><button type="button" disabled={busy !== null} onClick={() => void onConfirm(action, true)} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#84cc16]/30 bg-[#84cc16]/10 px-2.5 text-[10px] font-black uppercase text-[#bef264] disabled:opacity-50"><Check className="h-3.5 w-3.5" /> Confirmar</button><button type="button" disabled={busy !== null} onClick={() => void onConfirm(action, false)} title="Recusar sugestão" className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/5 text-gray-400 hover:text-white disabled:opacity-50"><X className="h-3.5 w-3.5" /></button></>}
            {!['completed', 'skipped', 'failed'].includes(action.state) && action.sourcePlanTaskId !== null && <button type="button" onClick={() => onResult(action)} className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-[10px] font-black uppercase ${resultActionId === action.id ? 'border-amber-300/40 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'}`}><Activity className="h-3.5 w-3.5" /> Resultado</button>}
          </div>
          <details className="mt-3 border-t border-white/10 pt-2"><summary className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-300">Detalhes do score</summary><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">{scoreEntries(action.scoreDetails).map(([key, value]) => <React.Fragment key={key}><dt className="break-words text-gray-500">{key}</dt><dd className="break-words text-right font-bold text-gray-300">{formatScoreValue(value)}</dd></React.Fragment>)}</dl></details>
        </article>
      )) : <div className="border border-dashed border-white/10 px-3 py-8 text-center text-xs font-bold text-gray-600">Nenhuma ação nesta fila.</div>}
    </div>
  </div>
);

const ResultSelect: React.FC<{ value: ResultDraft['state']; onChange: (value: ResultDraft['state']) => void }> = ({ value, onChange }) => <label><span className="mb-1 block text-[9px] font-black uppercase text-gray-500">Estado</span><select value={value} onChange={(event) => onChange(event.target.value as ResultDraft['state'])} className="h-9 w-full rounded border border-white/10 bg-[#0d0d0d] px-2 text-xs font-black text-white outline-none focus:border-[#84cc16]"><option value="completed">Concluída</option><option value="skipped">Pulada</option><option value="failed">Falhou</option></select></label>;
