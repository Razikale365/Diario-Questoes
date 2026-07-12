import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  ScanSearch,
  WifiOff,
} from 'lucide-react';

import { StudyOsApiError } from '../api/client';
import { fetchStudyOsHealth, isStudyOsHealthOperational } from '../api/health';
import {
  fetchCourseRoots,
  fetchCourses,
  fetchImportRun,
  fetchLesson,
  fetchLessons,
  fetchSetupStatus,
  registerCourseRootFromPath,
  startCourseScan,
  updateLessonMapping,
  type CourseRoot,
  type CourseSummary,
  type ImportRun,
  type LessonDetail,
  type LessonSummary,
  type SetupStatus,
} from '../api/inventory';

interface CourseInventoryProps {
  targetSlug: string;
  targets: Array<{ slug: string; name: string }>;
  onTargetChange: (targetSlug: string) => void;
}

type ReadyInventory = {
  setup: SetupStatus;
  roots: CourseRoot[];
  courses: CourseSummary[];
};

type InventoryState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & ReadyInventory);

const downloadLabel: Record<CourseRoot['downloadStatus'], string> = {
  candidate: 'Candidato',
  selected: 'Selecionado',
  downloaded: 'Baixado',
  validated: 'Validado',
};

const materialKindLabel: Record<string, string> = {
  original: 'Original',
  simplified: 'Simplificado',
  highlighted: 'Grifado',
  slides: 'Slides',
  mind_map: 'Mapa mental',
  summary: 'Resumo',
  bizu: 'Bizu',
  track: 'Trilha',
  other: 'Outro',
};

const errorMessage = (error: unknown): string => {
  if (error instanceof StudyOsApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Falha inesperada no serviço local.';
};

const isAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

export const CourseInventory: React.FC<CourseInventoryProps> = ({
  targetSlug,
  targets,
  onTargetChange,
}) => {
  const [state, setState] = useState<InventoryState>({ kind: 'loading' });
  const [rootPath, setRootPath] = useState('');
  const [selectedRootId, setSelectedRootId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<ImportRun | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<CourseSummary | null>(null);
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<LessonDetail | null>(null);
  const [disciplineDraft, setDisciplineDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [action, setAction] = useState<'register' | 'scan' | 'mapping' | 'refresh' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadInventory = useCallback(async (signal?: AbortSignal): Promise<ReadyInventory> => {
    const [setup, roots, courses] = await Promise.all([
      fetchSetupStatus(signal),
      fetchCourseRoots(targetSlug, signal),
      fetchCourses(targetSlug, signal),
    ]);
    return { setup, roots: roots.items, courses: courses.items };
  }, [targetSlug]);

  const refreshInventory = useCallback(async (signal?: AbortSignal) => {
    const inventory = await loadInventory(signal);
    setState({ kind: 'ready', ...inventory });
    setSelectedRootId((current) => (
      inventory.roots.some((root) => root.id === current)
        ? current
        : inventory.roots[0]?.id ?? null
    ));
    return inventory;
  }, [loadInventory]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    setSelectedCourse(null);
    setSelectedLesson(null);
    setLessons([]);
    setActiveRun(null);
    setAction(null);
    setRootPath('');
    setMessage(null);
    fetchStudyOsHealth(controller.signal)
      .then(async (health) => {
        if (!isStudyOsHealthOperational(health)) {
          setState({ kind: 'unavailable' });
          return;
        }
        await refreshInventory(controller.signal);
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, [refreshInventory]);

  useEffect(() => {
    if (!activeRun || !['queued', 'running'].includes(activeRun.state)) return undefined;
    const controller = new AbortController();
    let timeoutId: number | undefined;

    const poll = async () => {
      try {
        const run = await fetchImportRun(activeRun.id, controller.signal);
        setActiveRun(run);
        if (run.state === 'completed' || run.state === 'failed') {
          if (run.state === 'completed') {
            await refreshInventory(controller.signal);
            setSelectedCourse(null);
            setSelectedLesson(null);
            setLessons([]);
          }
          setAction(null);
          setMessage(run.state === 'completed'
            ? `${run.reconciledCount} materiais reconciliados.`
            : run.errorMessage || 'O scan falhou.');
          return;
        }
        timeoutId = window.setTimeout(poll, 600);
      } catch (error: unknown) {
        if (isAbort(error)) return;
        setActiveRun(null);
        setAction(null);
        setMessage(errorMessage(error));
      }
    };

    timeoutId = window.setTimeout(poll, 350);
    return () => {
      controller.abort();
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [activeRun?.id, refreshInventory]);

  const selectedRoot = useMemo(() => (
    state.kind === 'ready'
      ? state.roots.find((root) => root.id === selectedRootId) || state.roots[0] || null
      : null
  ), [selectedRootId, state]);

  const issueCount = state.kind === 'ready'
    ? state.courses.reduce((total, course) => total + course.issueCount, 0)
    : 0;

  const setupStage = state.kind !== 'ready'
    ? ''
    : state.roots.length === 0
      ? (rootPath.trim() ? 'Pasta pronta para validação' : 'Pacote ainda não registrado')
      : selectedRoot?.lastScannedAt
        ? 'Inventário sincronizado'
        : 'Pacote registrado; scan pendente';

  const handleRegister = async () => {
    if (!rootPath.trim()) return;
    setAction('register');
    setMessage(null);
    try {
      const root = await registerCourseRootFromPath(targetSlug, rootPath.trim());
      await refreshInventory();
      setSelectedRootId(root.id);
      setRootPath('');
      setMessage('Pacote validado pelo manifesto e registrado.');
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handleScan = async () => {
    if (!selectedRoot) return;
    setAction('scan');
    setMessage(null);
    try {
      const run = await startCourseScan(selectedRoot.id);
      setActiveRun(run);
    } catch (error: unknown) {
      setAction(null);
      setMessage(errorMessage(error));
    }
  };

  const handleRefresh = async () => {
    setAction('refresh');
    setMessage(null);
    try {
      await refreshInventory();
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    } finally {
      setAction(null);
    }
  };

  const handleCourse = async (course: CourseSummary) => {
    setSelectedCourse(course);
    setSelectedLesson(null);
    setLessons([]);
    setMessage(null);
    try {
      const response = await fetchLessons(course.id, targetSlug);
      setLessons(response.items);
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    }
  };

  const handleLesson = async (lesson: LessonSummary) => {
    setMessage(null);
    try {
      const detail = await fetchLesson(lesson.id, targetSlug);
      setSelectedLesson(detail);
      setDisciplineDraft(detail.disciplineName || '');
      setTitleDraft(detail.title);
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    }
  };

  const handleMapping = async () => {
    if (!selectedLesson || !disciplineDraft.trim() || !titleDraft.trim()) return;
    setAction('mapping');
    setMessage(null);
    try {
      const updated = await updateLessonMapping(
        selectedLesson.id,
        targetSlug,
        disciplineDraft.trim(),
        titleDraft.trim(),
      );
      setSelectedLesson((current) => current ? { ...current, ...updated } : current);
      setLessons((current) => current.map((lesson) => (
        lesson.id === updated.id ? { ...lesson, ...updated } : lesson
      )));
      setMessage('Mapeamento manual preservado para os próximos rescans.');
    } catch (error: unknown) {
      setMessage(errorMessage(error));
    } finally {
      setAction(null);
    }
  };

  if (state.kind === 'loading') {
    return (
      <section className="flex min-h-48 items-center justify-center border-y border-white/10 bg-[#242424]">
        <div role="status" className="flex items-center gap-2 text-sm font-bold text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-[#84cc16]" /> Carregando inventário
        </div>
      </section>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <section className="flex min-h-48 items-center justify-center border-y border-red-400/20 bg-red-400/5 px-6 text-center">
        <div>
          <WifiOff className="mx-auto h-6 w-6 text-red-300" />
          <h2 className="mt-3 text-base font-black text-white">Serviço local indisponível</h2>
          <p className="mt-1 text-sm text-gray-400">O planner permanece disponível; o inventário volta quando o serviço responder.</p>
        </div>
      </section>
    );
  }

  if (state.kind === 'error') {
    return <InventoryNotice icon={AlertTriangle} title="Falha no inventário" detail={state.message} />;
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-[#84cc16]">Fonte de curso</p>
          <h2 className="mt-1 text-xl font-black text-white">Inventário Study OS</h2>
          <p className="mt-1 text-sm text-gray-400">{setupStage}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Alvo
            <select
              value={targetSlug}
              onChange={(event) => onTargetChange(event.target.value)}
              disabled={action !== null || Boolean(activeRun && ['queued', 'running'].includes(activeRun.state))}
              className="h-9 max-w-64 rounded border border-white/10 bg-[#1a1a1a] px-3 text-xs font-bold text-white outline-none focus:border-[#84cc16]"
            >
              {targets.map((target) => <option key={target.slug} value={target.slug}>{target.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={action !== null}
            className="mt-4 flex h-9 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-xs font-black text-gray-200 hover:bg-white/10 disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${action === 'refresh' ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-white/10 bg-white/10 sm:grid-cols-3 xl:grid-cols-5">
        <InventoryDatum label="Pacote" value={selectedRoot?.packageName || 'Não registrado'} />
        <InventoryDatum label="Download" value={selectedRoot ? downloadLabel[selectedRoot.downloadStatus] : 'Aguardando'} />
        <InventoryDatum label="Cursos" value={String(state.courses.length)} />
        <InventoryDatum label="Materiais" value={String(state.setup.materialCount)} />
        <InventoryDatum label="Pendências" value={String(issueCount)} warning={issueCount > 0} />
      </div>

      <div className="grid gap-3 border-y border-white/10 bg-[#242424] p-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
          Pasta criada pelo Estratégia Downloader
          <div className="flex min-w-0 items-center gap-2 rounded border border-white/10 bg-[#181818] px-3 focus-within:border-[#84cc16]">
            <FolderOpen className="h-4 w-4 shrink-0 text-gray-500" />
            <input
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="C:\\Cursos\\RFB-Auditor-249654-..."
              className="h-10 min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none placeholder:text-gray-600"
            />
          </div>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={handleRegister}
            disabled={!rootPath.trim() || action !== null}
            className="flex h-10 items-center gap-2 rounded bg-[#84cc16] px-4 text-xs font-black text-black hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {action === 'register' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Validar pasta
          </button>
          <button
            type="button"
            onClick={handleScan}
            disabled={!selectedRoot || action !== null || Boolean(activeRun && ['queued', 'running'].includes(activeRun.state))}
            className="flex h-10 items-center gap-2 rounded border border-[#84cc16]/35 bg-[#84cc16]/10 px-4 text-xs font-black text-[#d9f99d] hover:bg-[#84cc16]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {action === 'scan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            Escanear
          </button>
        </div>
      </div>

      {state.roots.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
          <span className="font-black text-gray-200">Raiz</span>
          <select
            value={selectedRoot?.id || ''}
            onChange={(event) => setSelectedRootId(Number(event.target.value))}
            className="h-8 max-w-full rounded border border-white/10 bg-[#1a1a1a] px-2 font-bold text-white"
          >
            {state.roots.map((root) => <option key={root.id} value={root.id}>{root.rootPath}</option>)}
          </select>
          {selectedRoot?.packageUrl ? (
            <a href={selectedRoot.packageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-bold text-[#bef264] hover:underline">
              Fonte <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      {activeRun && ['queued', 'running'].includes(activeRun.state) ? (
        <div role="status" className="border-l-2 border-[#84cc16] bg-[#84cc16]/5 px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs font-black text-[#d9f99d]">
            <span>Scan #{activeRun.id} · {activeRun.state === 'queued' ? 'na fila' : 'lendo metadados'}</span>
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
          <div className="mt-2 h-1 overflow-hidden bg-black/30"><div className="h-full w-1/3 animate-pulse bg-[#84cc16]" /></div>
        </div>
      ) : null}

      {message ? (
        <div className="flex items-start gap-2 border-l-2 border-yellow-300 bg-yellow-300/5 px-4 py-3 text-xs font-bold text-yellow-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
        </div>
      ) : null}

      {state.roots.length === 0 ? (
        <InventoryNotice
          icon={FolderOpen}
          title="Nenhum pacote registrado para este alvo"
          detail="Informe a pasta nova que contém o manifesto do downloader. Pastas históricas sem proveniência não serão aceitas."
        />
      ) : state.courses.length === 0 ? (
        <InventoryNotice
          icon={ScanSearch}
          title="Pacote registrado; inventário vazio"
          detail="Execute o scan para descobrir cursos, aulas e variantes sem ler o conteúdo dos PDFs."
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-w-0 overflow-hidden rounded border border-white/10">
            <div className="border-b border-white/10 bg-[#242424] px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Cursos descobertos</div>
            <div className="max-h-[560px] overflow-y-auto">
              {state.courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => handleCourse(course)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/5 px-3 py-3 text-left transition ${selectedCourse?.id === course.id ? 'bg-[#84cc16]/10' : 'bg-[#1b1b1b] hover:bg-white/[0.04]'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-white">{course.displayName}</span>
                    <span className="mt-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500">{course.lessonCount} aulas · {course.materialCount} PDFs</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-500" />
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden rounded border border-white/10 bg-[#1b1b1b]">
            <div className="flex min-h-9 items-center justify-between gap-3 border-b border-white/10 bg-[#242424] px-3 py-2">
              <p className="truncate text-sm font-black text-white">{selectedCourse?.displayName || 'Selecione um curso'}</p>
              {selectedCourse ? <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">{lessons.length} aulas</span> : null}
            </div>
            {selectedCourse ? (
              <div className="grid min-w-0 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
                <div className="max-h-[520px] overflow-y-auto border-b border-white/10 lg:border-b-0 lg:border-r">
                  {lessons.map((lesson) => (
                    <button
                      key={lesson.id}
                      type="button"
                      onClick={() => handleLesson(lesson)}
                      className={`w-full border-b border-white/5 px-3 py-3 text-left ${selectedLesson?.id === lesson.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'}`}
                    >
                      <span className="block text-xs font-black text-white">{lesson.title}</span>
                      <span className="mt-1 block truncate text-[10px] font-bold uppercase tracking-widest text-gray-500">{lesson.disciplineName || 'Sem disciplina'} · {lesson.materialCount} variantes</span>
                    </button>
                  ))}
                </div>
                <LessonMaterialPanel
                  lesson={selectedLesson}
                  targetSlug={targetSlug}
                  disciplineDraft={disciplineDraft}
                  titleDraft={titleDraft}
                  mappingBusy={action === 'mapping'}
                  onDisciplineChange={setDisciplineDraft}
                  onTitleChange={setTitleDraft}
                  onSaveMapping={handleMapping}
                />
              </div>
            ) : (
              <div className="flex min-h-60 items-center justify-center text-sm font-bold text-gray-500">Escolha um curso à esquerda.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

const InventoryDatum: React.FC<{ label: string; value: string; warning?: boolean }> = ({ label, value, warning = false }) => (
  <div className="min-w-0 bg-[#1b1b1b] px-3 py-3">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
    <p className={`mt-1 truncate text-sm font-black ${warning ? 'text-yellow-200' : 'text-white'}`} title={value}>{value}</p>
  </div>
);

const InventoryNotice: React.FC<{ icon: React.ElementType; title: string; detail: string }> = ({ icon: Icon, title, detail }) => (
  <div className="flex min-h-44 items-center justify-center border-y border-white/10 bg-[#222] px-6 text-center">
    <div className="max-w-xl">
      <Icon className="mx-auto h-6 w-6 text-gray-500" />
      <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
      <p className="mt-1 text-sm text-gray-400">{detail}</p>
    </div>
  </div>
);

const LessonMaterialPanel: React.FC<{
  lesson: LessonDetail | null;
  targetSlug: string;
  disciplineDraft: string;
  titleDraft: string;
  mappingBusy: boolean;
  onDisciplineChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onSaveMapping: () => void;
}> = ({
  lesson,
  targetSlug,
  disciplineDraft,
  titleDraft,
  mappingBusy,
  onDisciplineChange,
  onTitleChange,
  onSaveMapping,
}) => {
  if (!lesson) {
    return <div className="flex min-h-60 items-center justify-center p-5 text-center text-sm font-bold text-gray-500">Selecione uma aula para ver os materiais.</div>;
  }

  return (
    <div className="min-w-0 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
          Disciplina
          <input value={disciplineDraft} onChange={(event) => onDisciplineChange(event.target.value)} className="h-9 min-w-0 rounded border border-white/10 bg-[#111] px-2 text-xs font-bold normal-case text-white outline-none focus:border-[#84cc16]" />
        </label>
        <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
          Título
          <input value={titleDraft} onChange={(event) => onTitleChange(event.target.value)} className="h-9 min-w-0 rounded border border-white/10 bg-[#111] px-2 text-xs font-bold normal-case text-white outline-none focus:border-[#84cc16]" />
        </label>
      </div>
      <button
        type="button"
        onClick={onSaveMapping}
        disabled={mappingBusy || !disciplineDraft.trim() || !titleDraft.trim()}
        className="mt-2 flex h-8 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 text-[10px] font-black uppercase tracking-widest text-gray-200 hover:bg-white/10 disabled:opacity-40"
      >
        {mappingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Salvar mapeamento
      </button>

      <div className="mt-4 space-y-1.5">
        {lesson.materials.map((material) => (
          <div key={material.id} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border px-2 py-2 ${material.isPrimary ? 'border-[#84cc16]/35 bg-[#84cc16]/5' : 'border-white/5 bg-[#151515]'}`}>
            <FileText className={`h-4 w-4 ${material.isPrimary ? 'text-[#84cc16]' : 'text-gray-600'}`} />
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-white" title={material.relativePath}>{materialKindLabel[material.kind] || material.kind}</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-600">Confiança {material.trustLevel}{material.isPrimary ? ' · Primário' : ''}</p>
            </div>
            {material.available ? (
              <a
                href={`${material.fileUrl}?targetSlug=${encodeURIComponent(targetSlug)}#page=1`}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 items-center gap-1 rounded bg-white/5 px-2 text-[10px] font-black uppercase text-gray-200 hover:bg-white/10"
              >
                Abrir <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <span className="text-[10px] font-black uppercase text-red-300">Ausente</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
