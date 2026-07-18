import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2, SearchCheck, X } from 'lucide-react';

import type { QuestionBankItem, QuestionSourceKind, StudyTask } from '../types';
import { BANKS } from '../utils/constants';
import { parseObjectiveQuestions } from '../utils/objectiveQuestionParser';
import { importObjectiveQuestionsFromPdf } from '../utils/pdfQuestionImport';
import { loadStoredQuestionBank, type QuestionBankImportContext } from '../utils/questionBank';
import {
  buildTaskQuestionImportPreview,
  type TaskQuestionImportParsedBatch,
} from '../utils/taskQuestionImportPreview';
import type {
  TaskQuestionImportDestination,
  TaskQuestionImportSummary,
} from '../utils/taskQuestionImport';
import { DEFAULT_STUDY_TARGET_PROFILES } from '../utils/studyPlannerCore';
import { fetchPlannerTargets } from '../study-os/api/planner';
import { createTaskQuestionImportParseGate } from './taskQuestionImportParseGate';

type ImportInputMode = 'pdf' | 'text';
type ImportSourceKind = Exclude<QuestionSourceKind, 'tec'>;

const SOURCE_OPTIONS: Array<{ value: ImportSourceKind; label: string }> = [
  { value: 'estrategia', label: 'Estratégia' },
  { value: 'professor', label: 'Professor' },
  { value: 'official', label: 'Prova oficial' },
  { value: 'other', label: 'Outra fonte' },
];

const normalizedFileTitle = (fileName: string) =>
  fileName.replace(/\.pdf$/iu, '').replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();

const fallbackTargetOptions = (task: StudyTask | null) => {
  const options = DEFAULT_STUDY_TARGET_PROFILES.map((target) => ({
    value: target.slug,
    label: target.name,
  }));
  if (task?.targetSlug && !options.some((option) => option.value === task.targetSlug)) {
    options.unshift({ value: task.targetSlug, label: task.targetSlug });
  }
  return options;
};

export interface TaskQuestionPdfImportModalProps {
  isOpen: boolean;
  task: StudyTask | null;
  initialDestination: TaskQuestionImportDestination | null;
  onClose: () => void;
  onCommit: (
    nextTask: StudyTask,
    nextQuestionBank: QuestionBankItem[],
  ) => { ok: true } | { ok: false; message: string };
  onImported: (summary: TaskQuestionImportSummary) => void;
}

export const TaskQuestionPdfImportModal: React.FC<TaskQuestionPdfImportModalProps> = ({
  isOpen,
  task,
  initialDestination,
  onClose,
  onCommit,
  onImported,
}) => {
  const [inputMode, setInputMode] = useState<ImportInputMode>('pdf');
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [parsed, setParsed] = useState<TaskQuestionImportParsedBatch | null>(null);
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>('estrategia');
  const [sourceName, setSourceName] = useState('');
  const [targetSlug, setTargetSlug] = useState('');
  const [targetOptions, setTargetOptions] = useState(() => fallbackTargetOptions(task));
  const [isLoadingTargets, setIsLoadingTargets] = useState(false);
  const [discipline, setDiscipline] = useState('');
  const [lesson, setLesson] = useState('');
  const [blockTitle, setBlockTitle] = useState('Questões importadas');
  const [bank, setBank] = useState('Outra');
  const [destination, setDestination] = useState<TaskQuestionImportDestination | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parseGateRef = useRef<ReturnType<typeof createTaskQuestionImportParseGate> | null>(null);
  if (!parseGateRef.current) parseGateRef.current = createTaskQuestionImportParseGate();

  const invalidateParse = () => {
    parseGateRef.current!.invalidate();
    setParsed(null);
    setError(null);
    setIsParsing(false);
  };

  useEffect(() => {
    invalidateParse();
    if (!isOpen) return;
    setInputMode('pdf');
    setFile(null);
    setPastedText('');
    setIsCommitting(false);
    setSourceKind('estrategia');
    setTargetSlug(task?.targetSlug || '');
    setDiscipline(task?.discipline || '');
    setBank(task?.bank || 'Outra');
    setLesson(task?.assunto || '');
    setSourceName('');
    setBlockTitle('Questões importadas');
    setDestination(initialDestination);
    setTargetOptions(fallbackTargetOptions(task));
  }, [initialDestination, isOpen, task]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setIsLoadingTargets(true);
    fetchPlannerTargets(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const serviceOptions = response.items.map((target) => ({
          value: target.targetSlug,
          label: target.displayName,
        }));
        const fallbacks = fallbackTargetOptions(task);
        setTargetOptions([
          ...serviceOptions,
          ...fallbacks.filter((fallback) => !serviceOptions.some((option) => option.value === fallback.value)),
        ]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setTargetOptions(fallbackTargetOptions(task));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingTargets(false);
      });
    return () => controller.abort();
  }, [isOpen, task]);

  const normalizedFileName = useMemo(
    () => normalizedFileTitle(parsed?.fileName || file?.name || 'Questões importadas'),
    [file?.name, parsed?.fileName],
  );
  const effectiveBank = useMemo(
    () => bank === 'Outra' ? parsed?.questions.find((question) => question.bank)?.bank || bank : bank,
    [bank, parsed],
  );
  const nonSectionBlocks = useMemo(
    () => task?.blocks.filter((block) => !block.isSection) || [],
    [task],
  );
  const sections = useMemo(
    () => task?.blocks.filter((block) => block.isSection) || [],
    [task],
  );
  const context = useMemo<QuestionBankImportContext | null>(() => {
    if (!parsed) return null;
    return {
      sourceKind,
      sourceName: sourceName.trim() || normalizedFileName,
      sourceFileName: parsed.fileName,
      targetSlug: targetSlug || undefined,
      discipline,
      lesson,
      taskTitle: blockTitle,
      bank: effectiveBank,
      tags: [discipline, lesson, sourceName].filter(Boolean),
    };
  }, [blockTitle, discipline, effectiveBank, lesson, normalizedFileName, parsed, sourceKind, sourceName, targetSlug]);
  const preview = useMemo(() => {
    if (!task || !parsed || !destination || !context) return null;
    return buildTaskQuestionImportPreview({
      task,
      currentQuestionBank: loadStoredQuestionBank(),
      parsed,
      context,
      destination,
      blockDefaults: {
        title: blockTitle.trim() || 'Questões importadas',
        lesson: lesson.trim() || sourceName.trim() || normalizedFileName,
        pages: `${parsed.pageCount} páginas`,
        bank: effectiveBank,
      },
    });
  }, [blockTitle, context, destination, effectiveBank, lesson, normalizedFileName, parsed, sourceName, task]);
  const canConfirm = Boolean(
    task
      && parsed
      && parsed.questions.length > 0
      && discipline.trim()
      && destination
      && preview?.plan.ok,
  );

  const fillMetadataFromName = (fileName: string) => {
    const title = normalizedFileTitle(fileName);
    setSourceName((current) => current || title);
    setLesson((current) => current || title);
    setBlockTitle((current) => !current.trim() || current === 'Questões importadas' ? title : current);
    setDestination((current) => current?.kind === 'new_section' && !current.sectionTitle
      ? { ...current, sectionTitle: title }
      : current);
  };

  const selectFile = (nextFile: File | null) => {
    invalidateParse();
    setFile(nextFile);
    if (nextFile) fillMetadataFromName(nextFile.name);
  };

  const changeSourceKind = (nextSourceKind: ImportSourceKind) => {
    if (nextSourceKind === sourceKind) return;
    invalidateParse();
    setSourceKind(nextSourceKind);
  };

  const processPdf = async () => {
    if (!file) {
      setError('Selecione um PDF para processar.');
      return;
    }
    const generation = parseGateRef.current!.begin();
    setParsed(null);
    setError(null);
    setIsParsing(true);
    try {
      const imported = await importObjectiveQuestionsFromPdf(file, {
        requireExplicitQuestionLabel: sourceKind === 'professor',
      });
      if (!parseGateRef.current!.isCurrent(generation)) return;
      setParsed(imported);
      if (imported.questions.length === 0) setError('Nenhuma questão objetiva detectada.');
    } catch {
      if (parseGateRef.current!.isCurrent(generation)) setError('Não foi possível ler este PDF.');
    } finally {
      if (parseGateRef.current!.isCurrent(generation)) setIsParsing(false);
    }
  };

  const processText = () => {
    const generation = parseGateRef.current!.begin();
    if (!pastedText.trim()) {
      if (!parseGateRef.current!.isCurrent(generation)) return;
      setParsed(null);
      setError('Nenhuma questão objetiva detectada.');
      return;
    }
    setError(null);
    const result = parseObjectiveQuestions(pastedText, {
      requireExplicitQuestionLabel: sourceKind === 'professor',
    });
    if (!parseGateRef.current!.isCurrent(generation)) return;
    setParsed({
      ...result,
      fileName: 'texto-colado.txt',
      pageCount: 0,
    });
    if (result.questions.length === 0) setError('Nenhuma questão objetiva detectada.');
  };

  const selectDestinationKind = (kind: TaskQuestionImportDestination['kind']) => {
    setDestination((current) => {
      if (kind === 'existing_block') {
        return { kind, blockId: current?.kind === kind ? current.blockId : nonSectionBlocks[0]?.id || '' };
      }
      const sectionTitle = current?.kind === kind ? current.sectionTitle : '';
      return { kind, sectionTitle };
    });
  };

  const confirm = () => {
    if (!canConfirm || !preview || !preview.plan.ok) return;
    setIsCommitting(true);
    setError(null);
    const result = onCommit(preview.plan.task, preview.nextQuestionBank);
    if (!result.ok) {
      setError(result.message);
      setIsCommitting(false);
      return;
    }
    onImported(preview.plan.summary);
    onClose();
  };

  if (!isOpen || !task) return null;

  const planMessage = preview && !preview.plan.ok ? preview.plan.message : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#05070d]/85 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-question-import-title"
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto border border-[#334155] bg-[#0b1220] text-[#e2e8f0] shadow-2xl shadow-black/50 sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#334155] bg-[#111827] px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#f59e0b]">Entrada auditável</p>
            <h2 id="task-question-import-title" className="mt-1 text-lg font-black tracking-tight text-white">Importar questões para a tarefa</h2>
            <p className="mt-1 text-xs text-[#94a3b8]">Prévia sem gravação. Gabaritos entram ocultos até a execução.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar importação" title="Fechar importação" className="rounded border border-[#334155] p-2 text-[#94a3b8] hover:border-[#64748b] hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-[#243244] bg-[#0f172a] p-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#f8fafc]">Arquivo e fonte</h3>
              <div className="inline-flex rounded border border-[#334155] p-1 text-xs">
                {([{ value: 'pdf', label: 'PDF' }, { value: 'text', label: 'Colar texto' }] as const).map((option) => (
                  <button key={option.value} type="button" onClick={() => { invalidateParse(); setInputMode(option.value); }} className={`rounded px-3 py-1.5 font-bold ${inputMode === option.value ? 'bg-[#f59e0b] text-[#111827]' : 'text-[#94a3b8] hover:text-white'}`}>
                    {option.label}
                  </button>
                ))}
              </div>

              {inputMode === 'pdf' ? (
                <>
                  <label className="block rounded border border-dashed border-[#475569] bg-[#0b1220] p-3 text-xs text-[#cbd5e1]">
                    <span className="mb-2 flex items-center gap-2 font-bold"><FileUp className="h-4 w-4 text-[#f59e0b]" />Selecionar PDF</span>
                    <input type="file" accept="application/pdf,.pdf" onChange={(event) => selectFile(event.target.files?.[0] || null)} className="block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-[#1e293b] file:px-2 file:py-1 file:text-xs file:font-bold file:text-[#e2e8f0]" />
                  </label>
                  <button type="button" onClick={() => void processPdf()} disabled={!file || isParsing} className="inline-flex items-center gap-2 rounded bg-[#f59e0b] px-3 py-2 text-xs font-black text-[#111827] disabled:opacity-50">
                    {isParsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />} Processar PDF
                  </button>
                </>
              ) : (
                <>
                  <label className="block text-xs font-bold text-[#cbd5e1]" htmlFor="import-pasted-text">Texto das questões</label>
                  <textarea id="import-pasted-text" value={pastedText} onChange={(event) => { setPastedText(event.target.value); setParsed(null); setError(null); }} rows={7} className="w-full rounded border border-[#334155] bg-[#0b1220] p-3 text-sm text-white outline-none focus:border-[#f59e0b]" placeholder="Cole questões objetivas com enunciado e alternativas." />
                  <button type="button" onClick={processText} className="inline-flex items-center gap-2 rounded bg-[#f59e0b] px-3 py-2 text-xs font-black text-[#111827]">
                    <SearchCheck className="h-4 w-4" /> Processar texto
                  </button>
                </>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-[#94a3b8]">Fonte
                  <select value={sourceKind} onChange={(event) => changeSourceKind(event.target.value as ImportSourceKind)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white">
                    {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[#94a3b8]">Banca
                  <select value={bank} onChange={(event) => setBank(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white">
                    {BANKS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-[#94a3b8]">Nome da fonte
                <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white" />
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-[#243244] bg-[#0f172a] p-4">
              <h3 className="text-xs font-black uppercase tracking-wider text-[#f8fafc]">Destino</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([
                  { kind: 'new_section', label: 'Nova seção' },
                  { kind: 'new_block', label: 'Novo bloco' },
                  { kind: 'existing_block', label: 'Bloco existente' },
                ] as const).map((option) => (
                  <button key={option.kind} type="button" onClick={() => selectDestinationKind(option.kind)} className={`rounded border px-2 py-2 text-xs font-bold ${destination?.kind === option.kind ? 'border-[#f59e0b] bg-[#f59e0b]/15 text-[#fcd34d]' : 'border-[#334155] text-[#94a3b8] hover:text-white'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              {destination?.kind === 'existing_block' && (
                <label className="block text-xs text-[#94a3b8]">Bloco
                  <select value={destination.blockId} onChange={(event) => setDestination({ kind: 'existing_block', blockId: event.target.value })} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white">
                    <option value="">Selecione</option>
                    {nonSectionBlocks.map((block) => <option key={block.id} value={block.id}>{block.title}{block.isLocked ? ' — bloqueado' : ''}</option>)}
                  </select>
                </label>
              )}
              {destination?.kind !== 'existing_block' && (
                <label className="block text-xs text-[#94a3b8]">{destination?.kind === 'new_section' ? 'Título da seção' : 'Seção existente'}
                  {destination?.kind === 'new_section' ? (
                    <input value={destination.sectionTitle} onChange={(event) => setDestination({ kind: 'new_section', sectionTitle: event.target.value })} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white" />
                  ) : (
                    <select value={destination?.sectionTitle || ''} onChange={(event) => setDestination({ kind: 'new_block', sectionTitle: event.target.value })} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white">
                      <option value="">Selecione</option>
                      {sections.map((section) => <option key={section.id} value={section.title}>{section.title}{section.isLocked ? ' — bloqueada' : ''}</option>)}
                    </select>
                  )}
                </label>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="text-xs text-[#94a3b8]">Destino do estudo
                  <select value={targetSlug} disabled={isLoadingTargets} onChange={(event) => setTargetSlug(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white disabled:opacity-50">
                    <option value="">Sem target</option>
                    {targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="text-xs text-[#94a3b8]">Disciplina
                  <input value={discipline} onChange={(event) => setDiscipline(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white" />
                </label>
              </div>
              <label className="block text-xs text-[#94a3b8]">Aula / assunto
                <input value={lesson} onChange={(event) => setLesson(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white" />
              </label>
              <label className="block text-xs text-[#94a3b8]">Título do bloco
                <input value={blockTitle} onChange={(event) => setBlockTitle(event.target.value)} className="mt-1 w-full rounded border border-[#334155] bg-[#0b1220] p-2 text-sm text-white" />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-[#243244] bg-[#0f172a] p-4">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#f8fafc]">Prévia</h3>
            {parsed ? (
              <>
                <div className="mt-3 grid grid-cols-2 divide-x divide-[#243244] overflow-hidden rounded border border-[#243244] sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ['Detectadas', parsed.questions.length],
                    ['Rejeitadas', preview?.rejectedBlocks ?? parsed.rejectedBlocks],
                    ['No banco', preview?.bankAdded ?? 0],
                    ['Enriquecidas', preview?.plan.summary.enriched ?? 0],
                    ['Adicionadas', preview?.plan.summary.appended ?? 0],
                    ['Conflitos', preview ? preview.plan.summary.contentConflicts + preview.plan.summary.answerKeyConflicts : 0],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="p-3 text-center">
                      <p className="text-lg font-black text-white">{value}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[#94a3b8]">{label}</p>
                    </div>
                  ))}
                </div>
                {preview?.plan.ok && preview.plan.summary.conflicts.length > 0 && (
                  <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto rounded border border-[#7c2d12] bg-[#431407]/30 p-2 text-xs text-[#fed7aa]">
                    {preview.plan.summary.conflicts.map((conflict, index) => <li key={`${conflict.kind}-${conflict.existingQuestionNumber}-${index}`}>Questão {conflict.sourceQuestionNumber || conflict.existingQuestionNumber}: conflito de {conflict.kind === 'content' ? 'conteúdo' : 'gabarito'} preservado.</li>)}
                  </ul>
                )}
              </>
            ) : <p className="mt-2 text-sm text-[#94a3b8]">Processe um PDF ou texto para gerar a prévia.</p>}
            {(error || planMessage) && <p role="alert" className="mt-3 rounded border border-[#ef4444]/50 bg-[#7f1d1d]/30 p-2 text-sm text-[#fecaca]">{error || planMessage}</p>}
          </div>
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-[#334155] bg-[#111827] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-[#94a3b8]">{canConfirm ? 'A importação será persistida apenas após sua confirmação.' : 'Informe destino, disciplina e lote válido para confirmar.'}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={isCommitting} className="rounded border border-[#475569] px-3 py-2 text-xs font-black text-[#cbd5e1] hover:text-white disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={confirm} disabled={!canConfirm || isCommitting} className="inline-flex items-center justify-center gap-2 rounded bg-[#22c55e] px-3 py-2 text-xs font-black text-[#04120a] disabled:opacity-50">
              {isCommitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Confirmar importação
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
