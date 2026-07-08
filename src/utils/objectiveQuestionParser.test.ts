import test from 'node:test';
import assert from 'node:assert/strict';

import { parseObjectiveQuestions } from './objectiveQuestionParser';

test('parseObjectiveQuestions captures statements, alternatives, and inline answer keys', () => {
  const text = `
Questao 1
(FCC - 2024) Sobre controle de constitucionalidade, assinale a alternativa correta.
A) O controle difuso ocorre apenas no Senado Federal.
B) O controle concentrado pode ocorrer por ADI.
C) A cláusula de reserva de plenário tem relação com declaração de inconstitucionalidade.
D) O controle preventivo é sempre judicial.
E) A súmula vinculante substitui a Constituição.
Gabarito: C

Comentario do professor:
Texto explicativo que nao deve entrar no banco.

Questão 2
(FGV - 2023) Acerca da receita pública, assinale a opção incorreta.
a) Receita originária decorre de exploração patrimonial.
b) Receita derivada decorre do poder de império.
c) Tributos são receitas derivadas.
d) Operações de crédito nunca ingressam no orçamento.
e) Taxas são espécie tributária.
Resposta: D
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].number, 1);
  assert.equal(result.questions[0].bank, 'FCC');
  assert.equal(result.questions[0].year, 2024);
  assert.equal(result.questions[0].answerKey, 'C');
  assert.equal(result.questions[0].alternatives.length, 5);
  assert.match(result.questions[0].statement, /controle de constitucionalidade/);
  assert.doesNotMatch(result.questions[0].statement, /Texto explicativo/);

  assert.equal(result.questions[1].number, 2);
  assert.equal(result.questions[1].bank, 'FGV');
  assert.equal(result.questions[1].answerKey, 'D');
  assert.equal(result.questions[1].alternatives[0].label, 'A');
});

test('parseObjectiveQuestions rejects didactic numbered content without objective alternatives', () => {
  const text = `
1. Controle de constitucionalidade no Brasil
O controle pode ser politico ou judicial.

2. Controle difuso
Este topico explica teoria e nao contem alternativas.
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 0);
  assert.equal(result.rejectedBlocks, 2);
});

test('parseObjectiveQuestions can require explicit question labels for professor PDFs', () => {
  const text = `
Lei 18.665/2023
Art. 2.º O ICMS incide sobre operações relativas à circulação de mercadorias.
1. ALIMENTAÇÃO E BEBIDAS = MERCADORIA, NÃO SERVIÇO
2. IMPORTAÇÃO — QUALQUER PESSOA, QUALQUER FINALIDADE

Questão 1
Sobre a incidência do ICMS na Lei 18.665/2023, assinale a alternativa correta.
A) Incide sobre fornecimento de alimentação e bebidas.
B) Não incide sobre comunicação.
C) Nunca incide na importação por pessoa física.
D) Energia elétrica não é mercadoria.
E) DIFAL não alcança consumidor final.
Gabarito: A
`;

  const result = parseObjectiveQuestions(text, { requireExplicitQuestionLabel: true });

  assert.equal(result.questions.length, 1);
  assert.equal(result.rejectedBlocks, 0);
  assert.equal(result.questions[0].number, 1);
  assert.match(result.questions[0].statement, /Sobre a incidência do ICMS/);
  assert.doesNotMatch(result.questions[0].statement, /ALIMENTAÇÃO E BEBIDAS/);
  assert.equal(result.questions[0].answerKey, 'A');
});

test('parseObjectiveQuestions accepts bare and padded question headings', () => {
  const cases = [
    {
      heading: '02 (INÉDITAS - PROFESSOR) Sobre benefícios fiscais, assinale a alternativa correta.',
      expectedNumber: 2,
      expectedStatement: /Sobre benefícios fiscais/,
    },
    {
      heading: '002 Sobre importação de máquinas, assinale a alternativa correta.',
      expectedNumber: 2,
      expectedStatement: /^Sobre importação/,
    },
    {
      heading: 'Questão 002\nSobre contribuições, assinale a alternativa correta.',
      expectedNumber: 2,
      expectedStatement: /^Sobre contribuições/,
    },
    {
      heading: '3 - Sobre exportação, assinale a alternativa correta.',
      expectedNumber: 3,
      expectedStatement: /^Sobre exportação/,
    },
  ];

  for (const { heading, expectedNumber, expectedStatement } of cases) {
    const result = parseObjectiveQuestions(`
${heading}
A) Alternativa incorreta.
B) Alternativa correta.
C) Alternativa incorreta.
D) Alternativa incorreta.
E) Alternativa incorreta.
Gabarito: B
`);

    assert.equal(result.rejectedBlocks, 0);
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].number, expectedNumber);
    assert.doesNotMatch(result.questions[0].statement, /^0*\d+\b/);
    assert.match(result.questions[0].statement, expectedStatement);
  }
});
