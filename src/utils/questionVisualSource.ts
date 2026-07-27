import type { QuestionSourcePage } from '../types';
import type { ImportedObjectiveQuestion } from './objectiveQuestionParser';

const VISUAL_TERMS = [
  'balanco',
  'curva',
  'demonstracao',
  'demonstrativo',
  'dre',
  'esquema',
  'figura',
  'fluxograma',
  'grafico',
  'imagem',
  'mapa',
  'quadro',
  'tabela',
];

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const isLikelyVisualQuestion = (
  question: Pick<ImportedObjectiveQuestion, 'statement'>,
) => {
  const statement = normalize(question.statement);
  return VISUAL_TERMS.some((term) => new RegExp(`\\b${term}\\b`, 'u').test(statement));
};

export type ImportedQuestionWithSourcePage = ImportedObjectiveQuestion & {
  sourcePage?: QuestionSourcePage;
};

export const attachQuestionSourcePages = (
  questions: ImportedObjectiveQuestion[],
  documentId: string,
): ImportedQuestionWithSourcePage[] =>
  questions.map<ImportedQuestionWithSourcePage>((question) => {
    if (!question.sourcePageNumber) return { ...question };

    return {
      ...question,
      sourcePage: {
        documentId,
        pageNumber: question.sourcePageNumber,
        likelyVisual: isLikelyVisualQuestion(question),
      },
    };
  });
