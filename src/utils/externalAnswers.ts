import { QuestionBankItem, QuestionSourceKind } from '../types';

export const EXTERNAL_ANSWER_BATCHES_STORAGE_KEY = 'ls_external_answer_batches_v1';
export const EXTERNAL_ANSWER_DRAFT_STORAGE_KEY = 'ls_external_answer_draft_v1';
export const TEC_SIDECAR_URL_STORAGE_KEY = 'ls_tec_sidecar_url_v1';
export const DEFAULT_TEC_URL = 'https://www.tecconcursos.com.br/questoes/cadernos';
export const TEC_SIDECAR_WINDOW_NAME = 'diario-tec-assistido';

export interface ExternalAnswerEntry {
  number: number;
  answer: string;
  raw: string;
}

export interface ExternalAnswerParseResult {
  entries: ExternalAnswerEntry[];
  ignoredLines: string[];
  duplicateNumbers: number[];
}

export interface ExternalAnswerApplyResult {
  items: QuestionBankItem[];
  applied: number;
  unmatched: ExternalAnswerEntry[];
  changedIds: string[];
}

export type ExternalAnswerReviewMode = 'all' | 'wrong' | 'wrong-or-uncorrected';

export interface ExternalAnswerBatch {
  id: string;
  sourceKind: QuestionSourceKind;
  sourceName?: string;
  appliedAt: string;
  changedIds: string[];
  applied: number;
  unmatched: number;
}

export interface ExternalAnswerDraft {
  text: string;
  quickNumber: number;
  updatedAt?: string;
}

export interface ExternalAnswerTextUndoResult {
  text: string;
  removed: ExternalAnswerEntry | null;
}

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();

const normalizeAnswer = (value: string | undefined) => {
  const upper = normalizeText(value || '')
    .replace(/[^\p{Letter}]+/gu, '')
    .toUpperCase();

  if (/^[A-E]$/.test(upper)) return upper;
  if (upper === 'CERTO') return 'C';
  if (upper === 'ERRADO') return 'E';
  if (upper === 'ANULADA' || upper === 'ANULADO') return 'ANULADA';

  return null;
};

const answerPairRegex = () =>
  /(?:^|[\s,;])(?:q(?:uestao)?\.?\s*)?(\d{1,4})\s*(?:[.)\-:=>]|\s)+\s*(?:(?:sua\s+)?resposta|marcada|gabarito)?\s*[:\-]?\s*(A|B|C|D|E|CERTO|ERRADO|ANULADA|ANULADO)(?=\s|$|[,;.])/giu;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isQuestionSourceKind = (value: unknown): value is QuestionSourceKind =>
  value === 'estrategia' || value === 'tec' || value === 'professor' || value === 'official' || value === 'other';

const normalizeStringList = (values: unknown) => {
  if (!Array.isArray(values)) return [];

  return Array.from(
    new Set(values.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)),
  );
};

const sanitizeExternalAnswerBatch = (value: unknown): ExternalAnswerBatch | null => {
  if (!isObject(value)) return null;

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const sourceKind = isQuestionSourceKind(value.sourceKind) ? value.sourceKind : null;
  const appliedAt = typeof value.appliedAt === 'string' ? value.appliedAt.trim() : '';
  const changedIds = normalizeStringList(value.changedIds);
  const applied = typeof value.applied === 'number' && Number.isFinite(value.applied) ? Math.max(0, value.applied) : 0;
  const unmatched =
    typeof value.unmatched === 'number' && Number.isFinite(value.unmatched) ? Math.max(0, value.unmatched) : 0;

  if (!id || !sourceKind || !appliedAt || changedIds.length === 0) return null;

  return {
    id,
    sourceKind,
    sourceName: typeof value.sourceName === 'string' && value.sourceName.trim() ? value.sourceName.trim() : undefined,
    appliedAt,
    changedIds,
    applied,
    unmatched,
  };
};

export const parseExternalAnswerBatchHistory = (rawHistory: string | null | undefined): ExternalAnswerBatch[] => {
  if (!rawHistory) return [];

  try {
    const parsed: unknown = JSON.parse(rawHistory);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(sanitizeExternalAnswerBatch)
      .filter((batch): batch is ExternalAnswerBatch => Boolean(batch))
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  } catch {
    return [];
  }
};

export const recordExternalAnswerBatch = (
  existing: ExternalAnswerBatch[],
  batch: ExternalAnswerBatch,
  limit = 20,
): ExternalAnswerBatch[] => {
  const sanitized = sanitizeExternalAnswerBatch(batch);
  if (!sanitized) return existing;

  return [sanitized, ...existing.filter((item) => item.id !== sanitized.id)]
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
    .slice(0, Math.max(1, limit));
};

export const findExternalAnswerBatch = (history: ExternalAnswerBatch[], batchId: string) => {
  const normalizedBatchId = batchId.trim();
  if (!normalizedBatchId) return null;

  return history.find((batch) => batch.id === normalizedBatchId) || null;
};

export const removeExternalAnswerBatch = (history: ExternalAnswerBatch[], batchId: string) => {
  const normalizedBatchId = batchId.trim();
  if (!normalizedBatchId) return history;

  return history.filter((batch) => batch.id !== normalizedBatchId);
};

export const loadStoredExternalAnswerBatches = () => {
  try {
    return parseExternalAnswerBatchHistory(localStorage.getItem(EXTERNAL_ANSWER_BATCHES_STORAGE_KEY));
  } catch {
    return [];
  }
};

export const persistExternalAnswerBatches = (batches: ExternalAnswerBatch[]) => {
  localStorage.setItem(EXTERNAL_ANSWER_BATCHES_STORAGE_KEY, JSON.stringify(batches));
};

export const parseExternalAnswerDraft = (rawDraft: string | null | undefined): ExternalAnswerDraft | null => {
  if (!rawDraft) return null;

  try {
    const parsed: unknown = JSON.parse(rawDraft);
    if (!isObject(parsed) || typeof parsed.text !== 'string') return null;

    const text = parsed.text.trim();
    if (!text) return null;

    const rawQuickNumber = typeof parsed.quickNumber === 'number' && Number.isFinite(parsed.quickNumber)
      ? Math.trunc(parsed.quickNumber)
      : 0;

    return {
      text,
      quickNumber: rawQuickNumber > 0 ? rawQuickNumber : getNextExternalAnswerNumber(text),
      updatedAt: typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim() ? parsed.updatedAt.trim() : undefined,
    };
  } catch {
    return null;
  }
};

export const loadStoredExternalAnswerDraft = () => {
  try {
    return parseExternalAnswerDraft(localStorage.getItem(EXTERNAL_ANSWER_DRAFT_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const persistExternalAnswerDraft = (draft: ExternalAnswerDraft) => {
  localStorage.setItem(EXTERNAL_ANSWER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
};

export const clearStoredExternalAnswerDraft = () => {
  localStorage.removeItem(EXTERNAL_ANSWER_DRAFT_STORAGE_KEY);
};

export const getExternalAnswerDraftLabel = (updatedAt: string | undefined) => {
  if (!updatedAt) return 'Rascunho salvo';

  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'Rascunho salvo';

  return `Rascunho salvo ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

export const parseExternalAnswerText = (text: string): ExternalAnswerParseResult => {
  const byNumber = new Map<number, ExternalAnswerEntry>();
  const duplicateNumbers = new Set<number>();
  const ignoredLines: string[] = [];

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((rawLine) => {
      const normalizedLine = normalizeText(rawLine);
      const regex = answerPairRegex();
      let found = false;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(normalizedLine)) !== null) {
        const number = Number.parseInt(match[1], 10);
        const answer = normalizeAnswer(match[2]);
        if (!Number.isFinite(number) || number <= 0 || !answer) continue;

        if (byNumber.has(number)) duplicateNumbers.add(number);
        byNumber.set(number, { number, answer, raw: rawLine });
        found = true;
      }

      if (!found) {
        ignoredLines.push(rawLine);
      }
    });

  return {
    entries: Array.from(byNumber.values()).sort((a, b) => a.number - b.number),
    ignoredLines,
    duplicateNumbers: Array.from(duplicateNumbers).sort((a, b) => a - b),
  };
};

export const getNextExternalAnswerNumber = (text: string) => {
  const entries = parseExternalAnswerText(text).entries;
  if (entries.length === 0) return 1;

  return Math.max(...entries.map((entry) => entry.number)) + 1;
};

export const removeLatestExternalAnswerTextEntry = (text: string): ExternalAnswerTextUndoResult => {
  const lines = text.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsedLine = parseExternalAnswerText(lines[index]);
    if (parsedLine.entries.length === 0) continue;

    const [removed] = parsedLine.entries.slice(-1);
    return {
      text: [...lines.slice(0, index), ...lines.slice(index + 1)].join('\n'),
      removed,
    };
  }

  return { text, removed: null };
};

export const upsertExternalAnswerText = (text: string, number: number, answer: string) => {
  const normalizedNumber = Math.trunc(number);
  const normalizedAnswer = normalizeAnswer(answer);
  const answerLabel = answer.trim();

  if (!Number.isFinite(normalizedNumber) || normalizedNumber <= 0 || !normalizedAnswer || !answerLabel) {
    return text;
  }

  const nextLine = `${normalizedNumber} ${answerLabel}`;
  let inserted = false;
  const nextLines: string[] = [];

  text.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    const lineEntries = parseExternalAnswerText(trimmedLine).entries;
    const hasSameQuestion = lineEntries.some((entry) => entry.number === normalizedNumber);

    if (hasSameQuestion) {
      if (!inserted) {
        nextLines.push(nextLine);
        inserted = true;
      }
      return;
    }

    nextLines.push(trimmedLine);
  });

  if (!inserted) {
    nextLines.push(nextLine);
  }

  return nextLines.join('\n');
};

export const getQuickCaptureShortcutAnswer = (key: string) => {
  const normalizedKey = key.trim().toUpperCase();

  if (/^[A-E]$/.test(normalizedKey)) return normalizedKey;
  if (normalizedKey === '1') return 'A';
  if (normalizedKey === '2') return 'B';
  if (normalizedKey === '3') return 'C';
  if (normalizedKey === '4') return 'D';
  if (normalizedKey === '5') return 'E';
  if (normalizedKey === 'Z') return 'Certo';
  if (normalizedKey === 'X') return 'Errado';

  return null;
};

export const isEditableShortcutTarget = (tagName: string | null | undefined, isContentEditable = false) => {
  const normalizedTag = (tagName || '').toUpperCase();

  return isContentEditable || normalizedTag === 'INPUT' || normalizedTag === 'TEXTAREA' || normalizedTag === 'SELECT';
};

export const getTecSidecarUrl = (rawUrl: string | null | undefined, fallback = DEFAULT_TEC_URL) => {
  const trimmedUrl = (rawUrl || '').trim();
  const candidate = trimmedUrl || fallback;
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback;

    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
};

const clampWindowMetric = (value: number | undefined, min: number, max: number, fallback: number) => {
  const normalized = Number.isFinite(value) ? Math.trunc(Number(value)) : fallback;
  return Math.min(Math.max(normalized, min), max);
};

export const buildTecSidecarWindowFeatures = (
  options: { width?: number; height?: number; left?: number; top?: number } = {},
) => {
  const width = clampWindowMetric(options.width, 720, 1600, 1180);
  const height = clampWindowMetric(options.height, 520, 1200, 900);
  const left = clampWindowMetric(options.left, 0, 2400, 80);
  const top = clampWindowMetric(options.top, 0, 1600, 40);

  return [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
};

export const loadStoredTecSidecarUrl = () => {
  try {
    return getTecSidecarUrl(localStorage.getItem(TEC_SIDECAR_URL_STORAGE_KEY));
  } catch {
    return DEFAULT_TEC_URL;
  }
};

export const persistTecSidecarUrl = (rawUrl: string) => {
  const url = getTecSidecarUrl(rawUrl);
  localStorage.setItem(TEC_SIDECAR_URL_STORAGE_KEY, url);
  return url;
};

const calculateCorrectness = (answer: string, correctAnswer: string | undefined) => {
  const normalizedCorrect = normalizeAnswer(correctAnswer);

  if (!normalizedCorrect) return null;
  if (normalizedCorrect === 'ANULADA') return true;

  return answer === normalizedCorrect;
};

export const applyExternalAnswerAttempts = (
  items: QuestionBankItem[],
  targetItems: QuestionBankItem[],
  entries: ExternalAnswerEntry[],
  attemptedAt = new Date().toISOString(),
): ExternalAnswerApplyResult => {
  const targetOrderById = new Map(targetItems.map((item, index) => [item.id, index + 1]));
  const answerByNumber = new Map(entries.map((entry) => [entry.number, entry]));
  const matchedEntryNumbers = new Set<number>();
  const changedIds: string[] = [];
  let applied = 0;

  const nextItems = items.map((item) => {
    const visibleOrder = targetOrderById.get(item.id);
    if (!visibleOrder) return item;

    const sourceEntry = item.sourceQuestionNumber ? answerByNumber.get(item.sourceQuestionNumber) : undefined;
    const visibleEntry = answerByNumber.get(visibleOrder);
    const entry = sourceEntry || visibleEntry;
    if (!entry) return item;

    matchedEntryNumbers.add(entry.number);
    changedIds.push(item.id);
    applied += 1;

    return {
      ...item,
      attempts: [
        ...item.attempts,
        {
          answer: entry.answer,
          isCorrect: calculateCorrectness(entry.answer, item.correctAnswer),
          attemptedAt,
        },
      ],
      updatedAt: attemptedAt,
    };
  });

  return {
    items: nextItems,
    applied,
    unmatched: entries.filter((entry) => !matchedEntryNumbers.has(entry.number)),
    changedIds,
  };
};

export const selectExternalAnswerReviewItems = (
  items: QuestionBankItem[],
  changedIds: string[],
  mode: ExternalAnswerReviewMode,
) => {
  const changedIdSet = new Set(changedIds);

  return items.filter((item) => {
    if (!changedIdSet.has(item.id)) return false;
    if (mode === 'all') return true;

    const latest = item.attempts[item.attempts.length - 1];
    if (!latest) return false;
    if (mode === 'wrong') return latest.isCorrect === false;

    return latest.isCorrect !== true;
  });
};
