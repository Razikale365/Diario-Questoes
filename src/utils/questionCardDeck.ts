import { ActivityBlock, Question, QuestionAlternative, StudyTask } from '../types';

export interface QuestionCardDeckItem {
  id: string;
  blockId: string;
  blockTitle: string;
  blockLesson: string;
  blockBank?: string;
  blockIsLocked: boolean;
  question: Question;
  index: number;
  total: number;
  displayNumber: number;
  isAnswered: boolean;
  isCorrect: boolean;
  isWrong: boolean;
  hasDoubt: boolean;
  favorite: boolean;
}

export interface QuestionCardDeckSummary {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  doubts: number;
  favorites: number;
  accuracy: number;
}

export type QuestionCardNavigationShortcut = 'previous' | 'next';

export interface QuestionCardShortcutContext {
  readonly hasModifier?: boolean;
  readonly isEnterOnInteractiveControl?: boolean;
  readonly isEditable?: boolean;
  readonly isDialogOpen?: boolean;
  readonly isDefaultPrevented?: boolean;
}

export const shouldHandleQuestionCardShortcut = ({
  hasModifier = false,
  isEnterOnInteractiveControl = false,
  isEditable = false,
  isDialogOpen = false,
  isDefaultPrevented = false,
}: QuestionCardShortcutContext) => !hasModifier && !isEnterOnInteractiveControl && !isEditable && !isDialogOpen && !isDefaultPrevented;

export const getQuestionCardNavigationShortcut = (
  key: string,
  hasModifier = false,
): QuestionCardNavigationShortcut | null => {
  if (hasModifier) return null;
  if (key === 'ArrowLeft') return 'previous';
  if (key === 'ArrowRight') return 'next';
  return null;
};

const clampQuestionCardIndex = (index: number, total: number) => {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
};

export const findNextUnansweredQuestionCardIndex = (
  cards: readonly Pick<QuestionCardDeckItem, 'isAnswered'>[],
  currentIndex: number,
) => {
  const safeIndex = clampQuestionCardIndex(currentIndex, cards.length);
  for (let offset = 1; offset <= cards.length; offset += 1) {
    const index = (safeIndex + offset) % cards.length;
    if (!cards[index]?.isAnswered) return index;
  }
  return safeIndex;
};

export const findRandomUnansweredQuestionCardIndex = (
  cards: readonly Pick<QuestionCardDeckItem, 'isAnswered'>[],
  currentIndex: number,
  random: () => number = Math.random,
) => {
  const unansweredIndices = cards.flatMap((card, index) => (card.isAnswered ? [] : [index]));
  if (unansweredIndices.length === 0) return clampQuestionCardIndex(currentIndex, cards.length);
  const randomIndex = Math.min(Math.floor(random() * unansweredIndices.length), unansweredIndices.length - 1);
  return unansweredIndices[randomIndex] ?? clampQuestionCardIndex(currentIndex, cards.length);
};

export const findAdjacentQuestionCardBlockIndex = (
  cards: readonly Pick<QuestionCardDeckItem, 'blockId'>[],
  currentIndex: number,
  direction: 'previous' | 'next',
) => {
  const safeIndex = clampQuestionCardIndex(currentIndex, cards.length);
  const currentBlockId = cards[safeIndex]?.blockId;
  const step = direction === 'next' ? 1 : -1;

  for (let index = safeIndex + step; index >= 0 && index < cards.length; index += step) {
    if (cards[index]?.blockId !== currentBlockId) return index;
  }
  return safeIndex;
};

export const getQuestionCardAlternativeShortcut = (
  key: string,
  alternatives: readonly QuestionAlternative[],
) => {
  const numericPosition = Number.parseInt(key, 10);
  if (Number.isInteger(numericPosition) && numericPosition >= 1 && numericPosition <= alternatives.length) {
    return alternatives[numericPosition - 1]?.label ?? null;
  }

  const normalizedKey = key.trim().toUpperCase();
  return alternatives.find((alternative) => alternative.label.toUpperCase() === normalizedKey)?.label ?? null;
};

export const isExecutableQuestion = (question: Question) =>
  Boolean(question.statement?.trim() && question.alternatives?.length);

const buildCardId = (block: ActivityBlock, question: Question) =>
  question.localId || `${block.id}:${question.number}`;

export const sortQuestionsByDisplayNumber = <T extends Pick<Question, 'number' | 'sourceQuestionNumber'>>(questions: readonly T[]): T[] =>
  [...questions].sort((left, right) => {
    const leftNumber = left.sourceQuestionNumber ?? left.number;
    const rightNumber = right.sourceQuestionNumber ?? right.number;
    return leftNumber - rightNumber || left.number - right.number;
  });

export const buildQuestionCardDeck = (task: StudyTask): QuestionCardDeckItem[] => {
  const flatCards = task.blocks.flatMap((block) => {
    if (block.isSection) return [];

    return sortQuestionsByDisplayNumber(block.questions)
      .filter(isExecutableQuestion)
      .map((question) => ({
        id: buildCardId(block, question),
        blockId: block.id,
        blockTitle: block.title,
        blockLesson: block.lesson,
        blockBank: block.bank || task.bank,
        blockIsLocked: Boolean(block.isLocked),
        question,
        displayNumber: question.sourceQuestionNumber ?? question.number,
      }));
  });

  return flatCards.map((card, index) => ({
    ...card,
    index,
    total: flatCards.length,
    isAnswered: Boolean(card.question.answer),
    isCorrect: card.question.isCorrect === true,
    isWrong: card.question.isCorrect === false,
    hasDoubt: Boolean(card.question.hasDoubt),
    favorite: Boolean(card.question.favorite),
  }));
};

export const findFirstUnansweredCardIndex = (cards: Pick<QuestionCardDeckItem, 'isAnswered'>[]) => {
  const firstUnanswered = cards.findIndex((card) => !card.isAnswered);
  return firstUnanswered >= 0 ? firstUnanswered : 0;
};

export const findQuestionCardIndexByDisplayNumber = (
  cards: readonly Pick<QuestionCardDeckItem, 'displayNumber'>[],
  displayNumber: number,
) => cards.findIndex((card) => card.displayNumber === displayNumber);

export const summarizeQuestionCardDeck = (cards: QuestionCardDeckItem[]): QuestionCardDeckSummary => {
  const answered = cards.filter((card) => card.isAnswered).length;
  const correct = cards.filter((card) => card.isCorrect).length;
  const wrong = cards.filter((card) => card.isWrong).length;

  return {
    total: cards.length,
    answered,
    correct,
    wrong,
    doubts: cards.filter((card) => card.hasDoubt).length,
    favorites: cards.filter((card) => card.favorite).length,
    accuracy: answered > 0 ? Number(((correct / answered) * 100).toFixed(1)) : 0,
  };
};
