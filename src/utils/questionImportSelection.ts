import type { ImportedObjectiveQuestion } from './objectiveQuestionParser';

export const createQuestionImportSelection = (questions: ImportedObjectiveQuestion[]) =>
  new Set(questions.map((question) => question.number));

export const filterQuestionsByImportSelection = (
  questions: ImportedObjectiveQuestion[],
  selectedNumbers: ReadonlySet<number>,
) => questions.filter((question) => selectedNumbers.has(question.number));

export const toggleQuestionImportSelection = (
  selectedNumbers: ReadonlySet<number>,
  questionNumber: number,
) => {
  const next = new Set(selectedNumbers);
  if (next.has(questionNumber)) {
    next.delete(questionNumber);
  } else {
    next.add(questionNumber);
  }
  return next;
};
