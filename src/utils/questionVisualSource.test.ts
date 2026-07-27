import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachQuestionSourcePages,
  isLikelyVisualQuestion,
} from './questionVisualSource';

const question = (number: number, statement: string, sourcePageNumber?: number) => ({
  localId: `q-${number}`,
  number,
  sourcePageNumber,
  statement,
  alternatives: [
    { label: 'A', text: 'Alternativa A' },
    { label: 'B', text: 'Alternativa B' },
    { label: 'C', text: 'Alternativa C' },
    { label: 'D', text: 'Alternativa D' },
    { label: 'E', text: 'Alternativa E' },
  ],
});

test('flags table, chart, figure, statement and balance-sheet wording as visual source candidates', () => {
  assert.equal(isLikelyVisualQuestion(question(1, 'O quadro a seguir apresenta quatro processos.')), true);
  assert.equal(isLikelyVisualQuestion(question(2, 'Observe o gráfico da evolução da receita.')), true);
  assert.equal(isLikelyVisualQuestion(question(3, 'Com base na figura, assinale a alternativa.')), true);
  assert.equal(isLikelyVisualQuestion(question(4, 'A demonstração do resultado contém os valores abaixo.')), true);
  assert.equal(isLikelyVisualQuestion(question(5, 'Sobre competência tributária, assinale a correta.')), false);
});

test('attaches immutable local PDF page references only when the parser found a source page', () => {
  const questions = [
    question(66, 'O quadro a seguir apresenta processos judiciais.', 33),
    question(67, 'Sobre provisões, assinale a correta.', 33),
    question(68, 'Questão sem marcador de página.'),
  ];

  const attached = attachQuestionSourcePages(questions, 'pdf_abc123');

  assert.notEqual(attached, questions);
  assert.deepEqual(attached.map((item) => item.sourcePage), [
    { documentId: 'pdf_abc123', pageNumber: 33, likelyVisual: true },
    { documentId: 'pdf_abc123', pageNumber: 33, likelyVisual: false },
    undefined,
  ]);
  assert.equal('sourcePage' in questions[0], false);
});
