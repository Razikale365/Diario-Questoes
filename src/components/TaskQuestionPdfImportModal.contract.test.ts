import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const componentPath = new URL('./TaskQuestionPdfImportModal.tsx', import.meta.url);
const source = readFileSync(componentPath, 'utf8');

test('task question modal exposes PDF and pasted-text safe import flows', () => {
  for (const label of [
    'Arquivo e fonte', 'Destino', 'Prévia', 'Confirmar',
    'Detectadas', 'Rejeitadas', 'No banco', 'Enriquecidas', 'Adicionadas', 'Conflitos',
  ]) {
    assert.match(source, new RegExp(label));
  }
  for (const destination of ['new_section', 'new_block', 'existing_block']) {
    assert.match(source, new RegExp(destination));
  }
  assert.match(source, /importObjectiveQuestionsFromPdf/);
  assert.match(source, /parseObjectiveQuestions/);
  assert.match(source, /Colar texto/);
  assert.match(source, /buildTaskQuestionImportPreview/);
  assert.match(source, /disabled=\{!canConfirm \|\| isCommitting\}/);
  assert.doesNotMatch(source, /value=["']tec["']/);
  assert.doesNotMatch(source, /persistQuestionBank/);
  assert.doesNotMatch(source, /localStorage/);
});
