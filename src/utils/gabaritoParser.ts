import type { Question } from '../types';

export interface GabaritoParseResult {
  answers: Map<number, string>;
  errors: string[];
}

const answerAliases: Record<string, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  CERTO: 'C',
  CERTA: 'C',
  ERRADO: 'E',
  ERRADA: 'E',
  ANULADA: 'ANULADA',
};

const normalizeCopiedText = (text: string) => text.replace(/[\u0412\u0432]/g, 'B');

const extractAnswers = (text: string) => (
  normalizeCopiedText(text)
    .match(/\b(?:A|B|C|D|E|CERTO|CERTA|ERRADO|ERRADA|ANULADA)\b/giu)
    ?.map((answer) => answerAliases[answer.toUpperCase()])
    .filter((answer): answer is string => Boolean(answer))
  || []
);

const isQuestionNumberLine = (text: string) => /^\d+(?:\s+\d+)*$/.test(text);

export const getGabaritoQuestionNumber = (question: Pick<Question, 'number' | 'sourceQuestionNumber'>) => (
  question.sourceQuestionNumber ?? question.number
);

export const parseGabarito = (text: string): GabaritoParseResult => {
  const answers = new Map<number, string>();
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const consumedLineIndexes = new Set<number>();

  const addAnswer = (questionNumber: number, answer: string) => {
    if (answers.has(questionNumber)) {
      errors.push(`A questão ${questionNumber} está repetida no gabarito.`);
      return;
    }
    answers.set(questionNumber, answer);
  };

  for (let index = 0; index < lines.length - 1; index += 1) {
    const questionLine = lines[index];
    if (!isQuestionNumberLine(questionLine)) continue;

    const questionNumbers = questionLine.split(/\s+/).map(Number);
    const lineAnswers = extractAnswers(lines[index + 1]);
    if (lineAnswers.length === 0) continue;

    consumedLineIndexes.add(index);
    consumedLineIndexes.add(index + 1);
    if (questionNumbers.length !== lineAnswers.length) {
      errors.push(`O bloco iniciado na questão ${questionNumbers[0]} tem ${questionNumbers.length} questões e ${lineAnswers.length} respostas. Corrija esse trecho antes de importar.`);
      index += 1;
      continue;
    }

    questionNumbers.forEach((questionNumber, answerIndex) => {
      addAnswer(questionNumber, lineAnswers[answerIndex]);
    });
    index += 1;
  }

  lines.forEach((line, index) => {
    if (consumedLineIndexes.has(index)) return;

    const pairPattern = /(\d+)\s*(?:[-.):]?\s*)(?:LETRA|ALTERNATIVA)?\s*(A|B|C|D|E|CERTO|CERTA|ERRADO|ERRADA|ANULADA)\b/giu;
    for (const match of normalizeCopiedText(line).matchAll(pairPattern)) {
      const answer = answerAliases[match[2].toUpperCase()];
      if (answer) addAnswer(Number(match[1]), answer);
    }
  });

  if (answers.size === 0 && errors.length === 0) {
    errors.push('Nenhuma questão com resposta válida foi encontrada.');
  }

  return { answers, errors };
};
