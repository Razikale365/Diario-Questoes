import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPdfTextWithLoader } from './pdfTextExtractor';

test('extractPdfTextWithLoader rejects files that are not PDFs', async () => {
  const file = new File(['hello'], 'meta.txt', { type: 'text/plain' });

  await assert.rejects(
    () => extractPdfTextWithLoader(file, async () => []),
    /Selecione um arquivo PDF/i
  );
});

test('extractPdfTextWithLoader combines page text and preserves page numbers', async () => {
  const file = new File(['%PDF-1.7'], 'Meta_37.pdf', { type: 'application/pdf' });

  const result = await extractPdfTextWithLoader(file, async (data) => {
    assert.equal(data instanceof Uint8Array, true);
    return [
      { pageNumber: 1, text: 'Número Disciplina Formato' },
      { pageNumber: 2, text: '1 Economia Exercícios Balanço 00:30 0% Pendente' }
    ];
  });

  assert.equal(result.fileName, 'Meta_37.pdf');
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.pages.map(page => page.pageNumber), [1, 2]);
  assert.match(result.text, /--- Página 1 ---/);
  assert.match(result.text, /--- Página 2 ---/);
  assert.match(result.text, /1 Economia Exercícios Balanço 00:30 0% Pendente/);
});

test('extractPdfTextWithLoader reports empty extracted text clearly', async () => {
  const file = new File(['%PDF-1.7'], 'empty.pdf', { type: 'application/pdf' });

  await assert.rejects(
    () => extractPdfTextWithLoader(file, async () => [{ pageNumber: 1, text: '   ' }]),
    /não trouxe texto legível/i
  );
});
