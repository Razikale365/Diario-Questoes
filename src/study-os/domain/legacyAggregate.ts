import type { QuestionBankItem } from '../../types';

export interface LearningAggregateItem {
  sourceItemId: string;
  targetTopicId?: number;
  discipline: string;
  topic: string;
  eventKind: 'questions' | 'review';
  occurredAt: string;
  sourceDate: string;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
}

export interface LegacyAggregateRejection {
  itemId: string;
  code: 'target_mismatch' | 'topic_missing' | 'attempt_missing';
}

export interface LegacyAggregateBuild {
  items: LearningAggregateItem[];
  rejected: LegacyAggregateRejection[];
}

interface MutableAggregate extends Omit<LearningAggregateItem, 'sourceItemId'> {
  questionIds: Set<string>;
}

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const validIso = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function buildLegacyAggregateImport(
  questionBank: QuestionBankItem[],
  targetSlug: string,
): LegacyAggregateBuild {
  const groups = new Map<string, MutableAggregate>();
  const rejected: LegacyAggregateRejection[] = [];

  for (const item of questionBank) {
    if (item.targetSlug !== targetSlug) {
      rejected.push({ itemId: item.id, code: 'target_mismatch' });
      continue;
    }
    const topic = item.lesson?.trim() || item.taskTitle?.trim();
    if (!topic) {
      rejected.push({ itemId: item.id, code: 'topic_missing' });
      continue;
    }
    const attempts = item.attempts
      .map((attempt) => ({ attempt, date: validIso(attempt.attemptedAt) }))
      .filter((entry): entry is { attempt: QuestionBankItem['attempts'][number]; date: Date } => Boolean(entry.date));
    if (attempts.length === 0) {
      rejected.push({ itemId: item.id, code: 'attempt_missing' });
      continue;
    }
    attempts.forEach(({ attempt, date }, index) => {
      const sourceDate = date.toISOString().slice(0, 10);
      const key = [targetSlug, item.discipline.trim(), topic, sourceDate].join('|');
      const current = groups.get(key) || {
        discipline: item.discipline.trim(),
        topic,
        eventKind: 'questions',
        occurredAt: date.toISOString(),
        sourceDate,
        questionsDone: 0,
        correctCount: 0,
        wrongCount: 0,
        doubtCount: 0,
        favoriteCount: 0,
        questionIds: new Set<string>(),
      };
      current.questionsDone += 1;
      if (attempt.isCorrect === true) current.correctCount += 1;
      if (attempt.isCorrect === false) current.wrongCount += 1;
      if (date.toISOString() > current.occurredAt) current.occurredAt = date.toISOString();
      if (index === attempts.length - 1 && !current.questionIds.has(item.id)) {
        current.doubtCount += item.hasDoubt ? 1 : 0;
        current.favoriteCount += item.favorite ? 1 : 0;
        current.questionIds.add(item.id);
      }
      groups.set(key, current);
    });
  }

  const items = Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, aggregate]) => ({
      sourceItemId: `legacy-${hash(key)}`,
      discipline: aggregate.discipline,
      topic: aggregate.topic,
      eventKind: aggregate.eventKind,
      occurredAt: aggregate.occurredAt,
      sourceDate: aggregate.sourceDate,
      questionsDone: aggregate.questionsDone,
      correctCount: aggregate.correctCount,
      wrongCount: aggregate.wrongCount,
      doubtCount: aggregate.doubtCount,
      favoriteCount: aggregate.favoriteCount,
    }));
  return { items, rejected };
}
