import { ActivityBlock, Question, StudyTask } from '../types';

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

export const isExecutableQuestion = (question: Question) =>
  Boolean(question.statement?.trim() && question.alternatives?.length);

const buildCardId = (block: ActivityBlock, question: Question) =>
  question.localId || `${block.id}:${question.number}`;

export const buildQuestionCardDeck = (task: StudyTask): QuestionCardDeckItem[] => {
  const flatCards = task.blocks.flatMap((block) => {
    if (block.isSection) return [];

    return block.questions
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
