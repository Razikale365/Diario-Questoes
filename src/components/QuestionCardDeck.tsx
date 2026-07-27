import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, PanInfo } from 'framer-motion';
import {
  BookOpen,
  Check,
  ChevronFirst,
  ChevronLeft,
  ChevronLast,
  ChevronRight,
  Edit2,
  Flag,
  MessageSquare,
  Plus,
  Shuffle,
  SkipForward,
  Star,
  X,
} from 'lucide-react';

import { Question, StudyTask } from '../types';
import {
  buildQuestionCardDeck,
  findAdjacentQuestionCardBlockIndex,
  findFirstUnansweredCardIndex,
  findNextUnansweredQuestionCardIndex,
  findQuestionCardIndexByDisplayNumber,
  findRandomUnansweredQuestionCardIndex,
  getQuestionCardAlternativeShortcut,
  getQuestionCardNavigationShortcut,
  shouldHandleQuestionCardShortcut,
  summarizeQuestionCardDeck,
} from '../utils/questionCardDeck';
import { isEditableShortcutTarget } from '../utils/externalAnswers';
import { QuestionEditorModal } from './QuestionEditorModal';
import { QuestionSourcePageViewer } from './QuestionSourcePageViewer';
import {
  buildAnswerSelectionUpdate,
  QuestionDraft,
  SaveQuestionDraftResult,
  shouldShowQuestionCorrectness,
  toggleQuestionAnswerReveal,
} from '../utils/questionExecution';

interface QuestionCardDeckProps {
  task: StudyTask;
  onUpdateQuestion: (blockId: string, qNumber: number, updates: Partial<Question>) => void;
  onSaveQuestion: (blockId: string, draft: QuestionDraft, editingQuestionNumber?: number) => SaveQuestionDraftResult;
  onFinishTask?: () => void;
}

const clampIndex = (value: number, total: number) => {
  if (total <= 0) return 0;
  return Math.min(Math.max(value, 0), total - 1);
};

const resultClassName = (question: Question, isRevealed: boolean) => {
  if (isRevealed && question.correctAnswer === 'ANULADA') return 'bg-amber-500/10 text-amber-200 ring-amber-500/30';
  if (shouldShowQuestionCorrectness(question, isRevealed) && question.isCorrect === true) return 'bg-[#84cc16]/15 text-[#84cc16] ring-[#84cc16]/30';
  if (shouldShowQuestionCorrectness(question, isRevealed) && question.isCorrect === false) return 'bg-red-500/10 text-red-300 ring-red-500/30';
  if (question.answer) return 'bg-purple-500/10 text-purple-200 ring-purple-500/30';
  return 'bg-white/5 text-gray-400 ring-white/10';
};

const resultLabel = (question: Question, isRevealed: boolean) => {
  if (isRevealed && question.correctAnswer === 'ANULADA') return 'Anulada';
  if (shouldShowQuestionCorrectness(question, isRevealed) && question.isCorrect === true) return 'Certa';
  if (shouldShowQuestionCorrectness(question, isRevealed) && question.isCorrect === false) return 'Errada';
  if (question.answer) return 'Respondida';
  return 'Pendente';
};

export const QuestionCardDeck: React.FC<QuestionCardDeckProps> = ({
  task,
  onUpdateQuestion,
  onSaveQuestion,
  onFinishTask,
}) => {
  const cards = useMemo(() => buildQuestionCardDeck(task), [task]);
  const initializedTaskIdRef = useRef<string | null>(null);
  const deckRef = useRef<HTMLElement>(null);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const jumpButtonRef = useRef<HTMLButtonElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isEditingObservation, setIsEditingObservation] = useState(false);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<string>>(() => new Set());
  const [questionBeingEdited, setQuestionBeingEdited] = useState<Question | null | undefined>(undefined);
  const [isJumpingToQuestion, setIsJumpingToQuestion] = useState(false);
  const [shouldRestoreJumpFocus, setShouldRestoreJumpFocus] = useState(false);
  const summary = useMemo(() => {
    const visibleCards = cards.map((card) => shouldShowQuestionCorrectness(card.question, revealedQuestionIds.has(card.id))
      ? card
      : { ...card, isCorrect: false, isWrong: false });
    const visibleSummary = summarizeQuestionCardDeck(visibleCards);
    const graded = visibleSummary.correct + visibleSummary.wrong;
    return {
      ...visibleSummary,
      accuracy: graded > 0 ? Number(((visibleSummary.correct / graded) * 100).toFixed(1)) : 0,
    };
  }, [cards, revealedQuestionIds]);

  useEffect(() => {
    if (initializedTaskIdRef.current !== task.id) {
      initializedTaskIdRef.current = task.id;
      setCurrentIndex(findFirstUnansweredCardIndex(cards));
      setRevealedQuestionIds(new Set());
      return;
    }

    setCurrentIndex((previous) => clampIndex(previous, cards.length));
  }, [cards, task.id]);

  const currentCard = cards[currentIndex];
  const currentQuestion = currentCard?.question;
  const currentBlock = currentCard ? task.blocks.find((block) => block.id === currentCard.blockId) : undefined;
  const isCurrentQuestionRevealed = Boolean(currentCard && revealedQuestionIds.has(currentCard.id));
  const answeredPercent = summary.total > 0 ? (summary.answered / summary.total) * 100 : 0;

  useEffect(() => {
    setIsEditingObservation(Boolean(currentQuestion?.observations));
  }, [currentCard?.id, currentQuestion?.observations]);

  const updateCurrentQuestion = (updates: Partial<Question>) => {
    if (!currentCard || currentCard.blockIsLocked) return;
    onUpdateQuestion(currentCard.blockId, currentCard.question.number, updates);
  };

  const toggleCurrentQuestionReveal = () => {
    if (!currentCard || !currentQuestion?.correctAnswer) return;
    const decision = toggleQuestionAnswerReveal(
      revealedQuestionIds,
      currentCard.id,
      currentQuestion,
    );
    setRevealedQuestionIds(decision.revealedIds);
    if (!currentCard.blockIsLocked && decision.updates) {
      onUpdateQuestion(currentCard.blockId, currentQuestion.number, decision.updates);
    }
  };

  const goToCard = (nextIndex: number, nextDirection: number) => {
    setDirection(nextDirection);
    setCurrentIndex((previous) => clampIndex(nextIndex, cards.length || previous + 1));
    window.requestAnimationFrame(() => {
      deckRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };

  const goPrevious = () => goToCard(currentIndex - 1, -1);
  const goNext = () => goToCard(currentIndex + 1, 1);
  const goToNextUnanswered = () => {
    const nextIndex = findNextUnansweredQuestionCardIndex(cards, currentIndex);
    goToCard(nextIndex, nextIndex >= currentIndex ? 1 : -1);
  };
  const goToRandomUnanswered = () => {
    const nextIndex = findRandomUnansweredQuestionCardIndex(cards, currentIndex);
    goToCard(nextIndex, nextIndex >= currentIndex ? 1 : -1);
  };
  const goToPreviousTopic = () => goToCard(
    findAdjacentQuestionCardBlockIndex(cards, currentIndex, 'previous'),
    -1,
  );
  const goToNextTopic = () => goToCard(
    findAdjacentQuestionCardBlockIndex(cards, currentIndex, 'next'),
    1,
  );

  const toggleFavorite = () => {
    if (!currentQuestion) return;
    updateCurrentQuestion({ favorite: !currentQuestion.favorite });
  };

  const closeJumpToQuestion = () => {
    setIsJumpingToQuestion(false);
    setShouldRestoreJumpFocus(true);
  };

  useEffect(() => {
    const handleCardNavigationShortcut = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
      const isDialogOpen = questionBeingEdited !== undefined || Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (!shouldHandleQuestionCardShortcut({
        hasModifier,
        isEnterOnInteractiveControl: event.key === 'Enter' && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement),
        isEditable: isEditableShortcutTarget(target?.tagName, Boolean(target?.isContentEditable)),
        isDialogOpen,
        isDefaultPrevented: event.defaultPrevented,
      })) return;

      const shortcut = getQuestionCardNavigationShortcut(
        event.key,
        hasModifier,
      );
      if (shortcut === 'previous') {
        event.preventDefault();
        goPrevious();
      }
      if (shortcut === 'next') {
        event.preventDefault();
        goNext();
        return;
      }

      const key = event.key.toUpperCase();
      if (key === 'L') {
        event.preventDefault();
        goToRandomUnanswered();
        return;
      }
      if (key === 'N') {
        event.preventDefault();
        goToNextUnanswered();
        return;
      }
      if (key === 'Z') {
        event.preventDefault();
        goToPreviousTopic();
        return;
      }
      if (key === 'X') {
        event.preventDefault();
        goToNextTopic();
        return;
      }
      if (key === 'P') {
        event.preventDefault();
        setIsJumpingToQuestion(true);
        return;
      }
      if (key === 'M') {
        event.preventDefault();
        toggleFavorite();
        return;
      }
      if (key === 'O') {
        event.preventDefault();
        setIsEditingObservation((previous) => !previous);
        return;
      }
      if (key === 'I' && currentQuestion && !currentCard?.blockIsLocked) {
        event.preventDefault();
        setQuestionBeingEdited(currentQuestion);
        return;
      }
      if (event.key === 'Enter' && currentQuestion?.answer) {
        event.preventDefault();
        toggleCurrentQuestionReveal();
        return;
      }

      const alternative = getQuestionCardAlternativeShortcut(event.key, currentQuestion?.alternatives || []);
      if (!alternative || !currentQuestion || currentCard?.blockIsLocked) return;
      event.preventDefault();
      if (currentQuestion.answer === alternative) {
        const eliminated = currentQuestion.eliminated || [];
        updateCurrentQuestion({
          ...buildAnswerSelectionUpdate(currentQuestion, alternative),
          eliminated: eliminated.includes(alternative) ? eliminated.filter((item) => item !== alternative) : [...eliminated, alternative],
        });
        return;
      }
      selectAlternative(alternative);
    };

    window.addEventListener('keydown', handleCardNavigationShortcut);
    return () => window.removeEventListener('keydown', handleCardNavigationShortcut);
  }, [cards, currentCard?.blockIsLocked, currentIndex, currentQuestion, questionBeingEdited, task.id]);

  useEffect(() => {
    if (isJumpingToQuestion) {
      jumpInputRef.current?.focus();
      return;
    }
    if (shouldRestoreJumpFocus) {
      jumpButtonRef.current?.focus();
      setShouldRestoreJumpFocus(false);
    }
  }, [isJumpingToQuestion, shouldRestoreJumpFocus]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 90) return;
    if (info.offset.x < 0) {
      goNext();
      return;
    }
    goPrevious();
  };

  const selectAlternative = (alternative: string) => {
    if (!currentQuestion) return;
    if (currentCard) {
      setRevealedQuestionIds((current) => {
        const next = new Set(current);
        next.delete(currentCard.id);
        return next;
      });
    }

    const nextEliminated = (currentQuestion.eliminated || []).filter((item) => item !== alternative);
    updateCurrentQuestion({
      ...buildAnswerSelectionUpdate(currentQuestion, alternative),
      eliminated: nextEliminated.length > 0 ? nextEliminated : undefined,
    });
  };

  const toggleAlternativeList = (field: 'eliminated' | 'doubtedAlts', alternative: string) => {
    if (!currentQuestion) return;

    const current = currentQuestion[field] || [];
    const next = current.includes(alternative)
      ? current.filter((item) => item !== alternative)
      : [...current, alternative];
    updateCurrentQuestion({ [field]: next.length > 0 ? next : undefined });
  };

  const firstEditableBlock = task.blocks.find((block) => !block.isSection);

  if (cards.length === 0) {
    return (
      <>
        <div className="rounded-lg border border-dashed border-white/10 bg-[#262626] p-8 text-center">
          <BookOpen className="mx-auto mb-4 h-8 w-8 text-gray-600" />
          <p className="text-sm font-bold text-gray-500">Nenhuma questão completa disponível nesta tarefa.</p>
          {firstEditableBlock && !firstEditableBlock.isLocked && (
            <button
              type="button"
              onClick={() => setQuestionBeingEdited(null)}
              className="mx-auto mt-5 flex h-10 items-center gap-2 rounded-lg bg-purple-600 px-4 text-xs font-black text-white transition-colors hover:bg-purple-500"
            >
              <Plus className="h-4 w-4" />
              Adicionar questão
            </button>
          )}
        </div>
        {questionBeingEdited !== undefined && firstEditableBlock && (
          <QuestionEditorModal
            question={questionBeingEdited || undefined}
            suggestedSourceNumber={1}
            onClose={() => setQuestionBeingEdited(undefined)}
            onSave={(draft) => onSaveQuestion(firstEditableBlock.id, draft, questionBeingEdited?.number)}
          />
        )}
      </>
    );
  }

  return (
    <section ref={deckRef} className="mx-auto w-full max-w-[1520px] space-y-4 pb-20">
      <div className="rounded-2xl border border-white/5 bg-[#262626] p-3 md:p-4 lg:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-300">
                Cards
              </span>
              <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                {summary.answered}/{summary.total} respondidas
              </span>
              <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                {summary.correct} certas
              </span>
              <span className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-300">
                {summary.wrong} erradas
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
              <div className="h-full rounded-full bg-[#84cc16] transition-[width]" style={{ width: `${answeredPercent}%` }} />
            </div>
            <p className="mt-2 text-xs font-bold text-gray-400">
              Atalhos TEC: ←/→ navegar · N pendente · L aleatória · Z/X tópicos · 1–5/A–E marcar · Enter corrigir · M favorita · P ir para
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">
            <button
              type="button"
              onClick={() => setQuestionBeingEdited(null)}
              disabled={!currentCard || currentCard.blockIsLocked}
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-gray-400 transition-colors hover:bg-purple-500/10 hover:text-purple-200 disabled:cursor-not-allowed disabled:opacity-40"
              title="Adicionar questão neste bloco"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goPrevious}
              disabled={currentIndex === 0}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Questão anterior (Seta esquerda)"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-[72px] text-center text-xs font-black uppercase tracking-widest text-gray-400">
              {currentCard?.displayNumber ?? 0}/{cards.length}
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex >= cards.length - 1}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Próxima questão (Seta direita)"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToRandomUnanswered}
              disabled={summary.answered === summary.total}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Questão aleatória não resolvida (L)"
              aria-label="Questão aleatória não resolvida"
            >
              <Shuffle className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToNextUnanswered}
              disabled={summary.answered === summary.total}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Próxima questão não resolvida (N)"
              aria-label="Próxima questão não resolvida"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToPreviousTopic}
              disabled={findAdjacentQuestionCardBlockIndex(cards, currentIndex, 'previous') === currentIndex}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Tópico anterior (Z)"
              aria-label="Tópico anterior"
            >
              <ChevronFirst className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToNextTopic}
              disabled={findAdjacentQuestionCardBlockIndex(cards, currentIndex, 'next') === currentIndex}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Próximo tópico (X)"
              aria-label="Próximo tópico"
            >
              <ChevronLast className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setIsJumpingToQuestion(true)}
              ref={jumpButtonRef}
              className="flex h-11 items-center justify-center rounded-xl bg-white/5 px-3 text-xs font-black text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
              title="Ir para questão (P)"
            >
              Ir para
            </button>
          </div>
        </div>
        {isJumpingToQuestion && (
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const target = new FormData(event.currentTarget).get('question-position');
              const displayNumber = typeof target === 'string' ? Number.parseInt(target, 10) : Number.NaN;
              const nextIndex = Number.isInteger(displayNumber)
                ? findQuestionCardIndexByDisplayNumber(cards, displayNumber)
                : -1;
              if (nextIndex >= 0) goToCard(nextIndex, nextIndex >= currentIndex ? 1 : -1);
              closeJumpToQuestion();
            }}
          >
            <label htmlFor="jump-to-question" className="text-xs font-bold text-gray-300">Questão</label>
            <input
              ref={jumpInputRef}
              id="jump-to-question"
              name="question-position"
              type="number"
              min="1"
              max={cards.length}
              className="h-9 w-20 rounded-lg border border-white/10 bg-black/25 px-2 text-sm font-bold text-white outline-none focus:border-purple-400/50"
              onKeyDown={(event) => {
                if (event.key === 'Escape') closeJumpToQuestion();
              }}
            />
            <span className="text-xs text-gray-500">de {cards.length}</span>
          </form>
        )}
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-x-3 bottom-0 top-4 z-0 rounded-2xl border border-white/5 bg-[#202020]" />
        <div className="pointer-events-none absolute inset-x-6 bottom-0 top-8 z-0 hidden rounded-2xl border border-white/5 bg-[#1d1d1d] sm:block" />

        <AnimatePresence mode="wait" custom={direction}>
          {currentCard && currentQuestion && (
            <motion.article
              key={currentCard.id}
              custom={direction}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={handleDragEnd}
              initial={{ opacity: 0, x: direction >= 0 ? 48 : -48, rotate: direction >= 0 ? 2 : -2 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: direction >= 0 ? -48 : 48, rotate: direction >= 0 ? -2 : 2 }}
              transition={{ duration: 0.18 }}
              className="relative z-10 flex min-h-[420px] flex-col rounded-2xl border border-white/10 bg-[#262626] p-4 shadow-2xl shadow-black/30 md:p-5 xl:p-6"
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-sm font-black ring-1 ${resultClassName(currentQuestion, isCurrentQuestionRevealed)}`}>
                    {currentCard.displayNumber}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="max-w-[240px] truncate rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-300">
                        {currentCard.blockTitle}
                      </span>
                      {currentCard.blockLesson && (
                        <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                          {currentCard.blockLesson}
                        </span>
                      )}
                      {isCurrentQuestionRevealed && currentQuestion.correctAnswer && (
                        <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                          {currentQuestion.correctAnswer === 'ANULADA' ? 'Anulada' : `Gab ${currentQuestion.correctAnswer}`}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-bold text-gray-500">
                      {currentQuestion.sourceName || task.discipline}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className={`mr-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest ring-1 ${resultClassName(currentQuestion, isCurrentQuestionRevealed)}`}>
                    {resultLabel(currentQuestion, isCurrentQuestionRevealed)}
                  </span>
                  {currentQuestion.correctAnswer && (
                    <button
                      type="button"
                      onClick={toggleCurrentQuestionReveal}
                      aria-pressed={isCurrentQuestionRevealed}
                      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                        isCurrentQuestionRevealed
                          ? 'bg-purple-500/10 text-purple-200'
                          : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                      }`}
                      title={isCurrentQuestionRevealed ? 'Ocultar gabarito' : 'Revelar gabarito'}
                    >
                      <BookOpen className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setQuestionBeingEdited(currentQuestion)}
                    disabled={currentCard.blockIsLocked}
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-gray-500 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    title="Editar questão"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleFavorite}
                    disabled={currentCard.blockIsLocked}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      currentQuestion.favorite
                        ? 'bg-yellow-500/10 text-yellow-300'
                        : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title="Favoritar (M)"
                  >
                    <Star className={`h-4 w-4 ${currentQuestion.favorite ? 'fill-yellow-300' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCurrentQuestion({ hasDoubt: !currentQuestion.hasDoubt })}
                    disabled={currentCard.blockIsLocked}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      currentQuestion.hasDoubt
                        ? 'bg-orange-500/10 text-orange-300'
                        : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title="Marcar duvida"
                  >
                    <Flag className={`h-4 w-4 ${currentQuestion.hasDoubt ? 'fill-orange-300' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingObservation((previous) => !previous)}
                    disabled={currentCard.blockIsLocked}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      currentQuestion.observations || isEditingObservation
                        ? 'bg-blue-500/10 text-blue-300'
                        : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title="Observação (O)"
                  >
                    <MessageSquare className={`h-4 w-4 ${currentQuestion.observations ? 'fill-blue-300/20' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <p className="max-w-[118ch] text-[15px] font-semibold leading-7 text-gray-100 [text-wrap:pretty] md:text-base lg:text-[17px] lg:leading-8">
                  {currentQuestion.statement}
                </p>
                <QuestionSourcePageViewer sourcePage={currentQuestion.sourcePage} />

                <div className="mt-5 grid gap-2.5 lg:gap-3">
                  {currentQuestion.alternatives?.map((alternative) => {
                    const isSelected = currentQuestion.answer === alternative.label;
                    const isEliminated = (currentQuestion.eliminated || []).includes(alternative.label);
                    const isDoubted = (currentQuestion.doubtedAlts || []).includes(alternative.label);

                    return (
                      <div key={alternative.label} className="flex items-stretch gap-2">
                        <button
                          type="button"
                          onClick={() => selectAlternative(alternative.label)}
                          disabled={currentCard.blockIsLocked}
                          className={`flex min-h-[52px] flex-1 items-start gap-3 rounded-xl px-3 py-3 text-left transition-[background-color,box-shadow,color,opacity] ${
                            isSelected
                              ? shouldShowQuestionCorrectness(currentQuestion, isCurrentQuestionRevealed) && currentQuestion.isCorrect === true
                                ? 'bg-[#84cc16]/15 text-white ring-1 ring-[#84cc16]/50'
                                : shouldShowQuestionCorrectness(currentQuestion, isCurrentQuestionRevealed) && currentQuestion.isCorrect === false
                                  ? 'bg-red-500/15 text-white ring-1 ring-red-500/50'
                                  : 'bg-purple-600 text-white ring-1 ring-purple-400/50'
                              : isEliminated
                                ? 'bg-red-900/10 text-gray-600 line-through ring-1 ring-red-900/20'
                                : isDoubted
                                  ? 'bg-amber-500/10 text-gray-100 ring-1 ring-amber-500/40'
                                  : 'bg-[#1a1a1a] text-gray-200 ring-1 ring-white/5 hover:bg-white/5 hover:ring-white/10'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/25 text-xs font-black">
                            {alternative.label}
                          </span>
                          <span className="text-sm font-semibold leading-relaxed [text-wrap:pretty] lg:text-[15px]">{alternative.text}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleAlternativeList('doubtedAlts', alternative.label)}
                          disabled={currentCard.blockIsLocked}
                          className={`flex w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                            isDoubted
                              ? 'bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40'
                              : 'bg-white/5 text-gray-600 hover:bg-white/10 hover:text-white'
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                          title="Marcar alternativa considerada"
                        >
                          <Flag className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleAlternativeList('eliminated', alternative.label)}
                          disabled={currentCard.blockIsLocked}
                          className={`flex w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
                            isEliminated
                              ? 'bg-red-500/10 text-red-300 ring-1 ring-red-500/40'
                              : 'bg-white/5 text-gray-600 hover:bg-white/10 hover:text-white'
                          } disabled:cursor-not-allowed disabled:opacity-40`}
                          title="Eliminar alternativa"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {isEditingObservation && (
                  <textarea
                    value={currentQuestion.observations || ''}
                    onChange={(event) => updateCurrentQuestion({ observations: event.target.value })}
                    disabled={currentCard.blockIsLocked}
                    placeholder="Observacao"
                    rows={3}
                    className="mt-4 min-h-[88px] w-full resize-none rounded-xl border border-white/10 bg-[#111111] p-3 text-sm font-semibold text-gray-200 outline-none transition-colors focus:border-blue-400/50 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                  {currentCard.blockBank && <span className="rounded bg-white/5 px-2 py-1">{currentCard.blockBank}</span>}
                  {summary.doubts > 0 && <span className="rounded bg-orange-500/10 px-2 py-1 text-orange-300">{summary.doubts} dúvidas</span>}
                  {summary.favorites > 0 && <span className="rounded bg-yellow-500/10 px-2 py-1 text-yellow-300">{summary.favorites} favoritas</span>}
                  {summary.answered > 0 && <span className="rounded bg-purple-500/10 px-2 py-1 text-purple-200">{summary.accuracy}%</span>}
                </div>

                <div className="flex items-center gap-2">
                  {onFinishTask && summary.answered === summary.total && (
                    <button
                      type="button"
                      onClick={onFinishTask}
                      className="flex h-11 items-center gap-2 rounded-xl bg-[#84cc16] px-4 text-xs font-black uppercase tracking-widest text-black transition-colors hover:bg-[#a3e635]"
                    >
                      <Check className="h-4 w-4" />
                      Concluir
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={currentIndex >= cards.length - 1}
                    className="flex h-11 items-center gap-2 rounded-xl bg-purple-600 px-4 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.article>
          )}
        </AnimatePresence>
      </div>
      {questionBeingEdited !== undefined && currentBlock && (
        <QuestionEditorModal
          question={questionBeingEdited || undefined}
          suggestedSourceNumber={Math.max(
            0,
            ...currentBlock.questions.map((question) => question.sourceQuestionNumber || 0),
          ) + 1}
          onClose={() => setQuestionBeingEdited(undefined)}
          onSave={(draft) => onSaveQuestion(currentBlock.id, draft, questionBeingEdited?.number)}
        />
      )}
    </section>
  );
};
