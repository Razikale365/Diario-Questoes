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
  assert.match(blockCardSource, /Importar questões nesta seção \(PDF ou texto\)/);
  assert.match(blockCardSource, /Importar questões neste bloco \(PDF ou texto\)/);
  assert.match(blockModalSource, /Importar questões neste bloco \(PDF ou texto\)/);
  assert.match(sectionModalSource, /Criar e importar questões \(PDF ou texto\)/);
  assert.match(appSource, /setTaskWorkTab\('questoes'\)/);
  assert.match(appSource, /commitTaskQuestionImport/);
  assert.match(blockCardSource, /onImportQuestionsFromPdf/);
  assert.match(appSource, /openTaskPdfImport[\s\S]*taskId: string/);
  assert.doesNotMatch(blockCardSource, /importObjectiveQuestionsFromPdf/);
  assert.doesNotMatch(blockCardSource, /loadStoredQuestionBank/);
});

test('gabarito actions retain the exact task identity for current and history views', () => {
  assert.match(appSource, /const \[gabaritoModal, setGabaritoModal\] = useState<\{[\s\S]*taskId: string;[\s\S]*blockId: string;/);
  assert.match(appSource, /onImportGabarito=\{\(blockId\) => setGabaritoModal\(\{ taskId: activeTask\.id, blockId \}\)\}/);
  assert.match(appSource, /onImportGabarito=\{\(blockId\) => setGabaritoModal\(\{ taskId: viewingTask\.id, blockId \}\)\}/);
  assert.match(appSource, /importGabarito\(gabaritoModal\.taskId, gabaritoModal\.blockId, answers\)/);
  assert.doesNotMatch(appSource, /importGabarito\(activeTaskId \|\| viewingTaskId/);
});
