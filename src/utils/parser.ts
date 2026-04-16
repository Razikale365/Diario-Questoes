import { ActivityBlock, Question } from '../types';

type ParsedInstruction = {
  questionNumbers: number[];
  pages: string;
  bank: string;
};

const cleanLessonLabel = (value: string): string =>
  value
    .replace(/\s*-\s*resolv(?:a|er).*$/i, '')
    .replace(/\s*-\s*execut(?:e|ar).*$/i, '')
    .replace(/\s*-\s*faça.*$/i, '')
    .trim();

const createQuestion = (number: number): Question => ({
  number,
  answer: '',
  isCorrect: null,
  hasDoubt: false
});

const normalizeBank = (value: string): string => {
  const matchedBank = value.toUpperCase();
  return matchedBank === 'CESPE' ? 'CEBRASPE' : matchedBank;
};

const parseInstructionBank = (line: string): string => {
  const bankMatch = line.match(/(?:Lista\s+)?(CEBRASPE|FCC|FGV|VUNESP|CESPE)/i);
  return bankMatch ? normalizeBank(bankMatch[1]) : '';
};

const parseInstructionNumbers = (line: string): number[] => {
  const questions: number[] = [];
  const rangeRegex = /questões?:?\s*(?:(?:CEBRASPE|FCC|FGV|VUNESP|CESPE)\s+)?(?:de\s+)?(\d+)\s+a\s+(\d+)/gi;
  let rangeMatch: RegExpExecArray | null;

  while ((rangeMatch = rangeRegex.exec(line)) !== null) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);

    for (let i = start; i <= end; i++) {
      questions.push(i);
    }
  }

  if (questions.length > 0) {
    return questions;
  }

  const listMatch = line.match(/questões?:?\s+(?:(?:CEBRASPE|FCC|FGV|VUNESP|CESPE)\s+)?([\d][\d\s,eE]+)(?:das\s+páginas|\(total|da\s+pág|páginas|$)/i);
  let numbersStr = '';

  if (listMatch) {
    numbersStr = listMatch[1];
  } else {
    const fallbackMatch = line.match(/questões?:?\s+(?:(?:CEBRASPE|FCC|FGV|VUNESP|CESPE)\s+)?([\d][\d\s,eE]+)/i);
    if (fallbackMatch) numbersStr = fallbackMatch[1];
  }

  if (!numbersStr) {
    return [];
  }

  return numbersStr
    .replace(/\bE\b/gi, ' ')
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n));
};

const parseInstructionPages = (line: string): string => {
  const pMatch = line.match(/(?:das\s+páginas|da\s+pág\.?|páginas)\s*([\d\s ae]+?)(?:\s*[-;,]|\s*\(|\)|\.|$)/i);
  return pMatch ? pMatch[1].trim() : '';
};

const extractQuestionInstructions = (lines: string[]): ParsedInstruction[] => {
  const instructions: ParsedInstruction[] = [];
  let collectingList = false;

  lines.forEach(line => {
    const normalizedLine = line.replace(/^[\-\u2022]\s*/, '').trim();

    if (/^(?:resolva|refaça)\s*:?\s*$/i.test(normalizedLine)) {
      collectingList = true;
      return;
    }

    const isQuestionInstruction = /(?:resolv(?:a|er)|refaça)\s+as\s+questões?/i.test(normalizedLine);
    const isListContinuation = collectingList && /questões?:?\s+\d+/i.test(normalizedLine);

    if (isQuestionInstruction || isListContinuation) {
      const normalizedInstruction = isQuestionInstruction
        ? normalizedLine
        : `Resolva as ${normalizedLine}`.replace(/\s+/g, ' ').trim();

      const questionNumbers = parseInstructionNumbers(normalizedInstruction);
      if (questionNumbers.length === 0) {
        return;
      }

      instructions.push({
        questionNumbers,
        pages: parseInstructionPages(normalizedInstruction),
        bank: parseInstructionBank(normalizedInstruction)
      });
      return;
    }

    if (collectingList) {
      collectingList = false;
    }
  });

  return instructions;
};

export const parseLSTask = (text: string): ActivityBlock[] => {
  const blocks: ActivityBlock[] = [];
  const globalLessonMatch = text.match(/(Aula\s+\d+[^.\n]*)/i);
  const globalLesson = globalLessonMatch ? cleanLessonLabel(globalLessonMatch[1]) : '';

  let parts = text.split(/(?=Atividade\s+\d+)/i).filter(p => p.trim().length > 0);
  if (!/Atividade\s+\d+/i.test(text)) {
    parts = [text];
  }

  parts.forEach((part, partIndex) => {
    const lines = part.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    const activityLine = lines.find(line => /^Atividade\b/i.test(line));
    let title = (activityLine || lines[0]).replace(/:$/, '');
    if (!/Atividade/i.test(title)) {
      title = `Bloco ${partIndex + 1}`;
    }

    const questionInstructions = extractQuestionInstructions(lines);

    if (questionInstructions.length > 0) {
      const bankMatch = part.match(/(?:Lista\s+)?(CEBRASPE|FCC|FGV|VUNESP|CESPE)/i);
      const bank = bankMatch ? normalizeBank(bankMatch[1]) : '';

      const lessonMatch = part.match(/(Aula\s+\d+[^.\n]*)/i);
      const lesson = lessonMatch
        ? cleanLessonLabel(lessonMatch[1])
        : (lines.length > 1 && !/resolv/i.test(lines[1]) ? cleanLessonLabel(lines[1]) : globalLesson);

      questionInstructions.forEach((instruction, index) => {
        const questions = Array.from(new Set(instruction.questionNumbers))
          .sort((a, b) => a - b)
          .map(createQuestion);

        if (questions.length === 0) {
          return;
        }

        let blockTitle = title;
        if (questionInstructions.length > 1 || !/Atividade/i.test(title)) {
          blockTitle = `${title} - Bloco ${index + 1}`;
          if (instruction.bank || bank) blockTitle += ` (${instruction.bank || bank})`;
        }

        blocks.push({
          id: crypto.randomUUID(),
          title: blockTitle,
          lesson,
          pages: instruction.pages,
          bank: instruction.bank || bank,
          questions
        });
      });
    }
  });

  const finalBlocks: ActivityBlock[] = [];
  const lessonsSeen = new Set<string>();

  blocks.forEach(block => {
    const lessonKey = block.lesson.trim();
    if (lessonKey && !lessonsSeen.has(lessonKey)) {
      finalBlocks.push({
        id: crypto.randomUUID(),
        title: lessonKey,
        lesson: lessonKey,
        pages: '',
        questions: [],
        isSection: true,
        layout: { columns: 12, rows: 1, type: 'columns', width: 12 }
      });
      lessonsSeen.add(lessonKey);
    }
    finalBlocks.push(block);
  });

  return finalBlocks;
};

export const formatQuestionList = (numbers: number[]): string => {
  if (numbers.length === 0) return '';
  if (numbers.length === 1) return numbers[0].toString();

  const sorted = [...numbers].sort((a, b) => a - b);
  const last = sorted.pop();
  return `${sorted.join(' ')} e ${last}`;
};

export const parseQuestionsText = (text: string): number[] => {
  const numbers = new Set<number>();
  const parts = text.split(/[,;e\s]+/);
  parts.forEach(part => {
    if (part.includes('-') || part.includes('a')) {
      const [start, end] = part.split(/[-a]/).map(n => parseInt(n.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) numbers.add(i);
      }
    } else {
      const n = parseInt(part.trim(), 10);
      if (!isNaN(n)) numbers.add(n);
    }
  });
  return Array.from(numbers).sort((a, b) => a - b);
};
