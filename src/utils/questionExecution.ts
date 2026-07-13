import { ActivityBlock, Question, QuestionAlternative } from '../types';

export type QuestionEditorKind = 'multiple_choice' | 'true_false';

export interface QuestionDraft {
  kind: QuestionEditorKind;
  sourceQuestionNumber: string;
  statement: string;
  alternatives: QuestionAlternative[];
  correctAnswer: string;
  sourceName: string;
}

export interface QuestionRevealDecision {
  revealedIds: Set<string>;
  updates: Partial<Question> | null;
}

export interface QuestionRevealTarget {
  id: string;
  question: Question;
}

export interface QuestionBlockRevealDecision {
  revealedIds: Set<string>;
  updates: Array<{ id: string; updates: Partial<Question> }>;
}

export type SaveQuestionDraftResult =
  | { ok: true; block: ActivityBlock; question: Question }
  | { ok: false; errors: string[] };

const normalizeAnswer = (value: string | undefined) => {
  const normalized = value?.trim().toUpperCase() || '';
  if (normalized === 'CERTO') return 'C';
  if (normalized === 'ERRADO') return 'E';
  if (normalized === 'ANULADO') return 'ANULADA';
  return normalized;
};

export const isQuestionAnswerRevealed = (revealedIds: ReadonlySet<string>, id: string) =>
  revealedIds.has(id);

export const getQuestionRevealUpdate = (question: Question): Partial<Question> | null => {
  const answer = normalizeAnswer(question.answer);
  const correctAnswer = normalizeAnswer(question.correctAnswer);

  if (!answer || !correctAnswer || correctAnswer === 'ANULADA') return null;
  return { isCorrect: answer === correctAnswer };
};

export const shouldShowQuestionCorrectness = (question: Question, isRevealed: boolean) =>
  isRevealed && normalizeAnswer(question.correctAnswer) !== 'ANULADA';

export const toggleQuestionAnswerReveal = (
  revealedIds: ReadonlySet<string>,
  id: string,
  question: Question,
): QuestionRevealDecision => {
  const next = new Set(revealedIds);
  if (next.has(id)) {
    next.delete(id);
    return { revealedIds: next, updates: null };
  }

  next.add(id);
  return { revealedIds: next, updates: getQuestionRevealUpdate(question) };
};

export const toggleAllQuestionAnswers = (
  revealedIds: ReadonlySet<string>,
  targets: QuestionRevealTarget[],
): QuestionBlockRevealDecision => {
  const keyedTargets = targets.filter(({ question }) => Boolean(normalizeAnswer(question.correctAnswer)));
  const shouldHide = keyedTargets.length > 0 && keyedTargets.every(({ id }) => revealedIds.has(id));
  const next = new Set(revealedIds);

  if (shouldHide) {
    keyedTargets.forEach(({ id }) => next.delete(id));
    return { revealedIds: next, updates: [] };
  }

  const updates: QuestionBlockRevealDecision['updates'] = [];
  keyedTargets.forEach(({ id, question }) => {
    next.add(id);
    const questionUpdates = getQuestionRevealUpdate(question);
    if (questionUpdates) updates.push({ id, updates: questionUpdates });
  });
  return { revealedIds: next, updates };
};

export const buildAnswerSelectionUpdate = (
  question: Pick<Question, 'answer'>,
  alternative: string,
): Pick<Question, 'answer' | 'isCorrect'> => ({
  answer: question.answer === alternative ? '' : alternative,
  isCorrect: null,
});

export const applyQuestionUpdate = (question: Question, updates: Partial<Question>): Question => {
  const updated = { ...question, ...updates };

  if ('answer' in updates) {
    if (!('isCorrect' in updates)) updated.isCorrect = null;
    return updated;
  }

  if ('correctAnswer' in updates) {
    const answer = normalizeAnswer(updated.answer);
    const correctAnswer = normalizeAnswer(updated.correctAnswer);
    if (!correctAnswer || !answer) {
      updated.isCorrect = null;
    } else if (correctAnswer === 'ANULADA') {
      updated.isCorrect = true;
    } else {
      updated.isCorrect = answer === correctAnswer;
    }
  }

  return updated;
};

const sanitizeMultipleChoiceAlternatives = (alternatives: QuestionAlternative[]) => {
  const seen = new Set<string>();
  return alternatives.flatMap((alternative) => {
    const label = normalizeAnswer(alternative.label);
    const text = alternative.text.trim();
    if (!label || !text || seen.has(label)) return [];
    seen.add(label);
    return [{ label, text }];
  });
};

const parseSourceQuestionNumber = (value: string) => {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : undefined;
};

export const saveQuestionDraft = (
  block: ActivityBlock,
  draft: QuestionDraft,
  options: { editingQuestionNumber?: number; idFactory?: () => string } = {},
): SaveQuestionDraftResult => {
  const statement = draft.statement.trim();
  const alternatives = draft.kind === 'true_false'
    ? [
        { label: 'C', text: 'Certo' },
        { label: 'E', text: 'Errado' },
      ]
    : sanitizeMultipleChoiceAlternatives(draft.alternatives);
  const errors: string[] = [];

  if (!statement) errors.push('Informe o enunciado.');
  if (draft.kind === 'multiple_choice' && alternatives.length < 2) {
    errors.push('Informe pelo menos duas alternativas.');
  }

  const correctAnswer = normalizeAnswer(draft.correctAnswer);
  const validAnswers = new Set(alternatives.map((alternative) => alternative.label));
  if (correctAnswer && correctAnswer !== 'ANULADA' && !validAnswers.has(correctAnswer)) {
    errors.push('O gabarito precisa corresponder a uma alternativa.');
  }
  if (errors.length > 0) return { ok: false, errors };

  const existing = options.editingQuestionNumber === undefined
    ? undefined
    : block.questions.find((question) => question.number === options.editingQuestionNumber);
  const nextNumber = block.questions.reduce((maximum, question) => Math.max(maximum, question.number), 0) + 1;
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());
  const answerKeyChanged = Boolean(existing) && normalizeAnswer(existing?.correctAnswer) !== correctAnswer;
  const question: Question = {
    ...existing,
    number: existing?.number ?? nextNumber,
    sourceQuestionNumber: parseSourceQuestionNumber(draft.sourceQuestionNumber),
    localId: existing?.localId || idFactory(),
    statement,
    alternatives,
    correctAnswer: correctAnswer || undefined,
    isMultipleChoice: draft.kind === 'multiple_choice',
    sourceKind: existing?.sourceKind || 'other',
    sourceName: draft.sourceName.trim() || existing?.sourceName || 'Inclusao manual',
    answer: existing?.answer || '',
    isCorrect: answerKeyChanged ? null : existing?.isCorrect ?? null,
    hasDoubt: existing?.hasDoubt || false,
  };

  const questions = existing
    ? block.questions.map((current) => (current.number === existing.number ? question : current))
    : [...block.questions, question];

  return { ok: true, block: { ...block, questions }, question };
};
