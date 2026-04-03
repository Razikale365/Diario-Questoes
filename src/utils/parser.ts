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

    const questionLines = lines.filter(l => /resolv(?:a|er) as questões|refaça as questões/i.test(l));
    
    if (questionLines.length > 0) {
      questionLines.forEach((qLine, index) => {
        const questions: Question[] = [];
        let pages = '';
        let bank = '';
        let lesson = '';

        // Support both range ("questões 01 a 20") and explicit list ("questões: 1, 4, 5 E 6")
        // The optional colon after "questões" covers the LS Aula 14 format
        const rangeMatch = qLine.match(/questões:?\s+(?:de\s+)?(\d+)\s+a\s+(\d+)/i);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          for (let i = start; i <= end; i++) {
            questions.push({ number: i, answer: '', isCorrect: null, hasDoubt: false });
          }
        } else {
          // Match explicit list: may have colon, numbers separated by commas, spaces, "e" / "E"
          const listMatch = qLine.match(/questões:?\s+([\d][\d\s,eE]+)(?:das\s+páginas|\(total|da\s+pág)/i);
          let numbersStr = '';
          if (listMatch) {
            numbersStr = listMatch[1];
          } else {
            // Fallback: grab everything that looks like a number list after "questões"
            const fallbackMatch = qLine.match(/questões:?\s+([\d][\d\s,eE]+)/i);
            if (fallbackMatch) numbersStr = fallbackMatch[1];
          }
          
          if (numbersStr) {
            const numbers = numbersStr
              .replace(/\bE\b/gi, ' ')  // replace standalone "E" / "e" used as "and"
              .replace(/,/g, ' ')
              .split(/\s+/)
              .map(n => parseInt(n, 10))
              .filter(n => !isNaN(n));
            
            Array.from(new Set(numbers)).sort((a,b)=>a-b).forEach(n => {
              questions.push({ number: n, answer: '', isCorrect: null, hasDoubt: false });
            });
          }
        }

        const pMatch = qLine.match(/(?:das\s+páginas|da\s+pág\.?|páginas)\s*([\d\s a]+)(?:\.|\(|)/i);
        if (pMatch) {
          pages = pMatch[1].trim();
        }

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
          if (lines.length > 1 && !/resolv/i.test(lines[1])) {
            lesson = lines[1];
          }
        }

        if (questions.length > 0) {
          let blockTitle = title;
          if (questionLines.length > 1 || !/Atividade/i.test(title)) {
            blockTitle = `${title} - Bloco ${index + 1}`;
            if (bank) blockTitle += ` (${bank})`;
          }

          blocks.push({ 
            id: crypto.randomUUID(), 
            title: blockTitle, 
            lesson, 
            pages, 
            bank,
            questions 
          });
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
