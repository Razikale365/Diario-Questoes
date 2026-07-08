import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, PanInfo } from 'framer-motion';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  MessageSquare,
  Star,
  X,
} from 'lucide-react';

import { Question, StudyTask } from '../types';
import {
  buildQuestionCardDeck,
  findFirstUnansweredCardIndex,
  summarizeQuestionCardDeck,
} from '../utils/questionCardDeck';

interface QuestionCardDeckProps {
  task: StudyTask;
  onUpdateQuestion: (blockId: string, qNumber: number, updates: Partial<Question>) => void;
  onFinishTask?: () => void;
}

const clampIndex = (value: number, total: number) => {
  if (total <= 0) return 0;
  return Math.min(Math.max(value, 0), total - 1);
};

const resultClassName = (question: Question) => {
  if (question.isCorrect === true) return 'bg-[#84cc16]/15 text-[#84cc16] ring-[#84cc16]/30';
  if (question.isCorrect === false) return 'bg-red-500/10 text-red-300 ring-red-500/30';
  if (question.answer) return 'bg-purple-500/10 text-purple-200 ring-purple-500/30';
  return 'bg-white/5 text-gray-400 ring-white/10';
};

const resultLabel = (question: Question) => {
  if (question.isCorrect === true) return 'Certa';
  if (question.isCorrect === false) return 'Errada';
  if (question.answer) return 'Respondida';
  return 'Pendente';
};

export const QuestionCardDeck: React.FC<QuestionCardDeckProps> = ({
  task,
  onUpdateQuestion,
  onFinishTask,
}) => {
  const cards = useMemo(() => buildQuestionCardDeck(task), [task]);
  const summary = useMemo(() => summarizeQuestionCardDeck(cards), [cards]);
  const initializedTaskIdRef = useRef<string | null>(null);
  const deckRef = useRef<HTMLElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isEditingObservation, setIsEditingObservation] = useState(false);

  useEffect(() => {
    if (initializedTaskIdRef.current !== task.id) {
      initializedTaskIdRef.current = task.id;
      setCurrentIndex(findFirstUnansweredCardIndex(cards));
      return;
    }

    setCurrentIndex((previous) => clampIndex(previous, cards.length));
  }, [cards, task.id]);

  const currentCard = cards[currentIndex];
  const currentQuestion = currentCard?.question;
  const answeredPercent = summary.total > 0 ? (summary.answered / summary.total) * 100 : 0;

  useEffect(() => {
    setIsEditingObservation(Boolean(currentQuestion?.observations));
  }, [currentCard?.id, currentQuestion?.observations]);

  const updateCurrentQuestion = (updates: Partial<Question>) => {
    if (!currentCard || currentCard.blockIsLocked) return;
    onUpdateQuestion(currentCard.blockId, currentCard.question.number, updates);
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

    if (currentQuestion.answer === alternative) {
      updateCurrentQuestion({ answer: '' });
      return;
    }

    const nextEliminated = (currentQuestion.eliminated || []).filter((item) => item !== alternative);
    updateCurrentQuestion({
      answer: alternative,
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

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-[#262626] p-8 text-center">
        <BookOpen className="mx-auto mb-4 h-8 w-8 text-gray-600" />
        <p className="text-sm font-bold text-gray-500">Nenhuma questão completa disponível nesta tarefa.</p>
      </div>
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
          </div>

          <div className="flex items-center justify-between gap-2 md:justify-end">
            <button
              type="button"
              onClick={goPrevious}
              disabled={currentIndex === 0}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Questao anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-[72px] text-center text-xs font-black uppercase tracking-widest text-gray-400">
              {currentIndex + 1}/{cards.length}
            </div>
            <button
              type="button"
              onClick={goNext}
              disabled={currentIndex >= cards.length - 1}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              title="Proxima questao"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
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
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-black ring-1 ${resultClassName(currentQuestion)}`}>
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
                      {currentQuestion.correctAnswer && (
                        <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                          Gab {currentQuestion.correctAnswer}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-bold text-gray-500">
                      {currentQuestion.sourceName || task.discipline}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className={`mr-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest ring-1 ${resultClassName(currentQuestion)}`}>
                    {resultLabel(currentQuestion)}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateCurrentQuestion({ favorite: !currentQuestion.favorite })}
                    disabled={currentCard.blockIsLocked}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                      currentQuestion.favorite
                        ? 'bg-yellow-500/10 text-yellow-300'
                        : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                    title="Favoritar"
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
                    title="Observacao"
                  >
                    <MessageSquare className={`h-4 w-4 ${currentQuestion.observations ? 'fill-blue-300/20' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <p className="max-w-[118ch] text-[15px] font-semibold leading-7 text-gray-100 [text-wrap:pretty] md:text-base lg:text-[17px] lg:leading-8">
                  {currentQuestion.statement}
                </p>

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
                              ? currentQuestion.isCorrect === true
                                ? 'bg-[#84cc16]/15 text-white ring-1 ring-[#84cc16]/50'
                                : currentQuestion.isCorrect === false
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
    </section>
  );
};
