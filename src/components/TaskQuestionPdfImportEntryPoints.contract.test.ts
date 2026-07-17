import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const appSource = read('../App.tsx');
const blockCardSource = read('./ActivityBlockCard.tsx');
const blockModalSource = read('./BlockEditModal.tsx');
const sectionModalSource = read('./SectionEditModal.tsx');

test('every existing-task surface opens the shared PDF importer', () => {
  assert.match(appSource, /Importar questões/);
  assert.match(blockCardSource, /Importar PDF nesta seção/);
  assert.match(blockCardSource, /Importar PDF neste bloco/);
  assert.match(blockModalSource, /Importar questões/);
  assert.match(sectionModalSource, /Criar e importar questões/);
  assert.match(appSource, /setTaskWorkTab\('questoes'\)/);
  assert.match(appSource, /commitTaskQuestionImport/);
  assert.match(blockCardSource, /onImportQuestionsFromPdf/);
  assert.match(appSource, /openTaskPdfImport[\s\S]*taskId: string/);
  assert.doesNotMatch(blockCardSource, /importObjectiveQuestionsFromPdf/);
  assert.doesNotMatch(blockCardSource, /loadStoredQuestionBank/);
});
