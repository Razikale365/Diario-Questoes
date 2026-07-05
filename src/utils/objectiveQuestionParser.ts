export interface ImportedAlternative {
  label: string;
  text: string;
}

export interface ImportedObjectiveQuestion {
  localId: string;
  number: number;
  statement: string;
  alternatives: ImportedAlternative[];
  answerKey?: string;
  bank?: string;
  year?: number;
}

export interface ParseObjectiveQuestionsResult {
  questions: ImportedObjectiveQuestion[];
  rejectedBlocks: number;
}

export interface ParseObjectiveQuestionsOptions {
  requireExplicitQuestionLabel?: boolean;
}

const QUESTION_START_RE = /(^|\n)\s*(?:(?:quest(?:ão|ao)|q)\s*)?(\d{1,4})\s*(?:[.)\-–:]|\b)/giu;
const EXPLICIT_QUESTION_START_RE = /(^|\n)\s*(?:(?:quest(?:ão|ao)|q)\s*)(\d{1,4})\s*(?:[.)\-–:]|\b)/giu;
const COMMENT_TAIL_RE = /(^|\n)\s*(?:coment[aá]rios?|gabarito\s+comentado|resolu[cç][aã]o|solu[cç][aã]o|explica[cç][aã]o)\b/iu;
const ANSWER_LINE_RE = /(^|\n)\s*(?:gabarito|respostas?|alternativa\s+correta)\b/iu;

const normalizeText = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const collapseInlineWhitespace = (text: string) =>
  text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();

const normalizeAnswer = (answer: string | undefined) => {
  if (!answer) return undefined;
  const upper = answer.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  if (upper === 'CERTO') return 'C';
  if (upper === 'ERRADO') return 'E';
  if (upper === 'ANULADA') return 'ANULADA';
  if (/^[A-E]$/.test(upper)) return upper;
  return undefined;
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const extractBank = (text: string) => {
  const match = text.match(/\b(CEBRASPE|CESPE|FCC|FGV|VUNESP|ESAF|QUADRIX|IBFC)\b/i);
  if (!match) return undefined;
  const bank = match[1].toUpperCase();
  return bank === 'CESPE' ? 'CEBRASPE' : bank;
};

const extractYear = (text: string) => {
  const match = text.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
};

const extractInlineAnswer = (text: string) => {
  const direct = text.match(/\b(?:gabarito|resposta|alternativa\s+correta)\s*[:\-–]?\s*(A|B|C|D|E|CERTO|ERRADO|ANULADA)\b/iu);
  if (direct) return normalizeAnswer(direct[1]);

  const verbose = text.match(/\b(?:gabarito|resposta|alternativa\s+correta)\b.{0,40}\b(?:letra|op[cç][aã]o)?\s*(A|B|C|D|E)\b/iu);
  return normalizeAnswer(verbose?.[1]);
};

const extractGlobalAnswerKey = (text: string) => {
  const answers = new Map<number, string>();
  const sectionRe = /(^|\n)\s*(?:gabarito|respostas?|chave\s+de\s+respostas?)\b[:\s-]*([\s\S]{0,6000})/giu;

  for (const match of text.matchAll(sectionRe)) {
    const chunk = match[2] ?? '';
    const pairRe = /\b(?:quest(?:ão|ao)\s*)?(\d{1,4})\s*(?:[-–:.)]|\s)\s*(A|B|C|D|E|CERTO|ERRADO|ANULADA)\b/giu;
    for (const pair of chunk.matchAll(pairRe)) {
      const answer = normalizeAnswer(pair[2]);
      if (answer) answers.set(Number(pair[1]), answer);
    }
  }

  return answers;
};

const stripTail = (block: string) => {
  const commentMatch = COMMENT_TAIL_RE.exec(block);
  const withoutComment = commentMatch?.index !== undefined ? block.slice(0, commentMatch.index) : block;
  const answerMatch = ANSWER_LINE_RE.exec(withoutComment);
  return answerMatch?.index !== undefined ? withoutComment.slice(0, answerMatch.index) : withoutComment;
};

const removeQuestionHeader = (block: string, number: number) => {
  const headerRe = new RegExp(`^\\s*(?:(?:quest(?:ão|ao)|q)\\s*)?${number}\\s*(?:[.)\\-–:]|\\b)\\s*`, 'iu');
  return block.replace(headerRe, '').trim();
};

const isValidAlternativeSet = (alternatives: ImportedAlternative[]) => {
  const labels = alternatives.map((alternative) => alternative.label);
  const uniqueLabels = new Set(labels);
  if (uniqueLabels.size !== labels.length) return false;
  if (alternatives.some((alternative) => !alternative.text)) return false;

  const hasMultipleChoiceCore = ['A', 'B', 'C', 'D'].every((label) => uniqueLabels.has(label));
  const isTrueFalsePair = alternatives.length === 2 && uniqueLabels.has('C') && uniqueLabels.has('E');
  return hasMultipleChoiceCore || isTrueFalsePair;
};

const parseAlternativesByLines = (body: string) => {
  const statementLines: string[] = [];
  const alternatives: ImportedAlternative[] = [];
  let currentAlternative: ImportedAlternative | null = null;

  for (const line of body.split('\n')) {
    const match = line.match(/^\s*(?:\(?([A-Ea-e])\)?\s*[.)\-–:]|([A-Ea-e])\s{2,})(?:\s+)?(.*)$/u);
    if (match) {
      currentAlternative = {
        label: (match[1] || match[2]).toUpperCase(),
        text: collapseInlineWhitespace(match[3] || ''),
      };
      alternatives.push(currentAlternative);
      continue;
    }

    if (currentAlternative) {
      currentAlternative.text = collapseInlineWhitespace(`${currentAlternative.text} ${line}`);
    } else {
      statementLines.push(line);
    }
  }

  return {
    statement: collapseInlineWhitespace(statementLines.join('\n')),
    alternatives,
  };
};

const parseAlternativesInline = (body: string) => {
  const markerRe = /(^|\s)\(?([A-Ea-e])\)?\s*[.)\-–:]\s+/gu;
  const markers = Array.from(body.matchAll(markerRe)).map((match) => {
    const prefix = match[1] ?? '';
    const markerStart = (match.index ?? 0) + prefix.length;
    return {
      label: match[2].toUpperCase(),
      markerStart,
      textStart: markerStart + match[0].length - prefix.length,
    };
  });

  if (markers.length < 2) {
    return { statement: '', alternatives: [] };
  }

  const statement = collapseInlineWhitespace(body.slice(0, markers[0].markerStart));
  const alternatives = markers.map((marker, index) => {
    const next = markers[index + 1];
    return {
      label: marker.label,
      text: collapseInlineWhitespace(body.slice(marker.textStart, next?.markerStart)),
    };
  });

  return { statement, alternatives };
};

const parseQuestionBlock = (block: string, number: number, answerFromTable?: string) => {
  const answerKey = extractInlineAnswer(block) || answerFromTable;
  const questionOnly = removeQuestionHeader(stripTail(block), number);
  const lineParsed = parseAlternativesByLines(questionOnly);
  const parsed = isValidAlternativeSet(lineParsed.alternatives) ? lineParsed : parseAlternativesInline(questionOnly);

  if (!parsed.statement || !isValidAlternativeSet(parsed.alternatives)) {
    return null;
  }

  return {
    localId: `q_${number}_${hashString(`${parsed.statement}\n${parsed.alternatives.map((alt) => `${alt.label}:${alt.text}`).join('\n')}`)}`,
    number,
    statement: parsed.statement,
    alternatives: parsed.alternatives,
    answerKey,
    bank: extractBank(block),
    year: extractYear(block),
  };
};

export const parseObjectiveQuestions = (
  rawText: string,
  options: ParseObjectiveQuestionsOptions = {}
): ParseObjectiveQuestionsResult => {
  const text = normalizeText(rawText);
  if (!text) return { questions: [], rejectedBlocks: 0 };

  const questionStartRe = options.requireExplicitQuestionLabel ? EXPLICIT_QUESTION_START_RE : QUESTION_START_RE;
  const starts = Array.from(text.matchAll(questionStartRe)).map((match) => ({
    start: (match.index ?? 0) + (match[1]?.length ?? 0),
    number: Number(match[2]),
  }));

  const answerKey = extractGlobalAnswerKey(text);
  const questions: ImportedObjectiveQuestion[] = [];
  let rejectedBlocks = 0;

  starts.forEach((start, index) => {
    const nextStart = starts[index + 1]?.start ?? text.length;
    const block = text.slice(start.start, nextStart).trim();
    const parsed = parseQuestionBlock(block, start.number, answerKey.get(start.number));

    if (parsed) {
      questions.push(parsed);
    } else {
      rejectedBlocks += 1;
    }
  });

  return { questions, rejectedBlocks };
};
