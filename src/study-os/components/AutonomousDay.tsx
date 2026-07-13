import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ExternalLink,
  Flag,
  ListChecks,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  SkipForward,
  Target,
} from 'lucide-react';

import type { QuestionBankItem } from '../../types';
import { StudyOsApiError } from '../api/client';
import type { MaterialKind, MaterialSummary } from '../api/inventory';
import {
  fetchPlannerDay,
  fetchPlannerTargets,
  fetchTargetTopics,
  generatePlannerDay,
  refreshPlannerDay,
  seedPlannerTargets,
  submitPlannerBlockResult,
  updatePlannerTarget,
  updateTargetTopics,
  type PlannerBlock,
  type PlannerBlockResultInput,
  type PlannerDay,
  type PlannerTarget,
  type TargetTopic,
} from '../api/planner';
import { buildBlockView, buildShortfallGuidance } from '../domain/dayView';
import { AdaptiveWeek } from './AdaptiveWeek';
import { LegacyEvidenceImport } from './LegacyEvidenceImport';
import { ReviewQueue } from './ReviewQueue';
import { StudySessionPanel } from './StudySessionPanel';


interface LegacyTaskSummary {
  id: string;
  discipline: string;
  description: string;
  source: string;
  targetSlug?: string;
  status: string;
}

interface AutonomousDayProps {
  targetSlug: string;
  onTargetChange: (targetSlug: string) => void;
  legacyTasks: LegacyTaskSummary[];
  questionBankItems: QuestionBankItem[];
  onOpenLegacyTask: (taskId: string) => void;
  showToast: (message: string) => void;
}

interface ResultDraft {
  state: 'completed' | 'failed';
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
}

const TARGET_SEEDS = [
  ['bacen_economia_financas', 'BACEN Economia e Finanças'],
  ['rfb_auditor', 'RFB Auditor'],
  ['rfb_analista', 'RFB Analista'],
  ['sefaz_ce', 'SEFAZ CE'],
] as const;

const coverageLabels: Record<TargetTopic['coverageStatus'], string> = {
  unread: 'Não lido',
  in_progress: 'Em andamento',
  covered: 'Coberto',
  stale: 'Desatualizado',
  weak: 'Fraco',
  strong: 'Forte',
};

const blockTone: Record<PlannerBlock['blockKind'], string> = {
  theory: 'border-l-sky-400',
  questions: 'border-l-[#84cc16]',
  review: 'border-l-amber-300',
};

const blockIcon: Record<PlannerBlock['blockKind'], React.ElementType> = {
  theory: BookOpen,
  questions: ListChecks,
  review: RefreshCw,
};

const fieldControlClass = 'h-9 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-2 text-xs font-bold normal-case text-white outline-none focus:border-[#84cc16]';
const tableControlClass = 'h-8 rounded border border-white/10 bg-[#0d0d0d] px-1.5 text-xs font-bold text-white outline-none focus:border-[#84cc16]';

const isoToday = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const shiftIsoDate = (value: string, delta: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
};

const displayDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});

const newKey = (prefix: string, targetSlug: string, date: string) => {
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${targetSlug}-${date}-${suffix}`;
};

const errorText = (error: unknown) => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Falha inesperada no planejador local.';
};

const defaultResult = (block: PlannerBlock): ResultDraft => ({
  state: 'completed',
  questionsDone: block.plannedQuestions,
  correctCount: 0,
  wrongCount: 0,
  doubtCount: 0,
  favoriteCount: 0,
});

const materialKinds = new Set<MaterialKind>([
  'original', 'simplified', 'highlighted', 'slides', 'mind_map',
  'summary', 'bizu', 'track', 'other',
]);

const materialForBlock = (block: PlannerBlock): MaterialSummary | null => {
  if (!block.materialId || !block.lessonId || !block.evidence) return null;
  const evidence = block.evidence.candidateEvidence;
  const rawKind = evidence.materialKind;
  const kind = rawKind && materialKinds.has(rawKind as MaterialKind)
    ? rawKind as MaterialKind
    : 'original';
  return {
    id: block.materialId,
    courseId: 0,
    lessonId: block.lessonId,
    relativePath: `${block.discipline || 'Curso'} · ${block.topic || block.title}`,
    kind,
    sizeBytes: 0,
    modifiedAt: '',
    contentHash: null,
    pageCount: evidence.pageCount,
    pageOffset: 0,
    available: true,
    isPrimary: true,
    primarySelection: 'automatic',
    trustLevel: evidence.materialTrust ?? 10,
    fileUrl: `/api/v1/materials/${block.materialId}/file`,
  };
};

const chatPrompt = (block: PlannerBlock) => [
  `Estou estudando para ${block.targetSlug}.`,
  `Bloco: ${block.blockKind} de ${block.discipline} - ${block.topic}.`,
  `Duração planejada: ${block.durationMinutes} minutos.`,
  block.plannedQuestions ? `Meta: ${block.plannedQuestions} questões no TEC.` : '',
  'Ajude-me a executar este bloco sem substituir o material original.',
  block.blockKind === 'review'
    ? 'Comece pelos erros e dúvidas recentes, explique a causa e proponha um teste curto de correção.'
    : 'Se eu trouxer uma dúvida, responda de forma objetiva e verifique possíveis pegadinhas.',
].filter(Boolean).join('\n');

export const AutonomousDay: React.FC<AutonomousDayProps> = ({
  targetSlug,
  onTargetChange,
  legacyTasks,
  questionBankItems,
  onOpenLegacyTask,
  showToast,
}) => {
  const [targets, setTargets] = useState<PlannerTarget[]>([]);
  const [topics, setTopics] = useState<TargetTopic[]>([]);
  const [day, setDay] = useState<PlannerDay | null>(null);
  const [date, setDate] = useState(isoToday);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultBlockId, setResultBlockId] = useState<number | null>(null);
  const [resultDraft, setResultDraft] = useState<ResultDraft | null>(null);
  const [adaptiveRefreshToken, setAdaptiveRefreshToken] = useState(0);

  const selectedTarget = targets.find((target) => target.targetSlug === targetSlug) || null;

  const loadTargets = useCallback(async () => {
    const response = await fetchPlannerTargets();
    setTargets(response.items);
    if (response.items.length > 0 && !response.items.some((item) => item.targetSlug === targetSlug)) {
      onTargetChange(response.items.find((item) => item.active)?.targetSlug || response.items[0].targetSlug);
    }
    return response.items;
  }, [onTargetChange, targetSlug]);

  const loadTargetData = useCallback(async (
    resolvedTarget: string,
    resolvedDate: string,
    signal: AbortSignal,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const topicResponse = await fetchTargetTopics(resolvedTarget, signal);
      let nextDay: PlannerDay | null = null;
      try {
        nextDay = await fetchPlannerDay(resolvedTarget, resolvedDate, signal);
      } catch (dayError: unknown) {
        if (!(dayError instanceof StudyOsApiError && dayError.status === 404)) {
          throw dayError;
        }
      }
      if (signal.aborted) return;
      setTopics(topicResponse.items);
      setDay(nextDay);
    } catch (loadError: unknown) {
      if (signal.aborted) return;
      setDay(null);
      setTopics([]);
      setError(errorText(loadError));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    loadTargets()
      .then((items) => {
        if (!live) return;
        if (items.length === 0) {
          setLoading(false);
          setDay(null);
          setTopics([]);
        }
      })
      .catch((loadError: unknown) => {
        if (!live) return;
        setLoading(false);
        setError(errorText(loadError));
      });
    return () => { live = false; };
  }, [loadTargets]);

  useEffect(() => {
    const controller = new AbortController();
    if (targets.some((target) => target.targetSlug === targetSlug)) {
      void loadTargetData(targetSlug, date, controller.signal);
    }
    return () => controller.abort();
  }, [date, loadTargetData, targetSlug, targets]);

  const reloadDay = useCallback(async () => {
    if (!targetSlug) return;
    try {
      setDay(await fetchPlannerDay(targetSlug, date));
    } catch (loadError: unknown) {
      if (!(loadError instanceof StudyOsApiError && loadError.status === 404)) {
        setError(errorText(loadError));
      }
    }
  }, [date, targetSlug]);

  const handleSeed = async (slugs: string[]) => {
    setBusy('seed');
    setError(null);
    try {
      await seedPlannerTargets(slugs);
      const nextTargets = await loadTargets();
      const nextTarget = nextTargets.find((item) => slugs.includes(item.targetSlug))?.targetSlug;
      if (nextTarget) onTargetChange(nextTarget);
      showToast('Perfil local criado. Pesos e cobertura continuam editáveis.');
    } catch (seedError: unknown) {
      setError(errorText(seedError));
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    setBusy('generate');
    setError(null);
    try {
      const generated = await generatePlannerDay(
        { targetSlug, date, timeBudgetMinutes: (selectedTarget?.dailyQuota || 4) * 60 },
        newKey('generate', targetSlug, date),
      );
      setDay(generated);
      setAdaptiveRefreshToken((current) => current + 1);
      showToast(generated.run.status === 'generated'
        ? 'Dia autônomo gerado e salvo.'
        : `${generated.blocks.length} bloco(s) reais; lacunas mantidas explícitas.`);
    } catch (generateError: unknown) {
      setError(errorText(generateError));
    } finally {
      setBusy(null);
    }
  };

  const handleRefresh = async () => {
    if (!day) return;
    setBusy('refresh');
    setError(null);
    try {
      const refreshed = await refreshPlannerDay(
        { previousRunId: day.run.id, targetSlug, date },
        newKey('refresh', targetSlug, date),
      );
      setDay(refreshed);
      setAdaptiveRefreshToken((current) => current + 1);
      showToast('Dia recalculado; o plano anterior foi preservado.');
    } catch (refreshError: unknown) {
      setError(errorText(refreshError));
    } finally {
      setBusy(null);
    }
  };

  const handleResult = async (block: PlannerBlock, state?: 'completed' | 'failed' | 'skipped') => {
    const draft = resultDraft || defaultResult(block);
    const resultState = state || draft.state;
    const input: PlannerBlockResultInput = resultState === 'skipped'
      ? {
          state: 'skipped', questionsDone: 0, correctCount: 0, wrongCount: 0,
          doubtCount: 0, favoriteCount: 0, expectedVersion: block.version,
        }
      : { ...draft, state: resultState, expectedVersion: block.version };
    setBusy(`result-${block.id}`);
    setError(null);
    try {
      await submitPlannerBlockResult(block.id, input);
      setResultBlockId(null);
      setResultDraft(null);
      await reloadDay();
      setAdaptiveRefreshToken((current) => current + 1);
      showToast(resultState === 'completed' ? 'Resultado registrado.' : resultState === 'skipped' ? 'Pulo registrado.' : 'Falha registrada para o refresh.');
    } catch (resultError: unknown) {
      setError(errorText(resultError));
    } finally {
      setBusy(null);
    }
  };

  const handleCopyPrompt = async (block: PlannerBlock) => {
    try {
      await navigator.clipboard.writeText(chatPrompt(block));
      showToast('Prompt do bloco copiado.');
    } catch {
      setError('Não foi possível copiar o prompt neste navegador.');
    }
  };

  const saveTarget = async () => {
    if (!selectedTarget) return;
    setBusy('target');
    try {
      const saved = await updatePlannerTarget({
        targetSlug: selectedTarget.targetSlug,
        phase: selectedTarget.phase,
        deadline: selectedTarget.deadline,
        dailyQuota: selectedTarget.dailyQuota,
        priorityScore: selectedTarget.priorityScore,
        notes: selectedTarget.notes,
        active: selectedTarget.active,
        expectedVersion: selectedTarget.version,
      });
      setTargets((current) => current.map((item) => item.targetSlug === saved.targetSlug ? saved : item));
      showToast('Perfil do alvo salvo.');
    } catch (saveError: unknown) {
      setError(errorText(saveError));
    } finally {
      setBusy(null);
    }
  };

  const updateTopicLocal = (id: number, patch: Partial<TargetTopic>) => {
    setTopics((current) => current.map((topic) => topic.id === id ? { ...topic, ...patch } : topic));
  };

  const saveTopic = async (topic: TargetTopic) => {
    setBusy(`topic-${topic.id}`);
    try {
      const response = await updateTargetTopics(targetSlug, [{
        id: topic.id,
        coverageStatus: topic.coverageStatus,
        editalWeight: topic.editalWeight,
        incidence: topic.incidence,
        tier: topic.tier,
        reviewDebt: topic.reviewDebt,
        notes: topic.notes,
        expectedVersion: topic.version,
      }]);
      const saved = response.items[0];
      setTopics((current) => current.map((item) => item.id === saved.id ? saved : item));
      setAdaptiveRefreshToken((current) => current + 1);
      showToast('Cobertura do tópico salva.');
    } catch (saveError: unknown) {
      setError(errorText(saveError));
    } finally {
      setBusy(null);
    }
  };

  const legacyComparison = useMemo(() => {
    const matched = legacyTasks.filter((task) => task.targetSlug === targetSlug);
    const partial = legacyTasks.filter((task) => !task.targetSlug && targetSlug === 'sefaz_ce');
    const mismatch = legacyTasks.filter((task) => task.targetSlug && task.targetSlug !== targetSlug);
    return { matched, partial, mismatch };
  }, [legacyTasks, targetSlug]);

  if (targets.length === 0 && !loading) {
    return (
      <section className="border-y border-white/10 bg-[#171717] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Target className="h-7 w-7 text-[#84cc16]" />
          <h2 className="mt-3 text-xl font-black text-white">Escolha o primeiro alvo</h2>
          <p className="mt-1 max-w-2xl text-sm font-semibold text-gray-400">Os seeds são pontos de partida locais. Nada é gerado até você escolher; pesos e tópicos podem ser alterados depois.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {TARGET_SEEDS.map(([slug, label]) => (
              <button key={slug} type="button" onClick={() => handleSeed([slug])} disabled={busy === 'seed'} className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-gray-100 hover:bg-white/10 disabled:opacity-40">
                {label}
              </button>
            ))}
            <button type="button" onClick={() => handleSeed(TARGET_SEEDS.map(([slug]) => slug))} disabled={busy === 'seed'} className="rounded bg-[#84cc16] px-3 py-2 text-xs font-black text-black hover:bg-[#65a30d] disabled:opacity-40">
              Criar todos
            </button>
          </div>
          {error ? <p className="mt-4 text-sm font-bold text-red-200">{error}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="border-y border-white/10 bg-[#171717]">
      <div className="mx-auto max-w-[1500px] px-3 py-4 sm:px-5">
        <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#84cc16]">Melhores blocos de hoje</p>
            <h2 className="mt-1 text-xl font-black text-white sm:text-2xl">{displayDate(date)}</h2>
            <p className="mt-1 truncate text-xs font-bold text-gray-500">{selectedTarget?.institution} · {selectedTarget?.banca} · {selectedTarget?.phase === 'pos_edital' ? 'Pós-edital' : 'Pré-edital'}</p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(220px,1fr)_auto] lg:w-auto">
            <label className="grid min-w-0 gap-1 text-[9px] font-black uppercase tracking-widest text-gray-500">
              Alvo ativo
              <select value={targetSlug} onChange={(event) => onTargetChange(event.target.value)} className="h-10 min-w-0 rounded border border-white/10 bg-[#0d0d0d] px-3 text-sm font-black text-white outline-none focus:border-[#84cc16]">
                {targets.filter((target) => target.active).map((target) => <option key={target.targetSlug} value={target.targetSlug}>{target.displayName}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-1">
              <button type="button" title="Dia anterior" aria-label="Dia anterior" onClick={() => setDate((current) => shiftIsoDate(current, -1))} className="flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-10 w-[138px] rounded border border-white/10 bg-[#0d0d0d] px-2 text-xs font-bold text-white outline-none focus:border-[#84cc16]" />
              <button type="button" title="Próximo dia" aria-label="Próximo dia" onClick={() => setDate((current) => shiftIsoDate(current, 1))} className="flex h-10 w-10 items-center justify-center rounded border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </header>

        {error ? <div className="border-b border-red-300/20 bg-red-300/5 px-3 py-2 text-sm font-bold text-red-100">{error}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <span>{day?.blocks.length || 0}/{day?.run.dailyQuota || selectedTarget?.dailyQuota || 4} blocos</span>
            {day ? <span>Run #{day.run.id}</span> : <span>Dia ainda não gerado</span>}
            {day?.run.status === 'shortfall' ? <span className="text-amber-200">{day.run.shortfallCount} lacuna(s)</span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={handleGenerate} disabled={busy !== null || loading} className="flex h-9 items-center gap-1.5 rounded bg-[#84cc16] px-3 text-[10px] font-black uppercase text-black hover:bg-[#65a30d] disabled:opacity-40">
              {busy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}
              {day ? 'Novo cálculo' : 'Gerar dia'}
            </button>
            {day ? <button type="button" onClick={handleRefresh} disabled={busy !== null} className="flex h-9 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase text-gray-200 hover:bg-white/10 disabled:opacity-40">
              {busy === 'refresh' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button> : null}
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-bold text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Carregando o dia local...</div>
        ) : day && day.blocks.length > 0 ? (
          <div className="divide-y divide-white/10">
            {day.blocks.map((block) => (
              <AutonomousBlockRow
                key={block.id}
                block={block}
                busy={busy === `result-${block.id}`}
                resultOpen={resultBlockId === block.id}
                resultDraft={resultBlockId === block.id ? resultDraft : null}
                onToggleResult={() => {
                  setResultBlockId((current) => current === block.id ? null : block.id);
                  setResultDraft(defaultResult(block));
                }}
                onResultDraft={setResultDraft}
                onSubmitResult={(state) => handleResult(block, state)}
                onCopyPrompt={() => handleCopyPrompt(block)}
                onPlannerStateChange={() => void reloadDay()}
              />
            ))}
          </div>
        ) : (
          <div className="py-10 text-center">
            <Target className="mx-auto h-7 w-7 text-gray-600" />
            <p className="mt-3 text-lg font-black text-white">Nenhum plano salvo para este dia</p>
            <p className="mx-auto mt-1 max-w-xl text-sm font-semibold text-gray-500">Gere o dia. O serviço usará apenas tópicos, materiais e fontes externas que realmente existem.</p>
          </div>
        )}

        {day?.run.shortfallCount ? (
          <div className="border-t border-amber-300/20 bg-amber-300/5 px-3 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-200">Lacunas sem preenchimento artificial</p>
            <ul className="mt-2 grid gap-1 text-xs font-semibold text-amber-100/80 md:grid-cols-2">
              {buildShortfallGuidance(day.run).map((guidance) => <li key={guidance}>• {guidance}</li>)}
            </ul>
          </div>
        ) : null}

        {day ? <ScoreboardTable day={day} /> : null}

        <AdaptiveWeek
          targetSlug={targetSlug}
          selectedDate={date}
          refreshToken={adaptiveRefreshToken}
          onDateChange={setDate}
          onError={setError}
          showToast={showToast}
        />

        <ReviewQueue
          targetSlug={targetSlug}
          asOf={date}
          topics={topics}
          refreshToken={adaptiveRefreshToken}
          onError={setError}
          showToast={showToast}
        />

        <LegacyEvidenceImport
          targetSlug={targetSlug}
          questionBankItems={questionBankItems}
          onImported={() => setAdaptiveRefreshToken((current) => current + 1)}
          onError={setError}
          showToast={showToast}
        />

        <details className="border-t border-white/10 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-300">
            <ListChecks className="h-4 w-4 text-sky-300" /> Comparação LS / trilha
            <span className="ml-auto text-[10px] text-gray-500">{legacyComparison.matched.length} alinhada(s) · {legacyComparison.mismatch.length} divergente(s)</span>
          </summary>
          <div className="mt-3 overflow-x-auto border border-white/10">
            {legacyTasks.length ? legacyTasks.slice(0, 12).map((task) => {
              const alignment = task.targetSlug === targetSlug ? 'Match' : !task.targetSlug && targetSlug === 'sefaz_ce' ? 'Parcial' : 'Outro alvo';
              return <button key={task.id} type="button" onClick={() => onOpenLegacyTask(task.id)} className="grid w-full min-w-[620px] grid-cols-[100px_180px_minmax(0,1fr)_100px] items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-white/[0.03]">
                <span className={alignment === 'Match' ? 'text-[#bef264]' : alignment === 'Parcial' ? 'text-amber-200' : 'text-gray-500'}>{alignment}</span>
                <span className="truncate font-black text-white">{task.discipline}</span>
                <span className="truncate font-semibold text-gray-400">{task.description}</span>
                <span className="text-right font-bold text-gray-600">{task.source}</span>
              </button>;
            }) : <p className="px-3 py-4 text-xs font-semibold text-gray-500">Nenhuma tarefa LS/trilha agendada neste dia.</p>}
          </div>
        </details>

        <details className="border-t border-white/10 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-300"><Settings2 className="h-4 w-4 text-amber-200" /> Configurar alvo e cobertura</summary>
          <div className="mt-4 space-y-5">
            {selectedTarget ? (
              <div className="grid gap-2 border-b border-white/10 pb-4 sm:grid-cols-2 lg:grid-cols-[140px_150px_110px_110px_minmax(220px,1fr)_auto]">
                <Field label="Fase"><select value={selectedTarget.phase} onChange={(event) => setTargets((current) => current.map((item) => item.targetSlug === targetSlug ? { ...item, phase: event.target.value as PlannerTarget['phase'] } : item))} className={fieldControlClass}><option value="pre_edital">Pré-edital</option><option value="pos_edital">Pós-edital</option></select></Field>
                <Field label="Prazo"><input type="date" value={selectedTarget.deadline || ''} onChange={(event) => setTargets((current) => current.map((item) => item.targetSlug === targetSlug ? { ...item, deadline: event.target.value || null } : item))} className={fieldControlClass} /></Field>
                <Field label="Blocos/dia"><input type="number" min={1} max={8} value={selectedTarget.dailyQuota} onChange={(event) => setTargets((current) => current.map((item) => item.targetSlug === targetSlug ? { ...item, dailyQuota: Number(event.target.value) } : item))} className={fieldControlClass} /></Field>
                <Field label="Prioridade"><input type="number" min={0} max={100} value={selectedTarget.priorityScore} onChange={(event) => setTargets((current) => current.map((item) => item.targetSlug === targetSlug ? { ...item, priorityScore: Number(event.target.value) } : item))} className={fieldControlClass} /></Field>
                <Field label="Notas"><input value={selectedTarget.notes} onChange={(event) => setTargets((current) => current.map((item) => item.targetSlug === targetSlug ? { ...item, notes: event.target.value } : item))} className={fieldControlClass} /></Field>
                <button type="button" onClick={saveTarget} disabled={busy === 'target'} className="mt-auto flex h-9 items-center justify-center gap-1 rounded bg-white/10 px-3 text-[10px] font-black uppercase text-white hover:bg-white/15 disabled:opacity-40">{busy === 'target' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar</button>
              </div>
            ) : null}

            <div className="overflow-x-auto border border-white/10">
              <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
                <thead className="bg-[#0d0d0d] text-[9px] font-black uppercase tracking-widest text-gray-500"><tr><th className="px-2 py-2">Disciplina / tópico</th><th>Status</th><th>Peso</th><th>Incid.</th><th>Tier</th><th>Dívida</th><th>Notas</th><th></th></tr></thead>
                <tbody>{topics.map((topic) => <tr key={topic.id} className="border-t border-white/5">
                  <td className="max-w-[330px] px-2 py-2"><p className="truncate font-black text-white">{topic.discipline}</p><p className="truncate text-[10px] font-semibold text-gray-500">{topic.topic}</p></td>
                  <td><select value={topic.coverageStatus} onChange={(event) => updateTopicLocal(topic.id, { coverageStatus: event.target.value as TargetTopic['coverageStatus'] })} className={tableControlClass}>{Object.entries(coverageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td><input type="number" min={0} max={10} step="0.5" value={topic.editalWeight} onChange={(event) => updateTopicLocal(topic.id, { editalWeight: Number(event.target.value) })} className={`${tableControlClass} w-16`} /></td>
                  <td><input type="number" min={0} max={100} value={topic.incidence} onChange={(event) => updateTopicLocal(topic.id, { incidence: Number(event.target.value) })} className={`${tableControlClass} w-16`} /></td>
                  <td><input type="number" min={1} max={5} value={topic.tier} onChange={(event) => updateTopicLocal(topic.id, { tier: Number(event.target.value) })} className={`${tableControlClass} w-14`} /></td>
                  <td><input type="number" min={0} max={100} value={topic.reviewDebt} onChange={(event) => updateTopicLocal(topic.id, { reviewDebt: Number(event.target.value) })} className={`${tableControlClass} w-16`} /></td>
                  <td><input value={topic.notes} onChange={(event) => updateTopicLocal(topic.id, { notes: event.target.value })} className={`${tableControlClass} min-w-56`} /></td>
                  <td className="px-2"><button type="button" title="Salvar tópico" aria-label={`Salvar ${topic.discipline}`} onClick={() => saveTopic(topic)} disabled={busy === `topic-${topic.id}`} className="flex h-8 w-8 items-center justify-center rounded text-gray-300 hover:bg-white/10 disabled:opacity-40">{busy === `topic-${topic.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</button></td>
                </tr>)}</tbody>
              </table>
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Adicionar defaults ausentes</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{TARGET_SEEDS.map(([slug, label]) => <button key={slug} type="button" onClick={() => handleSeed([slug])} disabled={busy === 'seed'} className="rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-[10px] font-black text-gray-300 hover:bg-white/10 disabled:opacity-40">{label}</button>)}</div>
            </div>
          </div>
        </details>

        <details className="border-t border-white/10 py-3">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-300"><Target className="h-4 w-4 text-[#84cc16]" /> Decisão entre alvos</summary>
          <div className="mt-3 overflow-x-auto border border-white/10">
            <table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-[#0d0d0d] text-[9px] uppercase tracking-widest text-gray-500"><tr><th className="px-3 py-2">Alvo</th><th>Instituição</th><th>Banca</th><th>Fase</th><th>Prioridade</th><th>Prazo</th></tr></thead><tbody>{targets.map((target) => <tr key={target.targetSlug} className={`border-t border-white/5 ${target.targetSlug === targetSlug ? 'bg-[#84cc16]/5' : ''}`}><td className="px-3 py-2"><button type="button" onClick={() => onTargetChange(target.targetSlug)} className="font-black text-white hover:text-[#bef264]">{target.displayName}</button></td><td className="text-gray-400">{target.institution}</td><td className="font-bold text-gray-300">{target.banca}</td><td className="text-gray-400">{target.phase === 'pos_edital' ? 'Pós' : 'Pré'}</td><td className="font-black text-[#bef264]">{target.priorityScore}</td><td className="text-gray-400">{target.deadline || 'Não definido'}</td></tr>)}</tbody></table>
          </div>
        </details>
      </div>
    </section>
  );
};

const AutonomousBlockRow: React.FC<{
  block: PlannerBlock;
  busy: boolean;
  resultOpen: boolean;
  resultDraft: ResultDraft | null;
  onToggleResult: () => void;
  onResultDraft: (draft: ResultDraft) => void;
  onSubmitResult: (state?: 'completed' | 'failed' | 'skipped') => void;
  onCopyPrompt: () => void;
  onPlannerStateChange: () => void;
}> = ({ block, busy, resultOpen, resultDraft, onToggleResult, onResultDraft, onSubmitResult, onCopyPrompt, onPlannerStateChange }) => {
  const view = buildBlockView(block);
  const Icon = blockIcon[block.blockKind];
  const terminal = ['completed', 'skipped', 'failed'].includes(block.state);
  const material = block.blockKind === 'theory' ? materialForBlock(block) : null;
  const tecUrl = block.evidence?.candidateEvidence.tecSourceUrl;
  return (
    <article className={`border-l-4 py-3 pl-3 pr-1 ${blockTone[block.blockKind]}`}>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[44px_minmax(0,1fr)_auto] lg:items-center">
        <div className="flex h-10 w-10 items-center justify-center rounded bg-white/5 text-gray-200"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[9px] font-black uppercase tracking-widest text-gray-500">#{block.position} · {view.kindLabel}</span><span className="text-[9px] font-black uppercase tracking-widest text-[#bef264]">{view.statusLabel}</span><span className="text-[9px] font-black uppercase tracking-widest text-gray-600">{view.sourceLabel}</span></div>
          <p className="mt-1 text-sm font-black text-white sm:text-base">{block.discipline} <span className="font-semibold text-gray-400">· {block.topic}</span></p>
          <p className="mt-1 text-[11px] font-semibold text-gray-500">{block.durationMinutes} min{block.plannedQuestions ? ` · ${block.plannedQuestions} questões` : ''} · {view.whyNow}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 lg:justify-end">
          {!terminal && block.blockKind !== 'theory' && tecUrl ? <a href={tecUrl} target="study-os-tec" rel="noreferrer" className="flex h-8 items-center gap-1 rounded bg-[#84cc16] px-2.5 text-[10px] font-black uppercase text-black hover:bg-[#65a30d]">{view.commandLabel}<ExternalLink className="h-3.5 w-3.5" /></a> : null}
          {!terminal && block.blockKind !== 'theory' ? <button type="button" onClick={onToggleResult} className="flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2.5 text-[10px] font-black uppercase text-gray-200 hover:bg-white/10"><CheckCircle2 className="h-3.5 w-3.5" />Resultado</button> : null}
          {!terminal ? <button type="button" title="Copiar prompt para ChatGPT" aria-label="Copiar prompt para ChatGPT" onClick={onCopyPrompt} className="flex h-8 w-8 items-center justify-center rounded border border-white/10 text-gray-300 hover:bg-white/10"><ClipboardCopy className="h-3.5 w-3.5" /></button> : null}
          {!terminal && block.blockKind !== 'theory' ? <button type="button" title="Pular bloco" aria-label="Pular bloco" onClick={() => onSubmitResult('skipped')} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded border border-amber-300/20 text-amber-100 hover:bg-amber-300/10 disabled:opacity-40"><SkipForward className="h-3.5 w-3.5" /></button> : null}
        </div>
      </div>
      {!terminal && material && block.lessonId ? <div className="mt-3"><StudySessionPanel targetSlug={block.targetSlug} lessonId={block.lessonId} material={material} materialLabel="PDF original" plannerBlockId={block.id} onPlannerStateChange={onPlannerStateChange} /></div> : null}
      {resultOpen && resultDraft && !terminal ? <ResultEditor draft={resultDraft} busy={busy} onChange={onResultDraft} onSubmit={() => onSubmitResult()} /> : null}
    </article>
  );
};

const ResultEditor: React.FC<{ draft: ResultDraft; busy: boolean; onChange: (draft: ResultDraft) => void; onSubmit: () => void }> = ({ draft, busy, onChange, onSubmit }) => (
  <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-3 lg:grid-cols-[120px_repeat(5,90px)_auto]">
    <Field label="Resultado"><select value={draft.state} onChange={(event) => onChange({ ...draft, state: event.target.value as ResultDraft['state'] })} className={fieldControlClass}><option value="completed">Concluído</option><option value="failed">Falhou</option></select></Field>
    {([
      ['questionsDone', 'Feitas'], ['correctCount', 'Certas'], ['wrongCount', 'Erradas'],
      ['doubtCount', 'Dúvidas'], ['favoriteCount', 'Favoritas'],
    ] as const).map(([key, label]) => <Field key={key} label={label}><input type="number" min={0} value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: Math.max(0, Number(event.target.value)) })} className={fieldControlClass} /></Field>)}
    <button type="button" onClick={onSubmit} disabled={busy || draft.correctCount + draft.wrongCount > draft.questionsDone} className="mt-auto flex h-9 items-center justify-center gap-1 rounded bg-[#84cc16] px-3 text-[10px] font-black uppercase text-black hover:bg-[#65a30d] disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : draft.state === 'failed' ? <Flag className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Salvar</button>
  </div>
);

const ScoreboardTable: React.FC<{ day: PlannerDay }> = ({ day }) => (
  <details className="border-t border-white/10 py-3">
    <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-300"><ListChecks className="h-4 w-4 text-[#84cc16]" /> Score completo <span className="ml-auto text-[10px] text-gray-600">{day.scoreboard.length} alternativas auditadas</span></summary>
    <div className="mt-3 max-h-[420px] overflow-auto border border-white/10">
      <table className="w-full min-w-[1520px] border-collapse text-right text-[10px]">
        <thead className="sticky top-0 bg-[#0d0d0d] font-black uppercase tracking-widest text-gray-500"><tr><th className="px-2 py-2 text-left">Alternativa</th><th>Fraq.</th><th>Incid.</th><th>Tier</th><th>Cobert.</th><th>Revisão</th><th>LS</th><th>Semana</th><th>Target</th><th>Overlap</th><th>Prazo</th><th>Banca</th><th>Peso</th><th>Balance</th><th>Baixa conf.</th><th className="px-2">Final</th><th className="px-2 text-left">Decisão</th></tr></thead>
        <tbody>{day.scoreboard.map((row) => <tr key={row.id} className={`border-t border-white/5 ${row.chosenPosition ? 'bg-[#84cc16]/5 text-white' : 'text-gray-500'}`}><td className="max-w-[280px] px-2 py-2 text-left"><p className="truncate font-black">{row.discipline}</p><p className="truncate text-[9px]">{row.topic} · {row.blockKind}</p></td><ScoreCell value={row.scoreBreakdown.weakness} /><ScoreCell value={row.scoreBreakdown.incidence} /><ScoreCell value={row.scoreBreakdown.tier} /><ScoreCell value={row.scoreBreakdown.coverageNeed} /><ScoreCell value={row.scoreBreakdown.reviewDebt} /><ScoreCell value={row.scoreBreakdown.lsAlignment} /><ScoreCell value={row.scoreBreakdown.weeklyAlignment} /><ScoreCell value={row.scoreBreakdown.targetFit} /><ScoreCell value={row.scoreBreakdown.overlapValue} /><ScoreCell value={row.scoreBreakdown.deadlinePressure} /><ScoreCell value={row.scoreBreakdown.bancaFit} /><ScoreCell value={row.scoreBreakdown.editalWeight} /><ScoreCell value={row.scoreBreakdown.balancePenalty} /><ScoreCell value={row.scoreBreakdown.lowTrustPenalty} /><td className="px-2 font-black text-[#bef264]">{row.scoreBreakdown.finalScore}</td><td className="max-w-[240px] px-2 text-left"><p>{row.chosenPosition ? `Escolhido #${row.chosenPosition}` : row.stopReason || (row.displacedBy ? `Deslocado por ${row.displacedBy.slice(-8)}` : 'Alternativa')}</p><p className="mt-0.5 text-[9px] text-gray-600">{row.adaptationReason}</p></td></tr>)}</tbody>
      </table>
    </div>
  </details>
);

const ScoreCell: React.FC<{ value: number }> = ({ value }) => <td>{value}</td>;

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="grid min-w-0 gap-1 text-[9px] font-black uppercase tracking-widest text-gray-500">{label}{children}</label>;
