import { requestJson } from './client';
import type { LearningAggregateItem } from '../domain/legacyAggregate';

export interface ReviewQueueItem {
  id: number;
  targetSlug: string;
  topicTargetSlug: string;
  targetTopicId: number;
  dueDate: string;
  state: 'pending' | 'deferred' | 'resolved';
  boundedQuestions: number;
  triggerEventIds: number[];
  reason: string;
  debtBp: number;
  attemptCount: number;
  resolvedEventId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewQueue { items: ReviewQueueItem[] }

export interface LearningImportRejection {
  sourceItemId: string;
  code: string;
  message: string;
}

export interface LearningImportReport {
  targetSlug: string;
  batchId: string;
  importedCount: number;
  rejectedCount: number;
  rejected: LearningImportRejection[];
}

export interface LearningImportInput {
  targetSlug: string;
  batchId?: string;
  items: LearningAggregateItem[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
);
const isoDate = (value: unknown) => text(value) && /^\d{4}-\d{2}-\d{2}$/.test(value as string);
const isoTimestamp = (value: unknown) => text(value) && !Number.isNaN(Date.parse(value as string));
const invalid = (label: string): never => { throw new TypeError(`Invalid Study OS ${label} payload`); };

const parseReviewItem = (value: unknown): ReviewQueueItem => {
  const item = isRecord(value) ? value : invalid('review');
  if (!integer(item.id, 1)
    || !text(item.targetSlug)
    || !text(item.topicTargetSlug)
    || !integer(item.targetTopicId, 1)
    || !isoDate(item.dueDate)
    || !['pending', 'deferred', 'resolved'].includes(String(item.state))
    || !integer(item.boundedQuestions, 5, 10)
    || !Array.isArray(item.triggerEventIds)
    || !item.triggerEventIds.every((entry) => integer(entry, 1))
    || !text(item.reason)
    || !integer(item.debtBp, 0, 10000)
    || !integer(item.attemptCount)
    || !(item.resolvedEventId === null || integer(item.resolvedEventId, 1))
    || !integer(item.version, 1)
    || !isoTimestamp(item.createdAt)
    || !isoTimestamp(item.updatedAt)) invalid('review');
  return item as unknown as ReviewQueueItem;
};

export function parseReviewQueue(value: unknown): ReviewQueue {
  const record = isRecord(value) ? value : invalid('review queue');
  const items = record.items;
  if (!Array.isArray(items)) invalid('review queue');
  return { items: (items as unknown[]).map(parseReviewItem) };
}

export function parseLearningImportReport(value: unknown): LearningImportReport {
  const record = isRecord(value) ? value : invalid('learning import');
  const rejectedItems = record.rejected;
  if (!text(record.targetSlug)
    || !text(record.batchId)
    || !integer(record.importedCount)
    || !integer(record.rejectedCount)
    || !Array.isArray(rejectedItems)
    || rejectedItems.length !== record.rejectedCount) invalid('learning import');
  const rejected = (rejectedItems as unknown[]).map((entry) => {
    const item = isRecord(entry) ? entry : invalid('learning import rejection');
    if (!text(item.sourceItemId) || !text(item.code) || !text(item.message)) {
      invalid('learning import rejection');
    }
    return item as unknown as LearningImportRejection;
  });
  return { ...record, rejected } as unknown as LearningImportReport;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export async function fetchReviewQueue(targetSlug: string, asOf: string): Promise<ReviewQueue> {
  const query = new URLSearchParams({ targetSlug, asOf });
  return parseReviewQueue(await requestJson(`/api/v1/review/queue?${query}`));
}

export async function rebuildReviewQueue(
  input: { targetSlug: string; asOf: string },
  idempotencyKey: string,
): Promise<ReviewQueue> {
  return parseReviewQueue(await requestJson('/api/v1/review/rebuild', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function deferReviewItem(
  itemId: number,
  input: { dueDate: string; expectedVersion: number },
  idempotencyKey: string,
): Promise<ReviewQueueItem> {
  return parseReviewItem(await requestJson(`/api/v1/review/items/${itemId}/defer`, {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}

export async function importLearningAggregates(
  input: LearningImportInput,
  idempotencyKey: string,
): Promise<LearningImportReport> {
  return parseLearningImportReport(await requestJson('/api/v1/learning/import-aggregates', {
    method: 'POST',
    headers: { ...jsonHeaders, 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  }));
}
