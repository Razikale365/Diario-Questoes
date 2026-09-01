import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentUrl = new URL('./TaskExecutionFields.tsx', import.meta.url);

test('shared execution fields expose the complete LS evidence receipt', () => {
  const source = readFileSync(componentUrl, 'utf8');

  for (const label of [
    'Data realizada',
    'Ontem',
    'Tempo total',
    'Tempo de exercícios',
    'Questões',
    'Certas',
    'Erradas',
    'Dúvidas',
    'Energia depois',
    'Observações',
  ]) {
    assert.equal(source.includes(label), true, `${label} must be rendered by the shared receipt`);
  }
});

test('shared execution fields derive performance from answered counts without accepting manual edits', () => {
  const source = readFileSync(componentUrl, 'utf8');

  assert.equal(source.includes('parseTaskExecutionDraft'), true);
  assert.equal(source.includes('Desempenho derivado'), true);
  assert.equal(source.includes('readOnly'), true);
  assert.equal(source.includes('correctCount'), true);
  assert.equal(source.includes('wrongCount'), true);
});

test('shared execution fields adapt to the modal rail instead of viewport breakpoints', () => {
  const source = readFileSync(componentUrl, 'utf8');
  const stylesheetUrl = new URL('../index.css', import.meta.url);
  const stylesheet = readFileSync(stylesheetUrl, 'utf8');

  assert.equal(source.includes('task-execution-fields__grid'), true);
  assert.equal(source.includes('task-execution-fields__summary'), true);
  assert.equal(source.includes('task-execution-fields__footer'), true);
  assert.equal(source.includes('sm:w-56'), false, 'component must not use viewport breakpoint sm:w-56');
  assert.equal(stylesheet.includes('container-type: inline-size'), true);
  assert.equal(stylesheet.includes('grid-template-columns: repeat(auto-fit, minmax(min(6.5rem, 100%), 1fr))'), true);
  assert.equal(stylesheet.includes('@container (min-width: 35rem)'), true);
  assert.equal(stylesheet.includes('.task-execution-fields__footer'), true);
  assert.match(
    stylesheet,
    /\.task-execution-fields__footer\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*min-width: 0;/s,
  );
  assert.equal(stylesheet.includes('grid-template-columns: minmax(0, 1fr) minmax(15rem, auto)'), true);
});
