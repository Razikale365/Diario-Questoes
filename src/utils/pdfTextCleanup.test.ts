import test from 'node:test';
import assert from 'node:assert/strict';
import { stripPdfPageArtifacts } from './pdfTextCleanup';

test('stripPdfPageArtifacts removes page numbers and headers', () => {
  const input = '7FONTES\nQuestao 1\n4\n7FONTES CONCURSOS\nSome other content';
  const result = stripPdfPageArtifacts(input, 4);
  assert.equal(result, 'Questao 1\nSome other content');
});

test('stripPdfPageArtifacts preserves text with numbers inside sentences', () => {
  const input = 'O item 4 é correto.\n7FONTES CONCURSOS\nQuestão 4 (Inédita)';
  const result = stripPdfPageArtifacts(input, 4);
  assert.equal(result, 'O item 4 é correto.\nQuestão 4 (Inédita)');
});
