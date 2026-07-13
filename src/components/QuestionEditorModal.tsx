import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Check, ListChecks, Save, ToggleLeft, X } from 'lucide-react';

import { Question, QuestionAlternative } from '../types';
import {
  QuestionDraft,
  QuestionEditorKind,
  SaveQuestionDraftResult,
} from '../utils/questionExecution';

interface QuestionEditorModalProps {
  question?: Question;
  suggestedSourceNumber?: number;
  onClose: () => void;
  onSave: (draft: QuestionDraft) => SaveQuestionDraftResult;
}

const MULTIPLE_CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E'];

const inferQuestionKind = (question?: Question): QuestionEditorKind => {
  if (question?.isMultipleChoice === false) return 'true_false';
  const labels = question?.alternatives?.map((alternative) => alternative.label.toUpperCase()) || [];
  return labels.length === 2 && labels.includes('C') && labels.includes('E')
    ? 'true_false'
    : 'multiple_choice';
};

const buildMultipleChoiceAlternatives = (question?: Question): QuestionAlternative[] =>
  MULTIPLE_CHOICE_LABELS.map((label) => ({
    label,
    text: question?.alternatives?.find((alternative) => alternative.label.toUpperCase() === label)?.text || '',
  }));

const buildInitialDraft = (question?: Question, suggestedSourceNumber?: number): QuestionDraft => ({
  kind: inferQuestionKind(question),
  sourceQuestionNumber: String(question?.sourceQuestionNumber ?? suggestedSourceNumber ?? ''),
  statement: question?.statement || '',
  alternatives: buildMultipleChoiceAlternatives(question),
  correctAnswer: question?.correctAnswer || '',
  sourceName: question?.sourceName || '',
});

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  question,
  suggestedSourceNumber,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState(() => buildInitialDraft(question, suggestedSourceNumber));
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const answerOptions = useMemo(
    () => (draft.kind === 'true_false' ? ['C', 'E'] : draft.alternatives.map(({ label }) => label)),
    [draft.alternatives, draft.kind],
  );

  const updateAlternative = (label: string, text: string) => {
    setDraft((current) => ({
      ...current,
      alternatives: current.alternatives.map((alternative) =>
        alternative.label === label ? { ...alternative, text } : alternative,
      ),
    }));
  };

  const selectKind = (kind: QuestionEditorKind) => {
    setDraft((current) => ({
      ...current,
      kind,
      correctAnswer: kind === 'true_false' && !['C', 'E', 'ANULADA'].includes(current.correctAnswer)
        ? ''
        : current.correctAnswer,
    }));
    setErrors([]);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSave(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-editor-title"
        onSubmit={handleSubmit}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#242424] shadow-2xl shadow-black/50"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-purple-300">Questão</p>
            <h2 id="question-editor-title" className="mt-1 text-lg font-bold text-white">
              {question ? 'Editar questão' : 'Adicionar questão'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
            title="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-gray-300">Número</span>
              <input
                inputMode="numeric"
                value={draft.sourceQuestionNumber}
                onChange={(event) => setDraft((current) => ({ ...current, sourceQuestionNumber: event.target.value }))}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#171717] px-3 text-sm font-bold text-white outline-none transition-colors focus:border-purple-400/60"
                placeholder="Ex.: 002"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold text-gray-300">Fonte</span>
              <input
                value={draft.sourceName}
                onChange={(event) => setDraft((current) => ({ ...current, sourceName: event.target.value }))}
                className="h-11 w-full rounded-lg border border-white/10 bg-[#171717] px-3 text-sm font-semibold text-white outline-none transition-colors focus:border-purple-400/60"
                placeholder="PDF, aula ou caderno"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-bold text-gray-300">Tipo</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-[#171717] p-1">
              <button
                type="button"
                onClick={() => selectKind('multiple_choice')}
                aria-pressed={draft.kind === 'multiple_choice'}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-xs font-black transition-colors ${
                  draft.kind === 'multiple_choice'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <ListChecks className="h-4 w-4" />
                Múltipla escolha
              </button>
              <button
                type="button"
                onClick={() => selectKind('true_false')}
                aria-pressed={draft.kind === 'true_false'}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-xs font-black transition-colors ${
                  draft.kind === 'true_false'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <ToggleLeft className="h-4 w-4" />
                Certo / Errado
              </button>
            </div>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-gray-300">Enunciado</span>
            <textarea
              autoFocus
              value={draft.statement}
              onChange={(event) => setDraft((current) => ({ ...current, statement: event.target.value }))}
              rows={6}
              className="min-h-36 w-full resize-y rounded-lg border border-white/10 bg-[#171717] p-3 text-sm font-semibold leading-relaxed text-white outline-none transition-colors focus:border-purple-400/60"
            />
          </label>

          <div className="space-y-2">
            <span className="text-xs font-bold text-gray-300">Alternativas</span>
            {draft.kind === 'multiple_choice' ? (
              <div className="space-y-2">
                {draft.alternatives.map((alternative) => (
                  <label key={alternative.label} className="flex items-center gap-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-xs font-black text-purple-300">
                      {alternative.label}
                    </span>
                    <input
                      value={alternative.text}
                      onChange={(event) => updateAlternative(alternative.label, event.target.value)}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#171717] px-3 text-sm font-semibold text-white outline-none transition-colors focus:border-purple-400/60"
                      placeholder={`Alternativa ${alternative.label}`}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'C', text: 'Certo' },
                  { label: 'E', text: 'Errado' },
                ].map((alternative) => (
                  <div key={alternative.label} className="flex h-11 items-center gap-3 rounded-lg border border-white/10 bg-[#171717] px-3">
                    <span className="font-black text-purple-300">{alternative.label}</span>
                    <span className="text-sm font-semibold text-gray-300">{alternative.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-gray-300">Gabarito</span>
            <select
              value={draft.correctAnswer}
              onChange={(event) => setDraft((current) => ({ ...current, correctAnswer: event.target.value }))}
              className="h-11 w-full rounded-lg border border-white/10 bg-[#171717] px-3 text-sm font-bold text-white outline-none transition-colors focus:border-purple-400/60"
            >
              <option value="">Sem gabarito</option>
              {answerOptions.map((answer) => (
                <option key={answer} value={answer}>{answer}</option>
              ))}
              <option value="ANULADA">ANULADA</option>
            </select>
          </label>

          {errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-200">
              {errors.join(' ')}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg px-4 text-sm font-bold text-gray-300 transition-colors hover:bg-white/5 hover:text-white"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex h-10 items-center gap-2 rounded-lg bg-purple-600 px-4 text-sm font-black text-white transition-colors hover:bg-purple-500"
          >
            {question ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </footer>
      </form>
    </div>
  );
};
