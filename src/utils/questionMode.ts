import { ActivityBlock, Question } from '../types';

const CEBRASPE_BANKS = new Set(['CEBRASPE', 'CESPE']);

export const isCebraspeStyleBank = (bank?: string): boolean =>
  CEBRASPE_BANKS.has((bank || '').toUpperCase());

export const isQuestionMultipleChoice = (question: Question, block: Pick<ActivityBlock, 'bank'>): boolean => {
  if (typeof question.isMultipleChoice === 'boolean') {
    return question.isMultipleChoice;
  }

  return !isCebraspeStyleBank(block.bank);
};

export const getQuestionAlternatives = (question: Question, block: Pick<ActivityBlock, 'bank'>): string[] =>
  isQuestionMultipleChoice(question, block) ? ['A', 'B', 'C', 'D', 'E'] : ['C', 'E'];

export const getNextQuestionMode = (question: Question, block: Pick<ActivityBlock, 'bank'>): boolean =>
  !isQuestionMultipleChoice(question, block);
