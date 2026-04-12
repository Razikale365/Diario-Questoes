import { ActivityBlock, Question } from '../types';

export const parseLSTask = (text: string): ActivityBlock[] => {
  const blocks: ActivityBlock[] = [];
  
  let parts = text.split(/(?=Atividade\s+\d+)/i).filter(p => p.trim().length > 0);
  if (!/Atividade\s+\d+/i.test(text)) {
    parts = [text];
  }

  parts.forEach((part, partIndex) => {
    const lines = part.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    let title = lines[0].replace(/:$/, '');
    if (!/Atividade/i.test(title)) {
      title = `Bloco ${partIndex + 1}`;
    }

    const questionLineIndices = lines
      .map((l, i) => ({ line: l, index: i }))
      .filter(({ line }) => /resolv(?:a|er) as questões|refaça as questões/i.test(line));

    if (questionLineIndices.length > 0) {
      questionLineIndices.forEach(({ line: qLine, index: qLineIdx }, blockIndex) => {
        let pages = '';
        let bank = '';
        let lesson = '';

        const bankMatch = qLine.match(/(?:Lista\s+)?(CEBRASPE|FCC|FGV|VUNESP|CESPE)/i);
        if (bankMatch) {
          let matchedBank = bankMatch[1].toUpperCase();
          if (matchedBank === 'CESPE') matchedBank = 'CEBRASPE';
          bank = matchedBank;
        }

        const lessonMatch = qLine.match(/(Aula\s+\d+[^.]*)/i);
        if (lessonMatch) {
          lesson = lessonMatch[1].trim();
        } else {
          for (let i = 1; i < lines.length; i++) {
            if (!/resolv/i.test(lines[i])) {
              lesson = lines[i];
              break;
            }
          }
        }

        const bankRegexStr = '(?:(?:(?:da|das|de|do)\\s+)?(?:CEBRASPE|FCC|FGV|VUNESP|CESPE|Lista\\s+(?:CEBRASPE|FCC|FGV|VUNESP|CESPE))\\s+)?';
        const inlineRange = qLine.match(new RegExp(`questões:?\\s+${bankRegexStr}(?:de\\s+)?(\\d+)\\s+a\\s+(\\d+)`, 'i'));
        const inlineList = qLine.match(new RegExp(`questões:?\\s+${bankRegexStr}(?:de\\s+)?([\\d][\\d\\s,eE]+)`, 'i'));

        if (inlineRange) {
          const questions: Question[] = [];
          const start = parseInt(inlineRange[1], 10);
          const end = parseInt(inlineRange[2], 10);
          for (let i = start; i <= end; i++) {
            questions.push({ number: i, answer: '', isCorrect: null, hasDoubt: false });
          }

          const pMatch = qLine.match(/(?:das\s+páginas|da\s+pág\.?|páginas|pág\.?)\s*([\d\s aAeE,]+)(?:\.|\(|)/i);
          if (pMatch) {
            pages = pMatch[1].trim();
          }

          let blockTitle = title;
          if (questionLineIndices.length > 1 || !/Atividade/i.test(title)) {
            blockTitle = `${title} - Bloco ${blockIndex + 1}`;
            if (bank) blockTitle += ` (${bank})`;
          }

          blocks.push({
            id: crypto.randomUUID(),
            title: blockTitle,
            lesson,
            pages,
            bank,
            questions,
            layout: { columns: 4, rows: 5, type: 'columns', width: 12 }
          });
        } else if (inlineList) {
          const questions: Question[] = [];
          const numbers = inlineList[1]
            .replace(/\bE\b/gi, ' ')
            .replace(/,/g, ' ')
            .split(/\s+/)
            .map(n => parseInt(n, 10))
            .filter(n => !isNaN(n));

          Array.from(new Set(numbers)).sort((a,b)=>a-b).forEach(n => {
            questions.push({ number: n, answer: '', isCorrect: null, hasDoubt: false });
          });

          const pMatch = qLine.match(/(?:das\s+páginas|da\s+pág\.?|páginas|pág\.?)\s*([\d\s aAeE,]+)(?:\.|\(|)/i);
          if (pMatch) {
            pages = pMatch[1].trim();
          }

          let blockTitle = title;
          if (questionLineIndices.length > 1 || !/Atividade/i.test(title)) {
            blockTitle = `${title} - Bloco ${blockIndex + 1}`;
            if (bank) blockTitle += ` (${bank})`;
          }

          blocks.push({
            id: crypto.randomUUID(),
            title: blockTitle,
            lesson,
            pages,
            bank,
            questions,
            layout: { columns: 4, rows: 5, type: 'columns', width: 12 }
          });
        } else {
          const subsequentLines = lines.slice(qLineIdx + 1);
          const rangeLines = subsequentLines.filter(l => /^\s*[-•]\s*\d+\s+a\s+\d+/.test(l) || /^\s*\d+\s+a\s+\d+/.test(l));

          if (rangeLines.length > 0) {
            rangeLines.forEach((rLine, rIndex) => {
              const questions: Question[] = [];
              let blockPages = '';
              let blockBank = bank;

              const rMatch = rLine.match(/(\d+)\s+a\s+(\d+)/);
              if (rMatch) {
                const start = parseInt(rMatch[1], 10);
                const end = parseInt(rMatch[2], 10);
                for (let i = start; i <= end; i++) {
                  questions.push({ number: i, answer: '', isCorrect: null, hasDoubt: false });
                }
              }

              const pMatch = rLine.match(/(?:das\s+páginas|da\s+pág\.?|páginas|pág\.?)\s*([\d\s aAeE,]+)(?:\.|\(|)/i);
              if (pMatch) {
                blockPages = pMatch[1].trim();
              }

              const rBankMatch = rLine.match(/(?:Lista\s+)?(CEBRASPE|FCC|FGV|VUNESP|CESPE)/i);
              if (rBankMatch) {
                let matchedBank = rBankMatch[1].toUpperCase();
                if (matchedBank === 'CESPE') matchedBank = 'CEBRASPE';
                blockBank = matchedBank;
              }

              if (questions.length > 0) {
                let blockTitle = title;
                if (rangeLines.length > 1) {
                  blockTitle = `${title} - Bloco ${rIndex + 1}`;
                  if (blockBank) blockTitle += ` (${blockBank})`;
                }

                blocks.push({
                  id: crypto.randomUUID(),
                  title: blockTitle,
                  lesson,
                  pages: blockPages,
                  bank: blockBank,
                  questions,
                  layout: { columns: 4, rows: 5, type: 'columns', width: 12 }
                });
              }
            });
          }
        }
      });
    }
  });

  // After collecting all blocks, insert Section Headers for each unique lesson
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
