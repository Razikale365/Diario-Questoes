import { PlannerTask, Question, QuestionBankItem, QuestionSourceKind, StudyTask } from '../types';
import { ExternalAnswerBatch, parseExternalAnswerBatchHistory, recordExternalAnswerBatch } from './externalAnswers';
import { ImportedObjectiveQuestion } from './objectiveQuestionParser';

export const QUESTION_BANK_STORAGE_KEY = 'ls_question_bank_v1';
export const QUESTION_BANK_BACKUP_SCHEMA = 'diario-questoes.question-bank';
export const QUESTION_BANK_BACKUP_VERSION = 1;
export const QUESTION_BANK_UPDATED_EVENT = 'diario_question_bank_updated';

export interface QuestionBankImportContext {
  sourceKind: QuestionSourceKind;
  sourceName: string;
  sourceFileName?: string;
  targetSlug?: string;
  discipline: string;
  lesson?: string;
  taskTitle?: string;
  bank: string;
  tags?: string[];
}

export interface QuestionBankMergeResult {
  items: QuestionBankItem[];
  added: number;
  duplicates: number;
  updated: number;
}

export interface QuestionBankBackup {
  schema: typeof QUESTION_BANK_BACKUP_SCHEMA;
  version: typeof QUESTION_BANK_BACKUP_VERSION;
  exportedAt: string;
  itemCount: number;
  items: QuestionBankItem[];
  externalAnswerBatchCount: number;
  externalAnswerBatches: ExternalAnswerBatch[];
}

export interface QuestionBankBackupImportResult extends QuestionBankMergeResult {
  imported: number;
  externalAnswerBatches: ExternalAnswerBatch[];
  externalAnswerBatchesImported: number;
}

export interface QuestionBankProgressSyncResult {
  items: QuestionBankItem[];
  changed: boolean;
  attemptAdded: boolean;
}

export interface QuestionBankResetAttemptsResult {
  items: QuestionBankItem[];
  changed: boolean;
}

export interface QuestionBankInlineAnswerResult {
  items: QuestionBankItem[];
  changed: boolean;
}

type QuestionProgressSnapshot = Pick<Question, 'localId' | 'answer' | 'isCorrect' | 'correctAnswer' | 'favorite'> &
  Partial<Pick<Question, 'hasDoubt' | 'observations'>>;

export type QuestionBankAttemptStatus = '' | 'answered' | 'unanswered' | 'correct' | 'wrong';

export interface QuestionBankFilters {
  query?: string;
  targetSlug?: string;
  discipline?: string;
  sourceKind?: QuestionSourceKind | '';
  onlyFavorites?: boolean;
  onlyDoubts?: boolean;
  attemptStatus?: QuestionBankAttemptStatus;
}

const STOP_WORDS = new Set([
  'aula',
  'meta',
  'para',
  'com',
  'dos',
  'das',
  'que',
  'uma',
  'por',
  'mais',
  'sobre',
  'revisao',
  'questoes',
  'exercicios',
  'teorico',
  'pendencia',
  'atual',
]);

const normalize = (value: string | undefined) =>
  (value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeTags = (tags: string[] = []) =>
  Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

const significantTokens = (value: string) =>
  Array.from(new Set(normalize(value).split(' ').filter((token) => token.length >= 4 && !STOP_WORDS.has(token))));

const extractNumbersAfterLabel = (value: string, label: string) => {
  const normalized = normalize(value);
  const numbers = new Set<number>();
  const pattern = new RegExp(`\\b${label}\\s*0*(\\d{1,3})\\b`, 'g');

  for (const match of normalized.matchAll(pattern)) {
    numbers.add(Number(match[1]));
  }

  return numbers;
};

const hasNumberIntersection = (left: Set<number>, right: Set<number>) =>
  Array.from(left).some((value) => right.has(value));

const questionBankSearchText = (item: QuestionBankItem) =>
  normalize([
    item.statement,
    item.sourceName,
    item.lesson,
    item.taskTitle,
    item.bank,
    item.year ? String(item.year) : '',
    item.tags.join(' '),
  ].join(' '));

const latestAttempt = (item: QuestionBankItem) => item.attempts[item.attempts.length - 1];

const matchesAttemptStatus = (item: QuestionBankItem, status: QuestionBankAttemptStatus | undefined) => {
  if (!status) return true;

  const latest = latestAttempt(item);

  if (status === 'answered') return item.attempts.length > 0;
  if (status === 'unanswered') return item.attempts.length === 0;
  if (status === 'correct') return latest?.isCorrect === true;
  if (status === 'wrong') return latest?.isCorrect === false;

  return true;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isQuestionSourceKind = (value: unknown): value is QuestionSourceKind =>
  value === 'estrategia' || value === 'tec' || value === 'professor' || value === 'official' || value === 'other';

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const asOptionalString = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const asOptionalNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const normalizeAlternative = (value: unknown) => {
  if (!isObject(value)) return null;

  const label = asString(value.label).trim().toUpperCase();
  const text = asString(value.text).trim();

  return label && text ? { label, text } : null;
};

const normalizeAttempt = (value: unknown) => {
  if (!isObject(value)) return null;

  const answer = asString(value.answer);
  const isCorrect = typeof value.isCorrect === 'boolean' || value.isCorrect === null ? value.isCorrect : null;
  const attemptedAt = asString(value.attemptedAt);

  return answer && attemptedAt ? { answer, isCorrect, attemptedAt } : null;
};

const normalizeSourcePage = (value: unknown) => {
  if (!isObject(value)) return undefined;
  const documentId = asString(value.documentId).trim();
  const pageNumber = asOptionalNumber(value.pageNumber);
  if (!documentId || !pageNumber || pageNumber < 1) return undefined;

  return {
    documentId,
    pageNumber,
    likelyVisual: Boolean(value.likelyVisual),
  };
};

const normalizeAnswerLabel = (answer: string | undefined) =>
  (answer || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{Letter}]+/gu, '')
    .toUpperCase();

const calculateInlineAttemptCorrectness = (answer: string, correctAnswer: string | undefined) => {
  const normalizedAnswer = normalizeAnswerLabel(answer);
  const normalizedCorrect = normalizeAnswerLabel(correctAnswer);

  if (!normalizedCorrect) return null;
  if (normalizedCorrect === 'ANULADA' || normalizedCorrect === 'ANULADO') return true;

  return normalizedAnswer === normalizedCorrect;
};

const sanitizeQuestionBankItem = (value: unknown): QuestionBankItem | null => {
  if (!isObject(value)) return null;

  const statement = asString(value.statement).trim();
  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives.map(normalizeAlternative).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  const sourceKind = isQuestionSourceKind(value.sourceKind) ? value.sourceKind : 'other';
  const sourceName = asString(value.sourceName).trim();
  const discipline = asString(value.discipline).trim();
  const bank = asString(value.bank).trim() || 'Outra';
  const importedAt = asString(value.importedAt) || new Date().toISOString();
  const updatedAt = asString(value.updatedAt) || importedAt;

  if (!statement || alternatives.length < 2 || !sourceName || !discipline) return null;

  const fingerprint = asOptionalString(value.fingerprint) || buildQuestionFingerprint({
    sourceQuestionNumber: asOptionalNumber(value.sourceQuestionNumber),
    statement,
    alternatives,
  });

  const attempts = Array.isArray(value.attempts)
    ? value.attempts.map(normalizeAttempt).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return {
    id: asOptionalString(value.id) || `qb_${fingerprint}`,
    fingerprint,
    sourceQuestionNumber: asOptionalNumber(value.sourceQuestionNumber),
    statement,
    alternatives,
    correctAnswer: asOptionalString(value.correctAnswer),
    isMultipleChoice: typeof value.isMultipleChoice === 'boolean' ? value.isMultipleChoice : alternatives.length > 2,
    sourceKind,
    sourceName,
    sourceFileName: asOptionalString(value.sourceFileName),
    sourcePage: normalizeSourcePage(value.sourcePage),
    year: asOptionalNumber(value.year),
    exam: asOptionalString(value.exam),
    institution: asOptionalString(value.institution),
    targetSlug: asOptionalString(value.targetSlug),
    discipline,
    lesson: asOptionalString(value.lesson),
    taskTitle: asOptionalString(value.taskTitle),
    bank,
    tags: normalizeTags(Array.isArray(value.tags) ? value.tags.map(String) : []),
    favorite: Boolean(value.favorite),
    hasDoubt: Boolean(value.hasDoubt),
    observations: asOptionalString(value.observations),
    attempts,
    importedAt,
    updatedAt,
  };
};

export const loadStoredQuestionBank = () => {
  try {
    const stored = localStorage.getItem(QUESTION_BANK_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as QuestionBankItem[]) : [];
  } catch {
    return [];
  }
};

export const persistQuestionBank = (items: QuestionBankItem[]) => {
  localStorage.setItem(QUESTION_BANK_STORAGE_KEY, JSON.stringify(items));
};

export const createQuestionBankBackup = (
  items: QuestionBankItem[],
  exportedAt = new Date().toISOString(),
  externalAnswerBatches: ExternalAnswerBatch[] = [],
) =>
  {
    const sanitizedExternalAnswerBatches = parseExternalAnswerBatchHistory(JSON.stringify(externalAnswerBatches));

    return JSON.stringify(
      {
        schema: QUESTION_BANK_BACKUP_SCHEMA,
        version: QUESTION_BANK_BACKUP_VERSION,
        exportedAt,
        itemCount: items.length,
        items,
        externalAnswerBatchCount: sanitizedExternalAnswerBatches.length,
        externalAnswerBatches: sanitizedExternalAnswerBatches,
      },
      null,
      2,
    );
  };

export const parseQuestionBankBackup = (rawBackup: string): QuestionBankBackup => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBackup);
  } catch {
    throw new Error('Arquivo de backup inválido.');
  }

  if (!isObject(parsed)) {
    throw new Error('Arquivo de backup inválido.');
  }

  if (parsed.schema !== QUESTION_BANK_BACKUP_SCHEMA || parsed.version !== QUESTION_BANK_BACKUP_VERSION) {
    throw new Error('Backup do banco de questões em versão incompatível.');
  }

  if (!Array.isArray(parsed.items)) {
    throw new Error('Backup sem lista de questões.');
  }

  const items = parsed.items.map(sanitizeQuestionBankItem).filter((item): item is QuestionBankItem => Boolean(item));
  const externalAnswerBatches = parseExternalAnswerBatchHistory(JSON.stringify(parsed.externalAnswerBatches || []));

  return {
    schema: QUESTION_BANK_BACKUP_SCHEMA,
    version: QUESTION_BANK_BACKUP_VERSION,
    exportedAt: asString(parsed.exportedAt) || new Date().toISOString(),
    itemCount: items.length,
    items,
    externalAnswerBatchCount: externalAnswerBatches.length,
    externalAnswerBatches,
  };
};

export const importQuestionBankBackup = (
  existing: QuestionBankItem[],
  rawBackup: string,
  existingExternalAnswerBatches: ExternalAnswerBatch[] = [],
): QuestionBankBackupImportResult => {
  const backup = parseQuestionBankBackup(rawBackup);
  const merged = mergeQuestionBankItems(existing, backup.items);
  const existingBatchIds = new Set(existingExternalAnswerBatches.map((batch) => batch.id));
  const externalAnswerBatches = backup.externalAnswerBatches.reduce(
    (history, batch) => recordExternalAnswerBatch(history, batch),
    existingExternalAnswerBatches,
  );

  return {
    ...merged,
    imported: backup.items.length,
    externalAnswerBatches,
    externalAnswerBatchesImported: backup.externalAnswerBatches.filter((batch) => !existingBatchIds.has(batch.id)).length,
  };
};

export const resetQuestionBankItemAttempts = (
  existing: QuestionBankItem[],
  itemId: string,
  updatedAt = new Date().toISOString(),
): QuestionBankResetAttemptsResult => {
  let changed = false;

  const items = existing.map((item) => {
    if (item.id !== itemId || item.attempts.length === 0) return item;

    changed = true;
    return {
      ...item,
      attempts: [],
      updatedAt,
    };
  });

  return { items, changed };
};

export const answerQuestionBankItemInline = (
  existing: QuestionBankItem[],
  itemId: string,
  answer: string,
  attemptedAt = new Date().toISOString(),
): QuestionBankInlineAnswerResult => {
  const normalizedAnswer = answer.trim();
  if (!normalizedAnswer) return { items: existing, changed: false };

  let changed = false;
  const items = existing.map((item) => {
    if (item.id !== itemId) return item;

    changed = true;
    return {
      ...item,
      attempts: [
        ...item.attempts,
        {
          answer: normalizedAnswer,
          isCorrect: calculateInlineAttemptCorrectness(normalizedAnswer, item.correctAnswer),
          attemptedAt,
        },
      ],
      updatedAt: attemptedAt,
    };
  });

  return { items, changed };
};

export const getQuestionBankAnswerOptions = (item: Pick<QuestionBankItem, 'alternatives'>, limit = 5) => {
  const safeLimit = Math.max(0, Math.floor(limit));

  return item.alternatives
    .map((alternative) => ({
      label: alternative.label.trim(),
      text: alternative.text.trim(),
    }))
    .filter((alternative) => alternative.label && alternative.text)
    .slice(0, safeLimit);
};

export const syncQuestionBankItemProgress = (
  existing: QuestionBankItem[],
  question: QuestionProgressSnapshot,
  updates: Partial<Question>,
  attemptedAt = new Date().toISOString(),
): QuestionBankProgressSyncResult => {
  if (!question.localId) {
    return { items: existing, changed: false, attemptAdded: false };
  }

  let changed = false;
  let attemptAdded = false;

  const items = existing.map((item) => {
    if (item.id !== question.localId) return item;

    let nextItem = item;
    const patch: Partial<QuestionBankItem> = {};

    if ('favorite' in updates && typeof question.favorite === 'boolean' && question.favorite !== item.favorite) {
      patch.favorite = question.favorite;
    }

    if ('correctAnswer' in updates && question.correctAnswer !== item.correctAnswer) {
      patch.correctAnswer = question.correctAnswer;
    }

    if ('hasDoubt' in updates && question.hasDoubt !== item.hasDoubt) {
      patch.hasDoubt = Boolean(question.hasDoubt);
    }

    if ('observations' in updates && question.observations !== item.observations) {
      patch.observations = question.observations;
    }

    if ('answer' in updates && question.answer) {
      attemptAdded = true;
      patch.attempts = [
        ...item.attempts,
        {
          answer: question.answer,
          isCorrect: question.isCorrect,
          attemptedAt,
        },
      ];
    } else if ('isCorrect' in updates && question.answer && item.attempts.length > 0) {
      const latest = item.attempts[item.attempts.length - 1];
      if (latest.answer === question.answer && latest.isCorrect !== question.isCorrect) {
        patch.attempts = [
          ...item.attempts.slice(0, -1),
          {
            ...latest,
            isCorrect: question.isCorrect,
          },
        ];
      }
    }

    if (Object.keys(patch).length > 0) {
      changed = true;
      nextItem = {
        ...item,
        ...patch,
        updatedAt: attemptedAt,
      };
    }

    return nextItem;
  });

  return { items, changed, attemptAdded };
};

export const syncStoredQuestionBankProgress = (
  question: QuestionProgressSnapshot,
  updates: Partial<Question>,
  attemptedAt = new Date().toISOString(),
) => {
  const current = loadStoredQuestionBank();
  const result = syncQuestionBankItemProgress(current, question, updates, attemptedAt);

  if (result.changed) {
    persistQuestionBank(result.items);
  }

  return result;
};

export const buildQuestionFingerprint = (
  question: Pick<QuestionBankItem, 'statement' | 'alternatives' | 'sourceQuestionNumber'>
) => {
  const alternatives = question.alternatives
    .map((alternative) => `${alternative.label}:${normalize(alternative.text)}`)
    .join('|');
  return hashString(`${question.sourceQuestionNumber || ''}|${normalize(question.statement)}|${alternatives}`);
};

type QuestionContentSnapshot = Pick<
  Question,
  | 'localId'
  | 'sourceQuestionNumber'
  | 'statement'
  | 'alternatives'
  | 'correctAnswer'
  | 'isMultipleChoice'
  | 'sourceName'
>;

export const syncQuestionBankItemContent = (
  existing: QuestionBankItem[],
  question: QuestionContentSnapshot,
  updatedAt = new Date().toISOString(),
) => {
  const statement = question.statement;
  const alternatives = question.alternatives;
  if (!question.localId || !statement || !alternatives?.length) {
    return { items: existing, changed: false };
  }

  let changed = false;
  const items = existing.map((item) => {
    if (item.id !== question.localId) return item;

    const nextContent = {
      sourceQuestionNumber: question.sourceQuestionNumber,
      statement,
      alternatives,
      correctAnswer: question.correctAnswer,
      isMultipleChoice: question.isMultipleChoice,
      sourceName: question.sourceName || item.sourceName,
    };
    const contentChanged = item.sourceQuestionNumber !== nextContent.sourceQuestionNumber
      || item.statement !== nextContent.statement
      || JSON.stringify(item.alternatives) !== JSON.stringify(nextContent.alternatives)
      || item.correctAnswer !== nextContent.correctAnswer
      || item.isMultipleChoice !== nextContent.isMultipleChoice
      || item.sourceName !== nextContent.sourceName;
    if (!contentChanged) return item;

    changed = true;
    return {
      ...item,
      ...nextContent,
      fingerprint: buildQuestionFingerprint(nextContent),
      updatedAt,
    };
  });

  return { items, changed };
};

export const syncStoredQuestionBankContent = (
  question: QuestionContentSnapshot,
  updatedAt = new Date().toISOString(),
) => {
  const result = syncQuestionBankItemContent(loadStoredQuestionBank(), question, updatedAt);
  if (result.changed) persistQuestionBank(result.items);
  return result;
};

export const buildQuestionBankItems = (
  questions: ImportedObjectiveQuestion[],
  context: QuestionBankImportContext,
): QuestionBankItem[] => {
  const now = new Date().toISOString();

  return questions.map((question) => {
    const base = {
      sourceQuestionNumber: question.number,
      statement: question.statement,
      alternatives: question.alternatives,
    };
    const fingerprint = buildQuestionFingerprint(base);

    return {
      id: `qb_${fingerprint}`,
      fingerprint,
      sourceQuestionNumber: question.number,
      statement: question.statement,
      alternatives: question.alternatives,
      correctAnswer: question.answerKey,
      isMultipleChoice: question.alternatives.length > 2,
      sourceKind: context.sourceKind,
      sourceName: context.sourceName,
      sourceFileName: context.sourceFileName,
      sourcePage: question.sourcePage,
      targetSlug: context.targetSlug,
      year: question.year,
      discipline: context.discipline,
      lesson: context.lesson,
      taskTitle: context.taskTitle,
      bank: question.bank || context.bank,
      tags: normalizeTags(context.tags),
      favorite: false,
      hasDoubt: false,
      attempts: [],
      importedAt: now,
      updatedAt: now,
    };
  });
};

const normalizeSourceFileName = (name?: string) =>
  (name || '')
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '');

const normalizeDiscipline = (disc?: string) =>
  (disc || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

const normalizeTargetSlug = (slug?: string) =>
  (slug || '').trim().toLowerCase() || 'legacy';

const hasSecondaryIdentity = (item: QuestionBankItem) =>
  Boolean(item.sourceFileName && item.sourceFileName.trim()) &&
  typeof item.sourceQuestionNumber === 'number' &&
  item.sourceQuestionNumber > 0;

const getSecondaryKey = (item: QuestionBankItem) => {
  const normFile = normalizeSourceFileName(item.sourceFileName);
  const num = item.sourceQuestionNumber;
  const normDisc = normalizeDiscipline(item.discipline);
  const normTarget = normalizeTargetSlug(item.targetSlug);
  return `${normFile}|${num}|${normDisc}|${normTarget}`;
};

export const mergeQuestionBankItems = (
  existing: QuestionBankItem[],
  incoming: QuestionBankItem[],
): QuestionBankMergeResult => {
  const itemsMap = new Map<string, QuestionBankItem>();
  const byFingerprint = new Map<string, QuestionBankItem>();
  const bySecondary = new Map<string, QuestionBankItem>();

  existing.forEach((item) => {
    itemsMap.set(item.id, item);
    byFingerprint.set(item.fingerprint, item);
    if (hasSecondaryIdentity(item)) {
      bySecondary.set(getSecondaryKey(item), item);
    }
  });

  let added = 0;
  let duplicates = 0;
  let updated = 0;

  incoming.forEach((item) => {
    let matchBySecondary: QuestionBankItem | undefined;
    if (hasSecondaryIdentity(item)) {
      matchBySecondary = bySecondary.get(getSecondaryKey(item));
    }

    if (matchBySecondary) {
      if (matchBySecondary.fingerprint === item.fingerprint) {
        // Duplicate (same secondary identity and same fingerprint)
        duplicates += 1;
        const merged = {
          ...item,
          id: matchBySecondary.id,
          favorite: matchBySecondary.favorite,
          hasDoubt: matchBySecondary.hasDoubt,
          observations: matchBySecondary.observations || item.observations,
          attempts: matchBySecondary.attempts,
          importedAt: matchBySecondary.importedAt,
          updatedAt: new Date().toISOString(),
          tags: normalizeTags([...matchBySecondary.tags, ...item.tags]),
        };
        itemsMap.set(matchBySecondary.id, merged);
        byFingerprint.set(item.fingerprint, merged);
        bySecondary.set(getSecondaryKey(item), merged);
      } else {
        // Update (same secondary identity but different fingerprint)
        updated += 1;
        
        // Remove old fingerprint from index
        byFingerprint.delete(matchBySecondary.fingerprint);

        const collidingItem = byFingerprint.get(item.fingerprint);
        if (collidingItem) {
          // Collision: another item in the database already has the new fingerprint
          const merged = {
            ...item,
            id: collidingItem.id,
            favorite: collidingItem.favorite || matchBySecondary.favorite,
            hasDoubt: collidingItem.hasDoubt || matchBySecondary.hasDoubt,
            observations: [collidingItem.observations, matchBySecondary.observations].filter(Boolean).join(' | ') || undefined,
            attempts: [...collidingItem.attempts, ...matchBySecondary.attempts].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt)),
            importedAt: collidingItem.importedAt || matchBySecondary.importedAt,
            updatedAt: new Date().toISOString(),
            tags: normalizeTags([...collidingItem.tags, ...matchBySecondary.tags, ...item.tags]),
          };
          
          // Remove the obsolete matchBySecondary from indexes
          itemsMap.delete(matchBySecondary.id);
          bySecondary.delete(getSecondaryKey(matchBySecondary));

          // Set/overwrite colliding item
          itemsMap.set(collidingItem.id, merged);
          byFingerprint.set(item.fingerprint, merged);
          if (hasSecondaryIdentity(merged)) {
            bySecondary.set(getSecondaryKey(merged), merged);
          }
        } else {
          // No collision
          const merged = {
            ...item,
            id: matchBySecondary.id,
            favorite: matchBySecondary.favorite,
            hasDoubt: matchBySecondary.hasDoubt,
            observations: matchBySecondary.observations || item.observations,
            attempts: matchBySecondary.attempts,
            importedAt: matchBySecondary.importedAt,
            updatedAt: new Date().toISOString(),
            tags: normalizeTags([...matchBySecondary.tags, ...item.tags]),
          };
          itemsMap.set(matchBySecondary.id, merged);
          byFingerprint.set(item.fingerprint, merged);
          bySecondary.set(getSecondaryKey(item), merged);
        }
      }
    } else {
      // No match by secondary identity. Try match by fingerprint.
      const matchByFingerprint = byFingerprint.get(item.fingerprint);
      if (matchByFingerprint) {
        duplicates += 1;
        const merged = {
          ...item,
          id: matchByFingerprint.id,
          favorite: matchByFingerprint.favorite,
          hasDoubt: matchByFingerprint.hasDoubt,
          observations: matchByFingerprint.observations || item.observations,
          attempts: matchByFingerprint.attempts,
          importedAt: matchByFingerprint.importedAt,
          updatedAt: new Date().toISOString(),
          tags: normalizeTags([...matchByFingerprint.tags, ...item.tags]),
        };
        itemsMap.set(matchByFingerprint.id, merged);
        byFingerprint.set(item.fingerprint, merged);
        if (hasSecondaryIdentity(merged)) {
          bySecondary.set(getSecondaryKey(merged), merged);
        }
      } else {
        // Completely new item
        added += 1;
        itemsMap.set(item.id, item);
        byFingerprint.set(item.fingerprint, item);
        if (hasSecondaryIdentity(item)) {
          bySecondary.set(getSecondaryKey(item), item);
        }
      }
    }
  });

  return {
    items: Array.from(itemsMap.values()).sort((a, b) =>
      a.discipline.localeCompare(b.discipline) ||
      a.sourceName.localeCompare(b.sourceName) ||
      (a.sourceQuestionNumber || 0) - (b.sourceQuestionNumber || 0)
    ),
    added,
    duplicates,
    updated,
  };
};

export const resolveMergedQuestionBankItems = (
  incoming: QuestionBankItem[],
  mergedItems: QuestionBankItem[],
) => {
  const byFingerprint = new Map(mergedItems.map((item) => [item.fingerprint, item]));
  return incoming.map((item) => byFingerprint.get(item.fingerprint) || item);
};

export const reassignQuestionBankItemsTarget = (
  items: QuestionBankItem[],
  itemIds: string[],
  targetSlug?: string,
  updatedAt = new Date().toISOString(),
): { items: QuestionBankItem[]; updated: number } => {
  const selectedIds = new Set(itemIds);
  const normalizedTarget = targetSlug || undefined;
  let updated = 0;

  const nextItems = items.map((item) => {
    if (!selectedIds.has(item.id) || item.targetSlug === normalizedTarget) return item;
    updated += 1;
    return {
      ...item,
      targetSlug: normalizedTarget,
      updatedAt,
    };
  });

  return { items: nextItems, updated };
};

export const filterQuestionBankItems = (items: QuestionBankItem[], filters: QuestionBankFilters) => {
  const query = normalize(filters.query);

  return items.filter((item) => {
    if (filters.targetSlug === 'legacy' && item.targetSlug) return false;
    if (filters.targetSlug && filters.targetSlug !== 'legacy' && item.targetSlug !== filters.targetSlug) return false;
    if (filters.discipline && item.discipline !== filters.discipline) return false;
    if (filters.sourceKind && item.sourceKind !== filters.sourceKind) return false;
    if (filters.onlyFavorites && !item.favorite) return false;
    if (filters.onlyDoubts && !item.hasDoubt) return false;
    if (!matchesAttemptStatus(item, filters.attemptStatus)) return false;
    if (!query) return true;

    const haystack = questionBankSearchText(item);

    return haystack.includes(query);
  });
};

export const matchQuestionBankItemsToPlannerTask = (
  plannerTask: PlannerTask,
  items: QuestionBankItem[],
  limit = 80,
) => {
  const taskText = [
    plannerTask.description,
    plannerTask.format,
    plannerTask.planejamento,
    plannerTask.details,
    plannerTask.tips,
    plannerTask.metaNumber ? String(plannerTask.metaNumber) : '',
  ].join(' ');
  const taskTokens = significantTokens([
    taskText,
  ].join(' '));
  const taskAulaNumbers = extractNumbersAfterLabel(taskText, 'aula');
  const matchesPlannerTarget = (item: QuestionBankItem) => {
    if (!plannerTask.targetSlug) return true;
    if (item.targetSlug) return item.targetSlug === plannerTask.targetSlug || item.targetSlug === 'shared';
    return plannerTask.targetSlug === 'sefaz_ce';
  };

  if (taskTokens.length === 0) return [];

  const ranked = items
    .filter((item) => item.discipline === plannerTask.discipline && matchesPlannerTarget(item))
    .map((item) => {
      const haystack = questionBankSearchText(item);
      const itemTaskNumbers = extractNumbersAfterLabel(haystack, 'tarefa');
      const itemAulaNumbers = extractNumbersAfterLabel(haystack, 'aula');
      const hasConflictingTaskNumber = itemTaskNumbers.size > 0 && !itemTaskNumbers.has(plannerTask.number);
      const hasConflictingAulaNumber =
        taskAulaNumbers.size > 0 &&
        itemAulaNumbers.size > 0 &&
        !hasNumberIntersection(taskAulaNumbers, itemAulaNumbers);

      if (hasConflictingTaskNumber || hasConflictingAulaNumber) {
        return { item, score: 0, directTaskNumber: false };
      }

      const directTaskNumber = itemTaskNumbers.has(plannerTask.number);
      const score = taskTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { item, score: score + (directTaskNumber ? 10 : 0), directTaskNumber };
    })
    .filter(({ score }) => score > 0);

  const directMatches = ranked.filter(({ directTaskNumber }) => directTaskNumber);
  if (directMatches.length > 0) {
    return directMatches
      .sort((a, b) =>
        (a.item.sourceQuestionNumber || 0) - (b.item.sourceQuestionNumber || 0) ||
        b.score - a.score ||
        Number(b.item.favorite) - Number(a.item.favorite) ||
        (b.item.year || 0) - (a.item.year || 0)
      )
      .slice(0, limit)
      .map(({ item }) => item);
  }

  return ranked
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.item.favorite) - Number(a.item.favorite) ||
      (b.item.year || 0) - (a.item.year || 0) ||
      (a.item.sourceQuestionNumber || 0) - (b.item.sourceQuestionNumber || 0)
    )
    .slice(0, limit)
    .map(({ item }) => item);
};

export const isStudyTaskCompatibleWithPlannerTask = (plannerTask: PlannerTask, studyTask: StudyTask) => {
  if (plannerTask.targetSlug && studyTask.targetSlug !== plannerTask.targetSlug) return false;

  const plannerText = [
    plannerTask.description,
    plannerTask.format,
    plannerTask.planejamento,
    plannerTask.details,
    plannerTask.tips,
    plannerTask.metaNumber ? String(plannerTask.metaNumber) : '',
  ].join(' ');
  const studyTaskText = [
    studyTask.planejamento,
    studyTask.meta,
    studyTask.tarefa ? `tarefa ${studyTask.tarefa}` : '',
    studyTask.assunto,
    studyTask.discipline,
    studyTask.bank,
    ...studyTask.blocks.flatMap((block) => [
      block.title,
      block.lesson,
      block.pages,
      block.bank,
      ...block.questions.flatMap((question) => [
        question.sourceName,
        question.statement,
      ]),
    ]),
  ].join(' ');
  const plannerAulaNumbers = extractNumbersAfterLabel(plannerText, 'aula');
  const studyTaskAulaNumbers = extractNumbersAfterLabel(studyTaskText, 'aula');
  const studyTaskNumbers = extractNumbersAfterLabel(studyTaskText, 'tarefa');

  if (studyTaskNumbers.size > 0 && !studyTaskNumbers.has(plannerTask.number)) return false;

  return !(
    plannerAulaNumbers.size > 0 &&
    studyTaskAulaNumbers.size > 0 &&
    !hasNumberIntersection(plannerAulaNumbers, studyTaskAulaNumbers)
  );
};

const countStudyTaskProgress = (task: StudyTask) =>
  task.blocks.reduce((count, block) => (
    count + block.questions.filter((question) => (
      Boolean(question.answer)
      || question.isCorrect !== null
      || question.hasDoubt
      || Boolean(question.observations?.trim())
      || Boolean(question.favorite)
    )).length
  ), 0);

const countStudyTaskQuestions = (task: StudyTask) =>
  task.blocks.reduce((count, block) => count + block.questions.length, 0);

export const findCompatibleStudyTaskForPlannerTask = (
  plannerTask: PlannerTask,
  studyTasks: StudyTask[],
) => {
  const normalizedDiscipline = normalize(plannerTask.discipline);
  const normalizedDescription = normalize(plannerTask.description);
  const candidates = studyTasks.filter((studyTask) => {
    if (studyTask.tarefa?.trim() !== String(plannerTask.number)) return false;
    if (normalize(studyTask.discipline) !== normalizedDiscipline) return false;
    if (
      plannerTask.metaNumber
      && studyTask.meta?.trim()
      && studyTask.meta.trim() !== String(plannerTask.metaNumber)
    ) {
      return false;
    }
    if (
      normalizedDescription
      && studyTask.assunto
      && normalize(studyTask.assunto) !== normalizedDescription
    ) {
      return false;
    }
    return isStudyTaskCompatibleWithPlannerTask(plannerTask, studyTask);
  });

  return candidates.sort((left, right) => (
    countStudyTaskProgress(right) - countStudyTaskProgress(left)
    || countStudyTaskQuestions(right) - countStudyTaskQuestions(left)
    || new Date(left.date).getTime() - new Date(right.date).getTime()
  ))[0] || null;
};

export const questionBankItemToQuestion = (item: QuestionBankItem, index: number): Question => ({
  number: index + 1,
  sourceQuestionNumber: item.sourceQuestionNumber,
  localId: item.id,
  statement: item.statement,
  alternatives: item.alternatives,
  answer: '',
  isCorrect: null,
  hasDoubt: item.hasDoubt,
  correctAnswer: item.correctAnswer,
  isMultipleChoice: item.isMultipleChoice,
  eliminated: [],
  doubtedAlts: [],
  sourceKind: item.sourceKind,
  sourceName: item.sourceName,
  sourcePage: item.sourcePage,
  year: item.year,
  exam: item.exam,
  institution: item.institution,
  favorite: item.favorite,
  observations: item.observations,
  attempts: [],
});

export const createStudyTaskFromQuestionBankItems = (
  items: QuestionBankItem[],
  options: { title?: string; discipline?: string; lesson?: string } = {},
): StudyTask | null => {
  if (items.length === 0) return null;

  const discipline = options.discipline || items[0].discipline;
  const sourceNames = Array.from(new Set(items.map((item) => item.sourceName))).slice(0, 3);
  const title = options.title || `Banco de Questões - ${discipline}`;
  const lesson = options.lesson || sourceNames.join(', ') || title;
  const bank = items[0].bank || 'Outra';
  const questions = items.map(questionBankItemToQuestion);
  const itemTargets = Array.from(new Set(items.map((item) => item.targetSlug).filter(Boolean)));

  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    targetSlug: itemTargets.length === 1 ? itemTargets[0] : undefined,
    planejamento: 'Banco de Questões',
    meta: '',
    tarefa: '',
    assunto: lesson,
    discipline,
    bank,
    blocks: [
      {
        id: crypto.randomUUID(),
        title,
        lesson,
        pages: `${questions.length} questões`,
        bank,
        questions,
        showStats: true,
        showGabarito: false,
        layout: {
          columns: 1,
          rows: Math.min(Math.max(questions.length, 1), 8),
          type: 'grid',
          width: 12,
          rowSpan: 4,
        },
      },
    ],
    status: 'in_progress',
  };
};
