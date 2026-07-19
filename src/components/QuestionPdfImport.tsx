import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Database,
  Download,
  ExternalLink,
  FileUp,
  Keyboard,
  Loader2,
  Play,
  RotateCcw,
  SearchCheck,
  Star,
  Tags,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';

import { BANKS, DISCIPLINAS } from '../utils/constants';
import {
  applyExternalAnswerAttempts,
  buildTecSidecarWindowFeatures,
  ExternalAnswerBatch,
  ExternalAnswerReviewMode,
  clearStoredExternalAnswerDraft,
  findExternalAnswerBatch,
  getExternalAnswerDraftLabel,
  getNextExternalAnswerNumber,
  getTecSidecarUrl,
  getQuickCaptureShortcutAnswer,
  isEditableShortcutTarget,
  loadStoredExternalAnswerDraft,
  loadStoredExternalAnswerBatches,
  loadStoredTecSidecarUrl,
  parseExternalAnswerText,
  persistExternalAnswerDraft,
  persistExternalAnswerBatches,
  persistTecSidecarUrl,
  recordExternalAnswerBatch,
  removeExternalAnswerBatch,
  removeLatestExternalAnswerTextEntry,
  selectExternalAnswerReviewItems,
  TEC_SIDECAR_WINDOW_NAME,
  upsertExternalAnswerText,
  type ExternalAnswerDraft,
} from '../utils/externalAnswers';
import { importObjectiveQuestionsFromPdf, PdfQuestionImportResult } from '../utils/pdfQuestionImport';
import { DEFAULT_STUDY_TARGET_PROFILES } from '../utils/studyPlannerCore';
import {
  answerQuestionBankItemInline,
  buildQuestionBankItems,
  createQuestionBankBackup,
  createStudyTaskFromQuestionBankItems,
  filterQuestionBankItems,
  getQuestionBankAnswerOptions,
  importQuestionBankBackup,
  loadStoredQuestionBank,
  mergeQuestionBankItems,
  persistQuestionBank,
  QUESTION_BANK_UPDATED_EVENT,
  questionBankItemToQuestion,
  reassignQuestionBankItemsTarget,
  resetQuestionBankItemAttempts,
  resolveMergedQuestionBankItems,
} from '../utils/questionBank';
import { Question, QuestionBankItem, QuestionSourceKind, StudyTask } from '../types';
import type { QuestionBankAttemptStatus } from '../utils/questionBank';
import { fetchCutoverStatus } from '../study-os/api/cutover';
import { fetchPlannerTargets } from '../study-os/api/planner';

interface QuestionPdfImportProps {
  onImport: (task: StudyTask) => void;
  showToast: (msg: string) => void;
}

const SOURCE_OPTIONS: Array<{ value: QuestionSourceKind; label: string }> = [
  { value: 'estrategia', label: 'Estratégia' },
  { value: 'tec', label: 'TEC' },
  { value: 'professor', label: 'Professor' },
  { value: 'official', label: 'Prova oficial' },
  { value: 'other', label: 'Outro' },
];

const ATTEMPT_STATUS_OPTIONS: Array<{ value: QuestionBankAttemptStatus; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'wrong', label: 'Erradas' },
  { value: 'correct', label: 'Acertadas' },
  { value: 'answered', label: 'Respondidas' },
  { value: 'unanswered', label: 'Sem resposta' },
];

const DEFAULT_QUESTION_TARGET_OPTIONS = [
  { value: '', label: 'Legado / sem target' },
  { value: 'shared', label: 'Compartilhado' },
  ...DEFAULT_STUDY_TARGET_PROFILES.map((target) => ({ value: target.slug, label: target.name })),
];

const questionTargetLabel = (
  options: Array<{ value: string; label: string }>,
  targetSlug?: string,
) => options.find((option) => option.value === (targetSlug || ''))?.label || targetSlug || 'Legado';

const QUICK_MULTIPLE_CHOICE_ANSWERS = ['A', 'B', 'C', 'D', 'E'];
const QUICK_BINARY_ANSWERS = ['Certo', 'Errado'];
const EMPTY_EXTERNAL_ANSWER_DRAFT: ExternalAnswerDraft = { text: '', quickNumber: 1 };

const normalizeFileTitle = (fileName: string) => fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();

const formatBatchTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const QuestionPdfImport: React.FC<QuestionPdfImportProps> = ({ onImport, showToast }) => {
  const initialExternalAnswerDraft = useMemo(() => loadStoredExternalAnswerDraft() || EMPTY_EXTERNAL_ANSWER_DRAFT, []);
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<QuestionSourceKind>('estrategia');
  const [targetSlug, setTargetSlug] = useState('');
  const [questionTargetOptions, setQuestionTargetOptions] = useState(DEFAULT_QUESTION_TARGET_OPTIONS);
  const [sourceName, setSourceName] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [lesson, setLesson] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [bank, setBank] = useState('Outra');
  const [isParsing, setIsParsing] = useState(false);
  const [result, setResult] = useState<PdfQuestionImportResult | null>(null);
  const [questionBank, setQuestionBank] = useState<QuestionBankItem[]>(loadStoredQuestionBank);
  const [bankQuery, setBankQuery] = useState('');
  const [bankDiscipline, setBankDiscipline] = useState('');
  const [bankSourceKind, setBankSourceKind] = useState<QuestionSourceKind | ''>('');
  const [bankTargetSlug, setBankTargetSlug] = useState('');
  const [bulkTargetSlug, setBulkTargetSlug] = useState('');
  const [bankAttemptStatus, setBankAttemptStatus] = useState<QuestionBankAttemptStatus>('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyDoubts, setOnlyDoubts] = useState(false);
  const tecWindowRef = useRef<Window | null>(null);
  const [tecUrl, setTecUrl] = useState(loadStoredTecSidecarUrl);
  const [tecSidecarStatus, setTecSidecarStatus] = useState<'idle' | 'open' | 'blocked'>('idle');
  const [tecSidecarLastOpenedAt, setTecSidecarLastOpenedAt] = useState('');
  const [externalAnswersText, setExternalAnswersText] = useState(initialExternalAnswerDraft.text);
  const [quickExternalAnswerNumber, setQuickExternalAnswerNumber] = useState(initialExternalAnswerDraft.quickNumber);
  const [externalAnswerDraftSavedAt, setExternalAnswerDraftSavedAt] = useState(initialExternalAnswerDraft.updatedAt || '');
  const [isQuickCaptureDockOpen, setIsQuickCaptureDockOpen] = useState(false);
  const [externalAnswerBatchState, setExternalAnswerBatchState] = useState(() => {
    const batches = loadStoredExternalAnswerBatches();
    return {
      batches,
      selectedBatchId: batches[0]?.id || '',
    };
  });
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchCutoverStatus(controller.signal),
      fetchPlannerTargets(controller.signal),
    ])
      .then(([status, targets]) => {
        setQuestionTargetOptions([
          { value: '', label: 'Legado / sem target' },
          { value: 'shared', label: 'Compartilhado' },
          ...targets.items.map((target) => ({
            value: target.targetSlug,
            label: target.displayName,
          })),
        ]);
        const activeTarget = status.activeTarget?.targetSlug || '';
        setTargetSlug(activeTarget);
        setBulkTargetSlug(activeTarget);
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setQuestionTargetOptions(DEFAULT_QUESTION_TARGET_OPTIONS);
        }
      });
    return () => controller.abort();
  }, []);

  const externalAnswerBatches = externalAnswerBatchState.batches;
  const selectedExternalAnswerBatch = useMemo(
    () =>
      findExternalAnswerBatch(externalAnswerBatches, externalAnswerBatchState.selectedBatchId) ||
      externalAnswerBatches[0] ||
      null,
    [externalAnswerBatches, externalAnswerBatchState.selectedBatchId]
  );

  useEffect(() => {
    const refreshQuestionBank = () => {
      setQuestionBank(loadStoredQuestionBank());
      const batches = loadStoredExternalAnswerBatches();
      setExternalAnswerBatchState({
        batches,
        selectedBatchId: batches[0]?.id || '',
      });
    };

    window.addEventListener(QUESTION_BANK_UPDATED_EVENT, refreshQuestionBank);
    return () => window.removeEventListener(QUESTION_BANK_UPDATED_EVENT, refreshQuestionBank);
  }, []);

  const detected = useMemo(() => {
    const questions = result?.questions || [];
    return {
      answerCount: questions.filter((question) => question.answerKey).length,
      banks: Array.from(new Set(questions.map((question) => question.bank).filter(Boolean))),
      years: Array.from(new Set(questions.map((question) => question.year).filter(Boolean))).sort(),
    };
  }, [result]);

  const bankDisciplines = useMemo(
    () => Array.from(new Set(questionBank.map((item) => item.discipline))).sort(),
    [questionBank]
  );

  const filteredBankItems = useMemo(
    () =>
      filterQuestionBankItems(questionBank, {
        query: bankQuery,
        targetSlug: bankTargetSlug,
        discipline: bankDiscipline,
        sourceKind: bankSourceKind,
        attemptStatus: bankAttemptStatus,
        onlyFavorites,
        onlyDoubts,
      }),
    [questionBank, bankQuery, bankTargetSlug, bankDiscipline, bankSourceKind, bankAttemptStatus, onlyFavorites, onlyDoubts]
  );

  const externalAnswerPreview = useMemo(
    () => parseExternalAnswerText(externalAnswersText),
    [externalAnswersText]
  );
  const suggestedExternalAnswerNumber = useMemo(
    () => getNextExternalAnswerNumber(externalAnswersText),
    [externalAnswersText]
  );
  const externalAnswerDraftLabel = useMemo(
    () => (externalAnswersText.trim() ? getExternalAnswerDraftLabel(externalAnswerDraftSavedAt) : ''),
    [externalAnswerDraftSavedAt, externalAnswersText]
  );

  useEffect(() => {
    if (!externalAnswersText.trim()) {
      clearStoredExternalAnswerDraft();
      setExternalAnswerDraftSavedAt('');
      return;
    }

    const updatedAt = new Date().toISOString();
    persistExternalAnswerDraft({
      text: externalAnswersText,
      quickNumber: quickExternalAnswerNumber,
      updatedAt,
    });
    setExternalAnswerDraftSavedAt(updatedAt);
  }, [externalAnswersText, quickExternalAnswerNumber]);

  const lastBatchItems = useMemo(
    () =>
      selectedExternalAnswerBatch
        ? selectExternalAnswerReviewItems(questionBank, selectedExternalAnswerBatch.changedIds, 'all')
        : [],
    [questionBank, selectedExternalAnswerBatch]
  );

  const lastBatchWrongOrUncorrectedItems = useMemo(
    () =>
      selectedExternalAnswerBatch
        ? selectExternalAnswerReviewItems(questionBank, selectedExternalAnswerBatch.changedIds, 'wrong-or-uncorrected')
        : [],
    [questionBank, selectedExternalAnswerBatch]
  );

  const lastBatchTimestamp = useMemo(
    () => (selectedExternalAnswerBatch ? formatBatchTimestamp(selectedExternalAnswerBatch.appliedAt) : ''),
    [selectedExternalAnswerBatch]
  );

  const bankStats = useMemo(() => {
    const favorites = questionBank.filter((item) => item.favorite).length;
    const doubts = questionBank.filter((item) => item.hasDoubt).length;
    const answered = questionBank.filter((item) => item.attempts.length > 0).length;
    const correct = questionBank.filter((item) => item.attempts[item.attempts.length - 1]?.isCorrect === true).length;
    const wrong = questionBank.filter((item) => item.attempts[item.attempts.length - 1]?.isCorrect === false).length;
    return { favorites, doubts, answered, correct, wrong };
  }, [questionBank]);

  const resetImport = () => {
    setFile(null);
    setSourceName('');
    setTaskTitle('');
    setLesson('');
    setDiscipline('');
    setBank('Outra');
    setResult(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setResult(null);

    if (nextFile) {
      const title = normalizeFileTitle(nextFile.name);
      setSourceName(title);
      setTaskTitle(title);
    }
  };

  const handlePreview = async () => {
    if (!file) {
      showToast('Selecione um PDF.');
      return;
    }

    setIsParsing(true);
    try {
      const imported = await importObjectiveQuestionsFromPdf(file, {
        requireExplicitQuestionLabel: sourceKind === 'professor',
      });
      setResult(imported);

      if (imported.questions.length === 0) {
        showToast('Nenhuma questão objetiva identificada.');
      } else {
        showToast(`${imported.questions.length} questões identificadas.`);
      }
    } catch (error) {
      console.error('[Diário LS] PDF import failed', error);
      showToast('Erro ao ler o PDF.');
    } finally {
      setIsParsing(false);
    }
  };

  const buildBankContext = () => {
    if (!result || result.questions.length === 0) {
      showToast('Processe um PDF com questões primeiro.');
      return null;
    }

    if (!discipline) {
      showToast('Informe a disciplina.');
      return null;
    }

    const detectedBank = result.questions.find((question) => question.bank)?.bank;
    const effectiveBank = bank === 'Outra' && detectedBank ? detectedBank : bank;
    const effectiveSourceName = sourceName.trim() || normalizeFileTitle(result.fileName);
    const effectiveTitle = taskTitle.trim() || effectiveSourceName;

    return {
      sourceKind,
      sourceName: effectiveSourceName,
      sourceFileName: result.fileName,
      targetSlug: targetSlug || undefined,
      discipline,
      lesson: lesson || effectiveTitle,
      taskTitle: effectiveTitle,
      bank: effectiveBank,
      tags: [discipline, lesson, effectiveSourceName].filter(Boolean),
    };
  };

  const saveQuestionsToQuestionBank = (context: NonNullable<ReturnType<typeof buildBankContext>>) => {
    if (!result) return null;
    const incoming = buildQuestionBankItems(result.questions, context);
    const merged = mergeQuestionBankItems(questionBank, incoming);
    const executableItems = resolveMergedQuestionBankItems(incoming, merged.items);
    setQuestionBank(merged.items);
    persistQuestionBank(merged.items);
    return { ...merged, executableItems };
  };

  const saveResultToQuestionBank = () => {
    const context = buildBankContext();
    if (!context) return null;

    const merged = saveQuestionsToQuestionBank(context);
    if (!merged) return null;

    showToast(`${merged.added} novas no banco; ${merged.updated} atualizada(s); ${merged.duplicates} duplicada(s) ignoradas.`);
    return merged;
  };

  const handleCreateTask = () => {
    if (!result || result.questions.length === 0) {
      showToast('Processe um PDF com questões primeiro.');
      return;
    }

    if (!discipline) {
      showToast('Informe a disciplina.');
      return;
    }

    const context = buildBankContext();
    if (!context) return;

    const merged = saveQuestionsToQuestionBank(context);
    if (!merged) return;

    const effectiveBank = context.bank;
    const effectiveSourceName = context.sourceName;
    const effectiveTitle = context.taskTitle || effectiveSourceName;
    const now = new Date().toISOString();
    const questions: Question[] = merged.executableItems.map(questionBankItemToQuestion);

    const newTask: StudyTask = {
      id: crypto.randomUUID(),
      date: now,
      targetSlug: context.targetSlug,
      planejamento: 'PDF',
      meta: '',
      tarefa: '',
      assunto: lesson || effectiveTitle,
      discipline,
      bank: effectiveBank,
      blocks: [
        {
          id: crypto.randomUUID(),
          title: effectiveTitle,
          lesson: context.lesson || effectiveSourceName,
          pages: `${result.pageCount} pags.`,
          bank: effectiveBank,
          questions,
          showStats: true,
          showGabarito: false,
          layout: {
            columns: 1,
            rows: Math.min(Math.max(questions.length, 1), 8),
            type: 'grid',
            width: 12,
            rowSpan: 4,
          },
        },
      ],
      status: 'in_progress',
    };

    onImport(newTask);
    resetImport();
  };

  const toggleFavorite = (itemId: string) => {
    const updated = questionBank.map((item) =>
      item.id === itemId ? { ...item, favorite: !item.favorite, updatedAt: new Date().toISOString() } : item
    );
    setQuestionBank(updated);
    persistQuestionBank(updated);
  };

  const resetBankItemAttempts = (itemId: string) => {
    const result = resetQuestionBankItemAttempts(questionBank, itemId);
    if (!result.changed) {
      showToast('Questão sem tentativa para limpar.');
      return;
    }

    setQuestionBank(result.items);
    persistQuestionBank(result.items);
    showToast('Tentativas da questão limpas.');
  };

  const answerBankItemInline = (itemId: string, answer: string) => {
    const result = answerQuestionBankItemInline(questionBank, itemId, answer);
    if (!result.changed) {
      showToast('Não foi possível registrar a resposta.');
      return;
    }

    setQuestionBank(result.items);
    persistQuestionBank(result.items);
    const updatedItem = result.items.find((item) => item.id === itemId);
    const latestAttempt = updatedItem?.attempts[updatedItem.attempts.length - 1];
    const correctness =
      latestAttempt?.isCorrect === true ? ' certa.' : latestAttempt?.isCorrect === false ? ' errada.' : ' registrada.';
    showToast(`Resposta ${answer}${correctness}`);
  };

  const clearBankFilters = () => {
    setBankQuery('');
    setBankTargetSlug('');
    setBankDiscipline('');
    setBankSourceKind('');
    setBankAttemptStatus('');
    setOnlyFavorites(false);
    setOnlyDoubts(false);
  };

  const reassignFilteredQuestionBankTarget = () => {
    if (filteredBankItems.length === 0) {
      showToast('Nenhuma questão filtrada para reclassificar.');
      return;
    }

    const result = reassignQuestionBankItemsTarget(
      questionBank,
      filteredBankItems.map((item) => item.id),
      bulkTargetSlug || undefined,
    );
    if (result.updated === 0) {
      showToast(`As questões filtradas já estão em ${questionTargetLabel(questionTargetOptions, bulkTargetSlug)}.`);
      return;
    }

    setQuestionBank(result.items);
    persistQuestionBank(result.items);
    showToast(`${result.updated} questão(ões) movidas para ${questionTargetLabel(questionTargetOptions, bulkTargetSlug)}.`);
  };

  const createTaskFromExternalBatch = (mode: ExternalAnswerReviewMode) => {
    if (!selectedExternalAnswerBatch) {
      showToast('Aplique respostas externas primeiro.');
      return;
    }

    const selectedItems = selectExternalAnswerReviewItems(questionBank, selectedExternalAnswerBatch.changedIds, mode);
    if (selectedItems.length === 0) {
      showToast(mode === 'wrong' ? 'Nenhuma errada neste lote.' : 'Nenhuma questão para revisar neste lote.');
      return;
    }

    const task = createStudyTaskFromQuestionBankItems(selectedItems, {
      title: mode === 'all' ? 'TEC - Lote Respondido' : 'TEC - Erradas e Incertas',
      lesson: mode === 'all' ? 'Reexecução do lote TEC' : 'Correção ativa do lote TEC',
      discipline: bankDiscipline || selectedItems[0]?.discipline,
    });

    if (!task) {
      showToast('Não foi possível criar a rodada pós-TEC.');
      return;
    }

    onImport(task);
    showToast(`${selectedItems.length} questão(ões) do lote viraram tarefa.`);
  };

  const removeExternalBatchFromHistory = (batchId: string) => {
    const nextBatches = removeExternalAnswerBatch(externalAnswerBatches, batchId);
    if (nextBatches.length === externalAnswerBatches.length) {
      showToast('Lote TEC não encontrado.');
      return;
    }

    persistExternalAnswerBatches(nextBatches);
    setExternalAnswerBatchState((current) => ({
      batches: nextBatches,
      selectedBatchId:
        current.selectedBatchId === batchId
          ? nextBatches[0]?.id || ''
          : findExternalAnswerBatch(nextBatches, current.selectedBatchId)?.id || nextBatches[0]?.id || '',
    }));
    showToast('Lote TEC removido do histórico.');
  };

  const createTaskFromBank = () => {
    if (filteredBankItems.length === 0) {
      showToast('Nenhuma questão filtrada para executar.');
      return;
    }

    const selectedItems = filteredBankItems.slice(0, 80);
    const task = createStudyTaskFromQuestionBankItems(selectedItems, {
      title: bankQuery.trim() ? `Banco - ${bankQuery.trim()}` : undefined,
      discipline: bankDiscipline || undefined,
    });

    if (!task) {
      showToast('Não foi possível criar a tarefa do banco.');
      return;
    }

    onImport(task);
    showToast(`${selectedItems.length} questões do banco viraram tarefa.`);
  };

  const openTecWindow = () => {
    const normalizedUrl = persistTecSidecarUrl(tecUrl);
    const width = Math.min(1240, Math.max(900, Math.floor(window.screen.availWidth * 0.58)));
    const height = Math.min(980, Math.max(680, window.screen.availHeight - 80));
    const opened = window.open(
      normalizedUrl,
      TEC_SIDECAR_WINDOW_NAME,
      buildTecSidecarWindowFeatures({
        width,
        height,
        left: Math.max(0, window.screen.availWidth - width - 24),
        top: 24,
      }),
    );

    setTecUrl(normalizedUrl);

    if (!opened) {
      setTecSidecarStatus('blocked');
      showToast('Subjanela do TEC bloqueada pelo navegador.');
      return;
    }

    try {
      opened.opener = null;
    } catch {
      // Some browsers expose opener as read-only after reusing a popup.
    }

    opened.focus();
    tecWindowRef.current = opened;
    setIsQuickCaptureDockOpen(true);
    setTecSidecarStatus('open');
    setTecSidecarLastOpenedAt(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    showToast('TEC aberto; capturador pronto para marcar respostas.');
  };

  const discardExternalAnswerDraft = () => {
    setExternalAnswersText('');
    setQuickExternalAnswerNumber(1);
    setExternalAnswerDraftSavedAt('');
    clearStoredExternalAnswerDraft();
    showToast('Rascunho TEC descartado.');
  };

  const captureQuickExternalAnswer = useCallback((answer: string) => {
    const targetNumber = Math.max(1, Math.trunc(quickExternalAnswerNumber || suggestedExternalAnswerNumber));

    setExternalAnswersText((current) => upsertExternalAnswerText(current, targetNumber, answer));
    setQuickExternalAnswerNumber(targetNumber + 1);
  }, [quickExternalAnswerNumber, suggestedExternalAnswerNumber]);

  const undoLatestQuickExternalAnswer = useCallback(() => {
    const result = removeLatestExternalAnswerTextEntry(externalAnswersText);

    if (!result.removed) {
      showToast('Nenhuma resposta TEC para desfazer.');
      return;
    }

    setExternalAnswersText(result.text);
    setQuickExternalAnswerNumber(result.removed.number);
    showToast(`Resposta Q${result.removed.number} removida.`);
  }, [externalAnswersText, showToast]);

  useEffect(() => {
    if (!isQuickCaptureDockOpen) return;

    const handleQuickCaptureKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsQuickCaptureDockOpen(false);
        return;
      }

      const target = event.target as HTMLElement | null;
      if (isEditableShortcutTarget(target?.tagName, Boolean(target?.isContentEditable))) return;

      if (event.key === 'Backspace') {
        event.preventDefault();
        undoLatestQuickExternalAnswer();
        return;
      }

      const answer = getQuickCaptureShortcutAnswer(event.key);
      if (!answer) return;

      event.preventDefault();
      captureQuickExternalAnswer(answer);
    };

    window.addEventListener('keydown', handleQuickCaptureKeydown);
    return () => window.removeEventListener('keydown', handleQuickCaptureKeydown);
  }, [captureQuickExternalAnswer, isQuickCaptureDockOpen, undoLatestQuickExternalAnswer]);

  const applyExternalAnswersToBank = () => {
    if (filteredBankItems.length === 0) {
      showToast('Filtre as questões do caderno antes de aplicar respostas.');
      return;
    }

    if (externalAnswerPreview.entries.length === 0) {
      showToast('Nenhuma resposta reconhecida.');
      return;
    }

    const currentItems = loadStoredQuestionBank();
    const targetIds = new Set(filteredBankItems.map((item) => item.id));
    const currentTargets = currentItems.filter((item) => targetIds.has(item.id));
    const appliedAt = new Date().toISOString();
    const applied = applyExternalAnswerAttempts(currentItems, currentTargets, externalAnswerPreview.entries, appliedAt);

    if (applied.applied === 0) {
      showToast('Nenhuma resposta bateu com as questões filtradas.');
      return;
    }

    setQuestionBank(applied.items);
    persistQuestionBank(applied.items);
    setExternalAnswersText('');
    setQuickExternalAnswerNumber(1);
    setExternalAnswerDraftSavedAt('');
    clearStoredExternalAnswerDraft();
    const nextBatch: ExternalAnswerBatch = {
      id: crypto.randomUUID(),
      sourceKind: 'tec',
      sourceName: getTecSidecarUrl(tecUrl),
      appliedAt,
      changedIds: applied.changedIds,
      applied: applied.applied,
      unmatched: applied.unmatched.length,
    };
    const nextHistory = recordExternalAnswerBatch(externalAnswerBatches, nextBatch);
    persistExternalAnswerBatches(nextHistory);
    setExternalAnswerBatchState({
      batches: nextHistory,
      selectedBatchId: nextBatch.id,
    });

    const unmatched = applied.unmatched.length > 0 ? ` ${applied.unmatched.length} sem par.` : '';
    showToast(`${applied.applied} resposta(s) aplicadas ao banco.${unmatched}`);
  };

  const exportQuestionBank = () => {
    const currentItems = loadStoredQuestionBank();
    if (currentItems.length === 0) {
      showToast('Banco vazio: nada para exportar.');
      return;
    }

    setQuestionBank(currentItems);
    const currentExternalAnswerBatches = loadStoredExternalAnswerBatches();
    const backup = createQuestionBankBackup(currentItems, new Date().toISOString(), currentExternalAnswerBatches);
    const blob = new Blob([backup], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `diario-questoes-banco-local-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast(`${currentItems.length} questão(ões) e ${currentExternalAnswerBatches.length} lote(s) TEC exportados.`);
  };

  const importQuestionBankFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const backupFile = event.target.files?.[0];
    event.target.value = '';

    if (!backupFile) return;

    try {
      const backup = await backupFile.text();
      const currentItems = loadStoredQuestionBank();
      const currentExternalAnswerBatches = loadStoredExternalAnswerBatches();
      const imported = importQuestionBankBackup(currentItems, backup, currentExternalAnswerBatches);
      setQuestionBank(imported.items);
      persistQuestionBank(imported.items);
      persistExternalAnswerBatches(imported.externalAnswerBatches);
      setExternalAnswerBatchState({
        batches: imported.externalAnswerBatches,
        selectedBatchId: imported.externalAnswerBatches[0]?.id || '',
      });
      showToast(
        `${imported.added} novas; ${imported.updated} atualizadas; ${imported.duplicates} já existiam; ${imported.externalAnswerBatchesImported} lote(s) TEC importados.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Arquivo de backup inválido.';
      showToast(message);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
          <FileUp className="w-5 h-5 text-[#84cc16]" /> PDF de Questões
        </h3>
        {result && (
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
            <SearchCheck className="w-4 h-4 text-[#84cc16]" />
            {result.questions.length} questões
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <label className="block">
          <span className="block text-sm font-bold text-gray-300 mb-2">Arquivo PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-300 file:mr-4 file:rounded file:border-0 file:bg-[#84cc16] file:px-4 file:py-2 file:font-bold file:text-black hover:file:bg-[#65a30d]"
          />
        </label>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Fonte</label>
          <select
            value={sourceKind}
            onChange={(event) => setSourceKind(event.target.value as QuestionSourceKind)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Target</label>
          <select
            value={targetSlug}
            onChange={(event) => setTargetSlug(event.target.value)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-[#84cc16] focus:ring-1 focus:ring-[#84cc16]"
          >
            {questionTargetOptions.map((option) => (
              <option key={option.value || 'legacy'} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Disciplina *</label>
          <select
            value={discipline}
            onChange={(event) => setDiscipline(event.target.value)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          >
            <option value="">Selecione</option>
            {DISCIPLINAS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Nome da fonte</label>
          <input
            type="text"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Título da tarefa</label>
          <input
            type="text"
            value={taskTitle}
            onChange={(event) => setTaskTitle(event.target.value)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Aula / Assunto</label>
          <input
            type="text"
            value={lesson}
            onChange={(event) => setLesson(event.target.value)}
            placeholder="Ex: Aula 03 - Controle"
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Banca</label>
          <select
            value={bank}
            onChange={(event) => setBank(event.target.value)}
            className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          >
            {BANKS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </div>

      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="bg-[#1a1a1a] border border-white/5 rounded p-3">
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">PDF</p>
            <p className="text-white font-bold">{result.pageCount} pags.</p>
          </div>
          <div className="bg-[#1a1a1a] border border-white/5 rounded p-3">
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Gabaritos</p>
            <p className="text-white font-bold">{detected.answerCount}/{result.questions.length}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-white/5 rounded p-3">
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Bancas</p>
            <p className="text-white font-bold truncate">{detected.banks.join(', ') || '-'}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-white/5 rounded p-3">
            <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">Anos</p>
            <p className="text-white font-bold truncate">{detected.years.join(', ') || '-'}</p>
          </div>
        </div>
      )}

      {result?.questions[0] && (
        <div className="bg-[#1a1a1a] border border-white/5 rounded p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-black text-gray-500 uppercase tracking-widest">
              Prévia Q{result.questions[0].number}
            </p>
            {result.questions[0].answerKey && (
              <span className="text-[10px] font-black text-purple-300 bg-purple-500/10 px-2 py-1 rounded">
                GAB {result.questions[0].answerKey}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-200 line-clamp-3">{result.questions[0].statement}</p>
          <div className="grid gap-2">
            {result.questions[0].alternatives.slice(0, 5).map((alternative) => (
              <div key={alternative.label} className="flex gap-2 text-xs text-gray-300">
                <span className="w-5 h-5 rounded bg-[#2d2d2d] text-[#84cc16] font-black flex items-center justify-center flex-shrink-0">
                  {alternative.label}
                </span>
                <span className="line-clamp-1">{alternative.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={handlePreview}
          disabled={!file || isParsing}
          className="bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded font-bold flex items-center gap-2 transition-colors border border-white/10"
        >
          {isParsing ? <Loader2 className="w-5 h-5 animate-spin" /> : <SearchCheck className="w-5 h-5" />}
          Processar PDF
        </button>
        <button
          type="button"
          onClick={saveResultToQuestionBank}
          disabled={!result || result.questions.length === 0}
          className="bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-purple-200 px-5 py-3 rounded font-bold flex items-center gap-2 transition-colors border border-purple-500/20"
        >
          <Database className="w-5 h-5" /> Salvar no Banco
        </button>
        <button
          type="button"
          onClick={handleCreateTask}
          disabled={!result || result.questions.length === 0}
          className="bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-black px-5 py-3 rounded font-bold flex items-center gap-2 transition-colors"
        >
          <Play className="w-5 h-5" /> Criar Tarefa
        </button>
      </div>

      {result && result.rejectedBlocks > 0 && (
        <p className="text-[11px] text-gray-500 flex items-center gap-2">
          <Star className="w-3.5 h-3.5 text-gray-600" />
          {result.rejectedBlocks} blocos numerados ficaram fora por não terem alternativas objetivas suficientes.
        </p>
      )}

      {result && result.diagnostics && (
        <div className="space-y-1 bg-amber-500/5 border border-amber-500/10 p-3 rounded text-[11px] text-amber-300/90">
          <h4 className="font-bold text-amber-200 uppercase tracking-widest text-[9px] mb-1.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Avisos de Diagnóstico de Importação
          </h4>
          {result.diagnostics.duplicateNumbers.length > 0 && (
            <p className="flex items-center gap-2">
              • Duplicidades de numeração de candidatos no PDF: {result.diagnostics.duplicateNumbers.join(', ')}
            </p>
          )}
          {result.diagnostics.missingNumbers.length > 0 && (
            <p className="flex items-center gap-2">
              • Lacunas detectadas na numeração do PDF: Questões {result.diagnostics.missingNumbers.join(', ')}
            </p>
          )}
          {result.diagnostics.outOfOrderNumbers.length > 0 && (
            <p className="flex items-center gap-2">
              • Sequência fora de ordem: Questões {result.diagnostics.outOfOrderNumbers.join(', ')}
            </p>
          )}
        </div>
      )}

      <section className="border-t border-[#404040] pt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
              <Database className="w-5 h-5 text-[#84cc16]" /> Banco Local de Questões
            </h3>
            <span className="rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
              {questionBank.length} salvas
            </span>
            <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-200">
              {filteredBankItems.length} filtradas
            </span>
            <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
              {bankStats.favorites} favoritas
            </span>
            <span className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-300">
              {bankStats.wrong} erradas
            </span>
            <span className="rounded bg-orange-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-orange-300">
              {bankStats.doubts} dúvidas
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={backupInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importQuestionBankFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-200 hover:bg-white/10"
            >
              <Upload className="mr-1 inline h-4 w-4" /> Importar
            </button>
            <button
              type="button"
              onClick={exportQuestionBank}
              disabled={questionBank.length === 0}
              className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-widest text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="mr-1 inline h-4 w-4" /> Exportar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-8">
          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500 lg:col-span-2">
            Buscar
            <input
              type="search"
              value={bankQuery}
              onChange={(event) => setBankQuery(event.target.value)}
              placeholder="Enunciado, fonte, assunto, banca..."
              className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-purple-500"
            />
          </label>

          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Target
            <select
              value={bankTargetSlug}
              onChange={(event) => setBankTargetSlug(event.target.value)}
              className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-[#84cc16]"
            >
              <option value="">Todos</option>
              {questionTargetOptions.map((option) => option.value && (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="legacy">Legado / sem target</option>
            </select>
          </label>

          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Disciplina
            <select
              value={bankDiscipline}
              onChange={(event) => setBankDiscipline(event.target.value)}
              className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-purple-500"
            >
              <option value="">Todas</option>
              {bankDisciplines.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Fonte
            <select
              value={bankSourceKind}
              onChange={(event) => setBankSourceKind(event.target.value as QuestionSourceKind | '')}
              className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-purple-500"
            >
              <option value="">Todas</option>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Desempenho
            <select
              value={bankAttemptStatus}
              onChange={(event) => setBankAttemptStatus(event.target.value as QuestionBankAttemptStatus)}
              className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-purple-500"
            >
              {ATTEMPT_STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-end gap-2 lg:col-span-2">
            <label className="flex min-h-[42px] min-w-[120px] flex-1 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-gray-300">
              <input
                type="checkbox"
                checked={onlyFavorites}
                onChange={(event) => setOnlyFavorites(event.target.checked)}
                className="accent-[#84cc16]"
              />
              Favoritas
            </label>
            <label className="flex min-h-[42px] min-w-[120px] flex-1 items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-gray-300">
              <input
                type="checkbox"
                checked={onlyDoubts}
                onChange={(event) => setOnlyDoubts(event.target.checked)}
                className="accent-orange-500"
              />
              Dúvidas
            </label>
            <button
              type="button"
              onClick={clearBankFilters}
              title="Limpar filtros"
              className="min-h-[42px] flex-none rounded border border-white/10 bg-white/5 px-3 text-white hover:bg-white/10"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs font-bold text-gray-500">
            {bankStats.answered} respondidas · {bankStats.wrong} erradas · {bankStats.correct} acertadas · {bankStats.doubts} dúvidas no banco.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[220px] gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Novo target das filtradas
              <select
                value={bulkTargetSlug}
                onChange={(event) => setBulkTargetSlug(event.target.value)}
                className="min-h-[44px] rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-cyan-400"
              >
                {questionTargetOptions.map((option) => (
                  <option key={option.value || 'legacy'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={reassignFilteredQuestionBankTarget}
              disabled={filteredBankItems.length === 0}
              className="min-h-[44px] rounded border border-cyan-300/20 bg-cyan-400/10 px-4 text-sm font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Tags className="mr-1 inline h-4 w-4" /> Aplicar ({filteredBankItems.length})
            </button>
            <button
              type="button"
              onClick={createTaskFromBank}
              disabled={filteredBankItems.length === 0}
              className="min-h-[44px] bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-black px-5 rounded font-bold flex items-center gap-2 transition-colors"
            >
              <Play className="w-5 h-5" /> Executar Filtradas
            </button>
          </div>
        </div>

        <section className="grid gap-4 rounded border border-cyan-500/10 bg-cyan-500/5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-black uppercase tracking-widest text-cyan-100 flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-cyan-300" /> TEC Assistido
              </h4>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                <span className="rounded bg-black/25 px-2 py-1 text-cyan-100">
                  {externalAnswerPreview.entries.length} lidas
                </span>
                {tecSidecarStatus === 'open' && (
                  <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[#84cc16]">
                    Sidecar {tecSidecarLastOpenedAt || 'ativo'}
                  </span>
                )}
                {tecSidecarStatus === 'blocked' && (
                  <span className="rounded bg-red-500/10 px-2 py-1 text-red-200">
                    Popup bloqueado
                  </span>
                )}
                {externalAnswerDraftLabel && (
                  <span className="rounded bg-cyan-300/10 px-2 py-1 text-cyan-100">
                    {externalAnswerDraftLabel}
                  </span>
                )}
                {externalAnswerPreview.ignoredLines.length > 0 && (
                  <span className="rounded bg-orange-500/10 px-2 py-1 text-orange-200">
                    {externalAnswerPreview.ignoredLines.length} ignoradas
                  </span>
                )}
                {externalAnswerPreview.duplicateNumbers.length > 0 && (
                  <span className="rounded bg-yellow-500/10 px-2 py-1 text-yellow-200">
                    {externalAnswerPreview.duplicateNumbers.length} repetidas
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsQuickCaptureDockOpen((current) => !current)}
                  className="rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-cyan-100 hover:bg-cyan-400/20"
                >
                  <Keyboard className="mr-1 inline h-3.5 w-3.5" />
                  Capturador
                </button>
                {externalAnswersText.trim() && (
                  <button
                    type="button"
                    onClick={discardExternalAnswerDraft}
                    title="Descartar rascunho TEC"
                    className="rounded border border-white/10 bg-white/5 px-2 py-1 text-gray-400 hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                Caderno
                <input
                  type="url"
                  value={tecUrl}
                  onChange={(event) => setTecUrl(event.target.value)}
                  onBlur={() => setTecUrl(persistTecSidecarUrl(tecUrl))}
                  className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white outline-none focus:border-cyan-400"
                />
              </label>
              <button
                type="button"
                onClick={openTecWindow}
                className="self-end rounded border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-400/20"
              >
                <ExternalLink className="mr-1 inline h-4 w-4" /> {tecSidecarStatus === 'open' ? 'Focar TEC' : 'Abrir TEC'}
              </button>
            </div>

            <div className="grid gap-3 rounded border border-white/10 bg-black/10 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-[112px] gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                  Questão
                  <input
                    type="number"
                    min={1}
                    value={quickExternalAnswerNumber}
                    onChange={(event) =>
                      setQuickExternalAnswerNumber(Math.max(1, Math.trunc(Number(event.target.value) || 1)))
                    }
                    className="h-10 rounded border border-[#525252] bg-[#404040] px-3 text-sm font-black normal-case tracking-normal text-white outline-none focus:border-cyan-400"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setQuickExternalAnswerNumber(suggestedExternalAnswerNumber)}
                  title="Usar próxima questão livre"
                  className="h-10 rounded border border-white/10 bg-white/5 px-3 text-gray-300 hover:bg-white/10"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={undoLatestQuickExternalAnswer}
                  disabled={externalAnswerPreview.entries.length === 0}
                  title="Desfazer última resposta capturada"
                  className="h-10 rounded border border-white/10 bg-white/5 px-3 text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <div className="flex min-w-[220px] flex-1 flex-wrap gap-2">
                  {QUICK_MULTIPLE_CHOICE_ANSWERS.map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => captureQuickExternalAnswer(answer)}
                      className="h-10 min-w-10 rounded border border-cyan-300/20 bg-cyan-400/10 px-3 text-sm font-black text-cyan-100 hover:bg-cyan-400/20"
                    >
                      {answer}
                    </button>
                  ))}
                </div>
                <div className="grid min-w-[170px] flex-1 grid-cols-2 gap-2">
                  {QUICK_BINARY_ANSWERS.map((answer) => (
                    <button
                      key={answer}
                      type="button"
                      onClick={() => captureQuickExternalAnswer(answer)}
                      className="h-10 rounded border border-white/10 bg-white/5 px-3 text-xs font-black uppercase tracking-widest text-gray-100 hover:bg-white/10"
                    >
                      {answer}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
              Respostas
              <textarea
                value={externalAnswersText}
                onChange={(event) => setExternalAnswersText(event.target.value)}
                rows={5}
                placeholder={'1 C\n2 E\nQ3 A\nQuestao 4: Errado'}
                className="min-h-[130px] rounded border border-[#525252] bg-[#202020] px-3 py-2 text-sm font-semibold normal-case tracking-normal text-gray-100 outline-none focus:border-cyan-400"
              />
            </label>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded border border-white/5 bg-black/20 p-3">
            <div className="flex flex-wrap gap-2">
              {externalAnswerPreview.entries.slice(0, 12).map((entry) => (
                <span
                  key={`${entry.number}-${entry.answer}`}
                  className="rounded bg-white/10 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-gray-100"
                >
                  Q{entry.number} {entry.answer}
                </span>
              ))}
              {externalAnswerPreview.entries.length > 12 && (
                <span className="rounded bg-white/5 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-gray-400">
                  +{externalAnswerPreview.entries.length - 12}
                </span>
              )}
              {externalAnswerPreview.entries.length === 0 && (
                <span className="rounded border border-dashed border-white/10 px-3 py-2 text-xs font-bold text-gray-500">
                  Sem respostas lidas.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={applyExternalAnswersToBank}
              disabled={filteredBankItems.length === 0 || externalAnswerPreview.entries.length === 0}
              className="rounded bg-cyan-300 px-4 py-3 text-sm font-black uppercase tracking-widest text-black hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aplicar às Filtradas
            </button>

            {selectedExternalAnswerBatch && (
              <div className="grid gap-2 border-t border-white/10 pt-3">
                <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                  {selectedExternalAnswerBatch.sourceName && (
                    <span
                      title={selectedExternalAnswerBatch.sourceName}
                      className="max-w-full truncate rounded bg-black/25 px-2 py-1 text-gray-200"
                    >
                      {lastBatchTimestamp ? `Lote ${lastBatchTimestamp}` : 'Lote salvo'}
                    </span>
                  )}
                  <span className="rounded bg-white/10 px-2 py-1 text-cyan-100">
                    {selectedExternalAnswerBatch.applied} aplicadas
                  </span>
                  <span className="rounded bg-red-500/10 px-2 py-1 text-red-200">
                    {lastBatchWrongOrUncorrectedItems.length} erradas/incertas
                  </span>
                  {selectedExternalAnswerBatch.unmatched > 0 && (
                    <span className="rounded bg-orange-500/10 px-2 py-1 text-orange-200">
                      {selectedExternalAnswerBatch.unmatched} sem par
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeExternalBatchFromHistory(selectedExternalAnswerBatch.id)}
                    title="Remover lote TEC"
                    className="rounded border border-white/10 bg-white/5 px-2 py-1 text-gray-400 hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => createTaskFromExternalBatch('wrong-or-uncorrected')}
                    disabled={lastBatchWrongOrUncorrectedItems.length === 0}
                    className="rounded border border-red-300/20 bg-red-400/10 px-3 py-2 text-xs font-black uppercase tracking-widest text-red-100 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Revisar Erros
                  </button>
                  <button
                    type="button"
                    onClick={() => createTaskFromExternalBatch('all')}
                    disabled={lastBatchItems.length === 0}
                    className="rounded border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs font-black uppercase tracking-widest text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reexecutar Lote
                  </button>
                </div>
                {externalAnswerBatches.length > 1 && (
                  <div className="grid gap-2 border-t border-white/10 pt-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Histórico TEC</p>
                    <div className="grid gap-2">
                      {externalAnswerBatches.slice(0, 5).map((batch) => {
                        const batchWrongOrUncorrected = selectExternalAnswerReviewItems(
                          questionBank,
                          batch.changedIds,
                          'wrong-or-uncorrected'
                        ).length;
                        const isSelected = batch.id === selectedExternalAnswerBatch.id;
                        const timestamp = formatBatchTimestamp(batch.appliedAt);

                        return (
                          <div key={batch.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setExternalAnswerBatchState((current) => ({
                                  ...current,
                                  selectedBatchId: batch.id,
                                }))
                              }
                              title={batch.sourceName || 'Lote TEC'}
                              className={`rounded border px-3 py-2 text-left text-[11px] font-black uppercase tracking-widest transition-colors ${
                                isSelected
                                  ? 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100'
                                  : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'
                              }`}
                            >
                              <span className="block truncate">{timestamp ? `Lote ${timestamp}` : 'Lote salvo'}</span>
                              <span className="block text-[10px] text-gray-500">
                                {batch.applied} aplicadas · {batchWrongOrUncorrected} erradas/incertas
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeExternalBatchFromHistory(batch.id)}
                              title="Remover lote TEC"
                              className="rounded border border-white/10 bg-white/5 px-3 text-gray-400 hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {filteredBankItems.length > 0 ? (
          <div className="grid gap-3">
            {filteredBankItems.slice(0, 6).map((item) => {
              const latest = item.attempts[item.attempts.length - 1];
              const answerOptions = getQuestionBankAnswerOptions(item);
              return (
                <article key={item.id} className="rounded border border-white/5 bg-[#1a1a1a] p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-300">
                      {item.discipline}
                    </span>
                    <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-200">
                      {item.sourceName}
                    </span>
                    <span className="rounded bg-cyan-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-100">
                      {questionTargetLabel(questionTargetOptions, item.targetSlug)}
                    </span>
                    {item.sourceQuestionNumber && (
                      <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Q{item.sourceQuestionNumber}
                      </span>
                    )}
                    {item.correctAnswer && (
                      <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                        Gab {item.correctAnswer}
                      </span>
                    )}
                    {latest && (
                      <span className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                        latest.isCorrect === true
                          ? 'bg-[#84cc16]/10 text-[#84cc16]'
                          : latest.isCorrect === false
                            ? 'bg-red-500/10 text-red-300'
                            : 'bg-white/5 text-gray-400'
                      }`}>
                        Ultima {latest.answer} {latest.isCorrect === true ? 'certa' : latest.isCorrect === false ? 'errada' : 'sem correcao'}
                      </span>
                    )}
                    {latest && (
                      <button
                        type="button"
                        onClick={() => resetBankItemAttempts(item.id)}
                        title="Limpar tentativas desta questão"
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                      >
                        <RotateCcw className="inline h-3.5 w-3.5" /> Reset
                      </button>
                    )}
                    {item.hasDoubt && (
                      <span className="rounded bg-orange-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-orange-300">
                        Dúvida
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleFavorite(item.id)}
                      title={item.favorite ? 'Remover favorita' : 'Favoritar'}
                      className={`ml-auto rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                        item.favorite ? 'bg-yellow-400/20 text-yellow-300' : 'bg-white/5 text-gray-400 hover:text-yellow-300'
                      }`}
                    >
                      <Star className="inline h-3.5 w-3.5" /> Fav
                    </button>
                  </div>
                  <p className="line-clamp-2 text-sm font-bold text-gray-200">{item.statement}</p>
                  {answerOptions.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Responder</p>
                      {answerOptions.map((alternative) => {
                        const isLatestAnswer = latest?.answer.trim().toUpperCase() === alternative.label.toUpperCase();
                        const latestTone =
                          isLatestAnswer && latest?.isCorrect === true
                            ? 'border-[#84cc16]/40 bg-[#84cc16]/10 text-[#84cc16]'
                            : isLatestAnswer && latest?.isCorrect === false
                              ? 'border-red-300/40 bg-red-500/10 text-red-200'
                              : isLatestAnswer
                                ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100'
                                : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20';

                        return (
                          <div
                            key={`${item.id}-${alternative.label}`}
                            className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-2 rounded border border-white/5 bg-white/[0.03] p-2"
                          >
                            <button
                              type="button"
                              onClick={() => answerBankItemInline(item.id, alternative.label)}
                              title={`Responder ${alternative.label}: ${alternative.text}`}
                              aria-label={`Responder ${alternative.label}: ${alternative.text}`}
                              className={`h-8 w-8 rounded border text-xs font-black uppercase tracking-widest ${latestTone}`}
                            >
                              {alternative.label}
                            </button>
                            <p className="min-w-0 pt-0.5 text-xs font-semibold leading-snug text-gray-300">
                              {alternative.text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {item.observations && (
                    <p className="mt-2 line-clamp-2 rounded border border-blue-500/10 bg-blue-500/5 px-2 py-1 text-[11px] font-semibold text-blue-200">
                      {item.observations}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] font-bold text-gray-500">
                    {item.lesson || item.taskTitle || 'Sem aula vinculada'} · {item.bank}
                  </p>
                </article>
              );
            })}
            {filteredBankItems.length > 6 && (
              <p className="text-center text-[11px] font-black uppercase tracking-widest text-gray-500">
                +{filteredBankItems.length - 6} questão(ões) ocultas pelos filtros atuais
              </p>
            )}
          </div>
        ) : (
          <div className="rounded border border-dashed border-white/10 bg-[#1a1a1a] p-6 text-center text-sm font-bold text-gray-500">
            Banco vazio ou sem questões para os filtros atuais.
          </div>
        )}
      </section>

      {isQuickCaptureDockOpen && (
        <aside className="fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] rounded border border-cyan-300/20 bg-[#202828] p-3 shadow-2xl shadow-black/60">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-100">TEC Assistido</p>
              <p className="truncate text-[11px] font-bold text-gray-500">
                {externalAnswerPreview.entries.length} lidas · {filteredBankItems.length} filtradas
                {externalAnswerDraftLabel ? ` · ${externalAnswerDraftLabel}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openTecWindow}
                title={tecSidecarStatus === 'open' ? 'Focar TEC' : 'Abrir TEC'}
                className="rounded border border-cyan-300/20 bg-cyan-400/10 p-2 text-cyan-100 hover:bg-cyan-400/20"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              {externalAnswersText.trim() && (
                <button
                  type="button"
                  onClick={discardExternalAnswerDraft}
                  title="Descartar rascunho TEC"
                  className="rounded border border-white/10 bg-white/5 p-2 text-gray-300 hover:border-red-300/30 hover:bg-red-500/10 hover:text-red-200"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQuickCaptureDockOpen(false)}
                title="Fechar capturador"
                className="rounded border border-white/10 bg-white/5 p-2 text-gray-300 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-end gap-2">
              <label className="grid min-w-0 flex-1 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                Questão
                <input
                  type="number"
                  min={1}
                  value={quickExternalAnswerNumber}
                  onChange={(event) =>
                    setQuickExternalAnswerNumber(Math.max(1, Math.trunc(Number(event.target.value) || 1)))
                  }
                  className="h-10 rounded border border-[#525252] bg-[#404040] px-3 text-sm font-black normal-case tracking-normal text-white outline-none focus:border-cyan-400"
                />
              </label>
              <button
                type="button"
                onClick={() => setQuickExternalAnswerNumber(suggestedExternalAnswerNumber)}
                title="Usar próxima questão livre"
                className="h-10 rounded border border-white/10 bg-white/5 px-3 text-gray-300 hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={undoLatestQuickExternalAnswer}
                disabled={externalAnswerPreview.entries.length === 0}
                title="Desfazer última resposta capturada"
                className="h-10 rounded border border-white/10 bg-white/5 px-3 text-gray-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {QUICK_MULTIPLE_CHOICE_ANSWERS.map((answer) => (
                <button
                  key={`dock-${answer}`}
                  type="button"
                  onClick={() => captureQuickExternalAnswer(answer)}
                  className="h-11 rounded border border-cyan-300/20 bg-cyan-400/10 text-sm font-black text-cyan-100 hover:bg-cyan-400/20"
                >
                  {answer}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {QUICK_BINARY_ANSWERS.map((answer) => (
                <button
                  key={`dock-${answer}`}
                  type="button"
                  onClick={() => captureQuickExternalAnswer(answer)}
                  className="h-11 rounded border border-white/10 bg-white/5 px-3 text-xs font-black uppercase tracking-widest text-gray-100 hover:bg-white/10"
                >
                  {answer}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={applyExternalAnswersToBank}
              disabled={filteredBankItems.length === 0 || externalAnswerPreview.entries.length === 0}
              className="h-11 rounded bg-cyan-300 px-4 text-sm font-black uppercase tracking-widest text-black hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aplicar às Filtradas
            </button>
          </div>
        </aside>
      )}
    </section>
  );
};
