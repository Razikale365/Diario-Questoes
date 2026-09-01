import type { QuestionSourcePage } from '../types';

export interface ImportedAlternative {
  label: string;
  text: string;
}

export interface ImportedObjectiveQuestion {
  localId: string;
  number: number;
  sourcePageNumber?: number;
  sourcePage?: QuestionSourcePage;
  statement: string;
  alternatives: ImportedAlternative[];
  answerKey?: string;
  bank?: string;
  year?: number;
}

export interface ParseDiagnostics {
  detectedNumbers: number[];
  duplicateNumbers: number[];
  missingNumbers: number[];
  outOfOrderNumbers: number[];
  rejectedBlockCount: number;
}

export interface ParseObjectiveQuestionsResult {
  questions: ImportedObjectiveQuestion[];
  rejectedBlocks: number;
  diagnostics?: ParseDiagnostics;
}

export interface ParseObjectiveQuestionsOptions {
  requireExplicitQuestionLabel?: boolean;
}

const ALTERNATIVE_LINE_RE = /^\s*(?:\(([A-Ea-e])\)\s*|([A-Ea-e])\)\s*|([A-E])\.\s+)(.*)$/u;
const INLINE_ALTERNATIVE_MARKER_RE = /(^|[\s:;])(?:\(([A-Ea-e])\)|([A-Ea-e])\)|([A-E])\.)\s+/gu;
const COMMENT_TAIL_RE = /(^|\n)[ \t]*(?:coment[aá]rios?|gabarito[ \t]+comentado|resolu[cç][aã]o|solu[cç][aã]o|explica[cç][aã]o)[ \t]*(?:[:\-–]|$)/iu;
const ANSWER_LINE_RE = /(^|\n)[ \t]*(?:gabarito|respostas?|alternativa[ \t]+correta)[ \t]*[:\-–]?[ \t]*(?:letra[ \t]*)?(?:[A-E]|CERTO|ERRADO|ANULADA)\b/iu;

const normalizeText = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const stripPrintedPageNumbersAfterMarkers = (text: string) =>
  text.replace(
    /\[Pagina (\d+)\][ \t]*\n[ \t]*(\d{1,4})[ \t]*(?=\n|$)/gi,
    (match, pdfPageText: string, printedPageText: string) => {
      const offset = Number(pdfPageText) - Number(printedPageText);
      return offset >= 0 && offset <= 3
        ? `[Pagina ${pdfPageText}]\n`
        : match;
    },
  );

const stripPageMarkers = (text: string) => {
  const withoutPrintedPageNumbers = text.replace(
    /\[Pagina (\d+)\][ \t]*\n[ \t]*(\d{1,4})[ \t]*(?=\n|$)/gi,
    (match, pdfPageText: string, printedPageText: string) => {
      const offset = Number(pdfPageText) - Number(printedPageText);
      return offset >= 0 && offset <= 3 ? '' : match;
    },
  );
  return withoutPrintedPageNumbers.replace(/\[Pagina \d+\]/gi, '');
};

const findPageNumberBeforeOffset = (text: string, offset: number) => {
  let pageNumber: number | undefined;
  const markerRe = /\[Pagina (\d+)\]/gi;

  for (const match of text.slice(0, offset).matchAll(markerRe)) {
    pageNumber = Number(match[1]);
  }

  return pageNumber;
};

const findLastPageNumberInText = (text: string) => {
  const matches = Array.from(text.matchAll(/\[Pagina (\d+)\]/gi));
  const value = matches.at(-1)?.[1];
  return value ? Number(value) : undefined;
};

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
  const direct = text.match(/\b(?:gabarito|resposta|alternativa[ \t]+correta)[ \t]*[:\-–]?[ \t]*(A|B|C|D|E|CERTO|ERRADO|ANULADA)\b/iu);
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
  const simuladoHeaderRe = new RegExp(`^\\s*0*${number}\\s*-\\s*\\([^)]+\\)\\s*`, 'iu');
  const withoutSimuladoHeader = block.replace(simuladoHeaderRe, '').trim();
  if (withoutSimuladoHeader !== block.trim()) return withoutSimuladoHeader;

  const headerRe = new RegExp(`^\\s*(?:(?:quest(?:ão|ao)|q)\\s*)?0*${number}\\s*(?:[.)\\-–:]|\\b)\\s*`, 'iu');
  return block.replace(headerRe, '').trim();
};

const repairPositionalAlternativeLabels = (alternatives: ImportedAlternative[]) => {
  const labels = alternatives.map((alternative) => alternative.label);
  if (
    alternatives.length === 5 &&
    labels.slice(0, 4).join('') === 'ABCD' &&
    labels[4] === 'A'
  ) {
    return alternatives.map((alternative, index) => ({
      ...alternative,
      label: ['A', 'B', 'C', 'D', 'E'][index],
    }));
  }
  return alternatives;
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
    const match = line.match(ALTERNATIVE_LINE_RE);
    if (match) {
      currentAlternative = {
        label: (match[1] || match[2] || match[3]).toUpperCase(),
        text: collapseInlineWhitespace(match[4] || ''),
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
  const markers = Array.from(body.matchAll(INLINE_ALTERNATIVE_MARKER_RE)).map((match) => {
    const prefix = match[1] ?? '';
    const markerStart = (match.index ?? 0) + prefix.length;
    return {
      label: (match[2] || match[3] || match[4]).toUpperCase(),
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

const parseQuestionBlock = (
  block: string,
  number: number,
  answerFromTable?: string,
  sourcePageNumber?: number,
) => {
  const answerKey = extractInlineAnswer(block) || answerFromTable;
  const questionOnly = removeQuestionHeader(stripPageMarkers(stripTail(block)), number);
  const lineParsed = parseAlternativesByLines(questionOnly);
  lineParsed.alternatives = repairPositionalAlternativeLabels(lineParsed.alternatives);
  const inlineParsed = parseAlternativesInline(questionOnly);
  inlineParsed.alternatives = repairPositionalAlternativeLabels(inlineParsed.alternatives);
  const parsed = isValidAlternativeSet(lineParsed.alternatives) ? lineParsed : inlineParsed;

  if (!parsed.statement || !isValidAlternativeSet(parsed.alternatives)) return null;
  const endingPageNumber = findLastPageNumberInText(block);
  const alternatives = parsed.alternatives.map((alternative, index) => {
    const isFinalAlternative = index === parsed.alternatives.length - 1;
    if (
      !isFinalAlternative
      || alternative.label !== 'E'
      || !sourcePageNumber
      || !endingPageNumber
      || endingPageNumber === sourcePageNumber
    ) {
      return alternative;
    }

    return {
      ...alternative,
      text: alternative.text.replace(
        new RegExp(`\\s+${endingPageNumber}\\s*$`, 'u'),
        '',
      ),
    };
  });

  return {
    localId: `q_${number}_${hashString(`${parsed.statement}\n${alternatives.map((alt) => `${alt.label}:${alt.text}`).join('\n')}`)}`,
    number,
    sourcePageNumber,
    statement: parsed.statement,
    alternatives,
    answerKey,
    bank: extractBank(block),
    year: extractYear(block),
  };
};

interface CandidateStart {
  start: number;
  number: number;
  type: 'inequivocal' | 'probable' | 'legacy';
  line: string;
}

const collectCandidateStarts = (text: string): CandidateStart[] => {
  const lines = text.split('\n');
  const candidates: CandidateStart[] = [];
  let currentCharOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Inequivocal patterns
    const matchInequiv1 = line.match(/^\s*(?:quest(?:ão|ao)|q)\s*(\d{1,4})\b/i);
    const matchInequiv2 = line.match(/^\s*(\d{1,4})\s*-\s*\([^)]+\)/i);
    const matchInequiv3 = line.match(/^\s*(\d{1,4})\s*\((?:FCC|FGV|CEBRASPE|CESPE|VUNESP|ESAF|QUADRIX|IBFC|INÉDIT\w*|\d{4})[^)]*\)/i);

    if (matchInequiv1) {
      candidates.push({
        start: currentCharOffset + line.indexOf(matchInequiv1[0]),
        number: Number(matchInequiv1[1]),
        type: 'inequivocal',
        line,
      });
    } else if (matchInequiv2) {
      candidates.push({
        start: currentCharOffset + line.indexOf(matchInequiv2[0]),
        number: Number(matchInequiv2[1]),
        type: 'inequivocal',
        line,
      });
    } else if (matchInequiv3) {
      candidates.push({
        start: currentCharOffset + line.indexOf(matchInequiv3[0]),
        number: Number(matchInequiv3[1]),
        type: 'inequivocal',
        line,
      });
    } else {
      // 2. Probable patterns
      const matchProbable = line.match(/^\s*(\d{1,4})\s*(?:[-–:]|\.)(?:\s+|$)/i);
      if (matchProbable) {
        candidates.push({
          start: currentCharOffset + line.indexOf(matchProbable[0]),
          number: Number(matchProbable[1]),
          type: 'probable',
          line,
        });
      } else {
        // 3. Legacy patterns
        const matchLegacy = line.match(/^\s*(\d{1,4})\s+([a-zA-ZÁ-ÿ].*)/i);
        if (matchLegacy) {
          const num = Number(matchLegacy[1]);
          if (num > 0 && num < 1000) {
            candidates.push({
              start: currentCharOffset + line.indexOf(matchLegacy[0]),
              number: num,
              type: 'legacy',
              line,
            });
          }
        }
      }
    }

    currentCharOffset += line.length + 1; // +1 for newline
  }

  return candidates.sort((a, b) => a.start - b.start);
};

const pruneCandidates = (
  candidates: CandidateStart[],
  text: string,
  answerKey: Map<number, string>
): CandidateStart[] => {
  const active = [...candidates];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < active.length; i++) {
      const cand = active[i];
      const nextCand = active[i + 1];
      const blockStart = cand.start;
      const blockEnd = nextCand ? nextCand.start : text.length;
      const block = text.slice(blockStart, blockEnd).trim();

      if (cand.type !== 'inequivocal') {
        // Condition 1: the block parsed from this candidate is invalid
        const parsed = parseQuestionBlock(block, cand.number, answerKey.get(cand.number));
        if (!parsed) {
          active.splice(i, 1);
          changed = true;
          break;
        }

        // Condition 2: out of sequence compared to previous
        if (i > 0 && cand.number <= active[i - 1].number) {
          active.splice(i, 1);
          changed = true;
          break;
        }

        // Condition 3: cutting the preceding candidate's alternatives
        if (i > 0) {
          const prev = active[i - 1];
          const prevBlockWithC = text.slice(prev.start, cand.start).trim();
          const prevBlockWithoutC = text.slice(prev.start, blockEnd).trim();

          const prevValidWithC = parseQuestionBlock(prevBlockWithC, prev.number, answerKey.get(prev.number)) !== null;
          const prevValidWithoutC = parseQuestionBlock(prevBlockWithoutC, prev.number, answerKey.get(prev.number)) !== null;

          if (!prevValidWithC && prevValidWithoutC) {
            active.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
    }
  }

  return active;
};

const buildSequentialCandidateChain = (
  candidates: CandidateStart[],
  text: string,
  answerKey: Map<number, string>,
) => {
  let best: CandidateStart[] = [];
  const starts = candidates.filter((candidate) => candidate.number === 1);

  for (const start of starts) {
    const chain = [start];
    let current = start;

    for (let expected = 2; expected <= 1000; expected += 1) {
      const next = candidates.find((candidate) => {
        if (candidate.start <= current.start || candidate.number !== expected) return false;
        const previousBlock = text.slice(current.start, candidate.start).trim();
        return parseQuestionBlock(
          previousBlock,
          current.number,
          answerKey.get(current.number),
        ) !== null;
      });
      if (!next) break;
      chain.push(next);
      current = next;
    }

    if (
      chain.length > best.length ||
      (chain.length === best.length && start.start > (best[0]?.start ?? -1))
    ) {
      best = chain;
    }
  }

  return best;
};

export const parseObjectiveQuestions = (
  rawText: string,
  options: ParseObjectiveQuestionsOptions = {}
): ParseObjectiveQuestionsResult => {
  const text = stripPrintedPageNumbersAfterMarkers(normalizeText(rawText));
  if (!text) return { questions: [], rejectedBlocks: 0 };

  const originalCandidates = collectCandidateStarts(text);
  const answerKey = extractGlobalAnswerKey(text);

  // Strategy 1: Forte (Inequivocal + Probable)
  const forteCandidates = originalCandidates.filter((c) => c.type !== 'legacy');
  const prunedForte = pruneCandidates(forteCandidates, text, answerKey);
  const questionsForte: ImportedObjectiveQuestion[] = [];
  let rejectedForte = 0;

  prunedForte.forEach((start, index) => {
    const nextStart = prunedForte[index + 1]?.start ?? text.length;
    const block = text.slice(start.start, nextStart).trim();
    const parsed = parseQuestionBlock(
      block,
      start.number,
      answerKey.get(start.number),
      findPageNumberBeforeOffset(text, start.start),
    );
    if (parsed) questionsForte.push(parsed);
    else rejectedForte += 1;
  });

  // Quality metrics for Forte
  const forteMetrics = {
    validCount: questionsForte.length,
    rejectedCount: rejectedForte,
    duplicateCount: 0,
    outOfOrderCount: 0,
    gapCount: 0,
  };
  const forteNumbers = questionsForte.map((q) => q.number);
  const forteSet = new Set(forteNumbers);
  forteMetrics.duplicateCount = forteNumbers.length - forteSet.size;
  for (let i = 1; i < questionsForte.length; i++) {
    if (questionsForte[i].number < questionsForte[i - 1].number) {
      forteMetrics.outOfOrderCount += 1;
    }
  }
  const minF = forteNumbers.length > 0 ? Math.min(...forteNumbers) : 1;
  const maxF = forteNumbers.length > 0 ? Math.max(...forteNumbers) : 0;
  for (let n = minF; n <= maxF; n++) {
    if (!forteSet.has(n)) forteMetrics.gapCount += 1;
  }
  const qualityForte =
    forteMetrics.validCount * 10 -
    forteMetrics.rejectedCount * 2 -
    forteMetrics.duplicateCount * 5 -
    forteMetrics.outOfOrderCount * 5 -
    forteMetrics.gapCount * 1;

  // Strategy 2: Legado (Inequivocal + Probable + Legacy)
  const legacyEnabled = !options.requireExplicitQuestionLabel;
  let questionsLegado: ImportedObjectiveQuestion[] = [];
  let rejectedLegado = 0;
  let qualityLegado = -999999;

  if (legacyEnabled) {
    const prunedLegado = pruneCandidates(originalCandidates, text, answerKey);
    prunedLegado.forEach((start, index) => {
      const nextStart = prunedLegado[index + 1]?.start ?? text.length;
      const block = text.slice(start.start, nextStart).trim();
      const parsed = parseQuestionBlock(
        block,
        start.number,
        answerKey.get(start.number),
        findPageNumberBeforeOffset(text, start.start),
      );
      if (parsed) questionsLegado.push(parsed);
      else rejectedLegado += 1;
    });

    const legadoMetrics = {
      validCount: questionsLegado.length,
      rejectedCount: rejectedLegado,
      duplicateCount: 0,
      outOfOrderCount: 0,
      gapCount: 0,
    };
    const legadoNumbers = questionsLegado.map((q) => q.number);
    const legadoSet = new Set(legadoNumbers);
    legadoMetrics.duplicateCount = legadoNumbers.length - legadoSet.size;
    for (let i = 1; i < questionsLegado.length; i++) {
      if (questionsLegado[i].number < questionsLegado[i - 1].number) {
        legadoMetrics.outOfOrderCount += 1;
      }
    }
    const minL = legadoNumbers.length > 0 ? Math.min(...legadoNumbers) : 1;
    const maxL = legadoNumbers.length > 0 ? Math.max(...legadoNumbers) : 0;
    for (let n = minL; n <= maxL; n++) {
      if (!legadoSet.has(n)) legadoMetrics.gapCount += 1;
    }
    qualityLegado =
      legadoMetrics.validCount * 10 -
      legadoMetrics.rejectedCount * 2 -
      legadoMetrics.duplicateCount * 5 -
      legadoMetrics.outOfOrderCount * 5 -
      legadoMetrics.gapCount * 1;
  }

  // Choose the strategy with higher quality score
  const useForte = !legacyEnabled || (qualityForte >= qualityLegado);
  let finalQuestions = useForte ? questionsForte : questionsLegado;
  let finalRejected = useForte
    ? (forteCandidates.length - questionsForte.length)
    : (originalCandidates.length - questionsLegado.length);

  const sequentialCandidates = buildSequentialCandidateChain(originalCandidates, text, answerKey);
  if (sequentialCandidates.length >= 5) {
    const sequentialQuestions: ImportedObjectiveQuestion[] = [];
    sequentialCandidates.forEach((start, index) => {
      const nextStart = sequentialCandidates[index + 1]?.start ?? text.length;
      const parsed = parseQuestionBlock(
        text.slice(start.start, nextStart).trim(),
        start.number,
        answerKey.get(start.number),
        findPageNumberBeforeOffset(text, start.start),
      );
      if (parsed) sequentialQuestions.push(parsed);
    });

    if (sequentialQuestions.length > finalQuestions.length) {
      finalQuestions = sequentialQuestions;
      finalRejected = sequentialCandidates.length - sequentialQuestions.length;
    }
  }

  // Diagnostics calculations
  const detectedNumbers = finalQuestions.map((q) => q.number);
  
  const seenNumbers = new Set<number>();
  const duplicateNumbers = new Set<number>();
  originalCandidates.forEach((c) => {
    if (seenNumbers.has(c.number)) {
      duplicateNumbers.add(c.number);
    }
    seenNumbers.add(c.number);
  });

  const finalSet = new Set(detectedNumbers);
  const minN = detectedNumbers.length > 0 ? Math.min(...detectedNumbers) : 1;
  const maxN = detectedNumbers.length > 0 ? Math.max(...detectedNumbers) : 0;
  const missingNumbers: number[] = [];
  for (let n = minN; n <= maxN; n++) {
    if (!finalSet.has(n)) {
      missingNumbers.push(n);
    }
  }

  const outOfOrderNumbers: number[] = [];
  for (let i = 1; i < finalQuestions.length; i++) {
    if (finalQuestions[i].number < finalQuestions[i - 1].number) {
      outOfOrderNumbers.push(finalQuestions[i].number);
    }
  }

  // Count rejected candidate starts as those that didn't become validated questions
  const rejectedBlockCount = originalCandidates.length - finalQuestions.length;

  const diagnostics: ParseDiagnostics = {
    detectedNumbers: Array.from(new Set(detectedNumbers)).sort((a, b) => a - b),
    duplicateNumbers: Array.from(duplicateNumbers).sort((a, b) => a - b),
    missingNumbers: missingNumbers.sort((a, b) => a - b),
    outOfOrderNumbers: Array.from(new Set(outOfOrderNumbers)).sort((a, b) => a - b),
    rejectedBlockCount: Math.max(0, rejectedBlockCount),
  };

  return {
    questions: finalQuestions,
    rejectedBlocks: finalRejected,
    diagnostics,
  };
};
