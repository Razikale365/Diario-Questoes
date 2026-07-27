import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQuestionSourceDocumentId,
  loadQuestionSourceDocument,
  saveQuestionSourceDocument,
  type QuestionSourceDocumentRecord,
  type QuestionSourceDocumentStore,
} from './questionSourceDocuments';

class MemoryDocumentStore implements QuestionSourceDocumentStore {
  readonly records = new Map<string, QuestionSourceDocumentRecord>();
  putCount = 0;

  async get(id: string) {
    return this.records.get(id);
  }

  async put(record: QuestionSourceDocumentRecord) {
    this.putCount += 1;
    this.records.set(record.id, record);
  }
}

test('builds a deterministic SHA-256 source document id from the original PDF bytes', async () => {
  const id = await buildQuestionSourceDocumentId(new Uint8Array([1, 2, 3]).buffer);

  assert.equal(
    id,
    'pdf_039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
  );
});

test('stores one byte-preserving record and reuses it when the same PDF is imported again', async () => {
  const store = new MemoryDocumentStore();
  const file = new File([new Uint8Array([1, 2, 3])], 'rodada-02-p1.pdf', {
    type: 'application/pdf',
  });

  const first = await saveQuestionSourceDocument(file, 40, {
    store,
    now: () => '2026-07-25T12:00:00.000Z',
  });
  const second = await saveQuestionSourceDocument(file, 40, {
    store,
    now: () => '2026-07-25T13:00:00.000Z',
  });
  const loaded = await loadQuestionSourceDocument(first.id, store);

  assert.equal(store.putCount, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.importedAt, '2026-07-25T12:00:00.000Z');
  assert.equal(loaded?.fileName, 'rodada-02-p1.pdf');
  assert.equal(loaded?.pageCount, 40);
  assert.deepEqual(Array.from(new Uint8Array(loaded?.data)), [1, 2, 3]);
});

test('returns undefined when a referenced PDF is not present in the local browser store', async () => {
  const store = new MemoryDocumentStore();

  assert.equal(await loadQuestionSourceDocument('pdf_missing', store), undefined);
});
