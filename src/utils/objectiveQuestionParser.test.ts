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
  assert.ok(result.rejectedBlocks > 0);
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
  assert.equal(result.questions[0].number, 1);
  assert.match(result.questions[0].statement, /Sobre a incidência do ICMS/);
  assert.doesNotMatch(result.questions[0].statement, /ALIMENTAÇÃO E BEBIDAS/);
  assert.equal(result.questions[0].answerKey, 'A');
});

test('parseObjectiveQuestions accepts bare and padded question headings (Teste D - Legacy Headings)', () => {
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

    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].number, expectedNumber);
    assert.doesNotMatch(result.questions[0].statement, /^0*\d+\b/);
    assert.match(result.questions[0].statement, expectedStatement);
  }
});

test('parseObjectiveQuestions detects simulado headers with professor tags and ignores page numbers', () => {
  const text = `
3
Direito Tributário
01- (Inédita 7F ontes)
O Estado Alfa editou lei estadual sobre IPVA. Assinale a alternativa correta.
a) constitucional, haja vista que o credor fiduciário responde solidariamente.
b) inconstitucional, pois viola a competência tributária da União.
c) constitucional apenas se houver convênio interestadual.
d) inconstitucional, por usurpar competência municipal.
e) constitucional, desde que previsto em emenda constitucional.

02 - (Inédita 7F ontes)
A sociedade empresária Comercial Aurora Ltda., optante pelo Simples Nacional, questiona a cobrança.
a) correta, pois o Simples exclui todas as contribuições.
b) incorreta, porque o ICMS integra a base do Simples.
c) correta, se a receita bruta for inferior ao limite.
d) incorreta, pois o DIFAL não incide sobre optantes.
e) correta, desde que haja autorização do CONFAZ.

79 - (Inédita 7F ontes)
O quadro a seguir apresenta dados hipotéticos de três países distintos.
Juros Reais Médios (%
a.a.)
Portugal 105 14 2,5 1,8
Considerando-se exclusivamente esses quatro fatores, assinale a alternativa correta.
a) O maior endividamento de Portugal torna esse país o de pior situação.
b) A maturação média da dívida não interfere na avaliação da sustentabilidade fiscal.
c) A Argentina apresenta a melhor situação entre os três países.
d) O crescimento econômico é variável relevante para a avaliação da dívida pública.
e) O Chile, por apresentar a menor relação Dívida/PIB, possui a dívida mais sustentável.
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 3);
  assert.equal(result.questions[0].number, 1);
  assert.match(result.questions[0].statement, /^O Estado Alfa editou lei estadual/);
  assert.doesNotMatch(result.questions[0].statement, /Inédita 7F ontes/);
  assert.equal(result.questions[0].alternatives.length, 5);
  assert.equal(result.questions[1].number, 2);
  assert.equal(result.questions[2].number, 79);
});

test('parseObjectiveQuestions prefers simulado headers even when explicit labels are required', () => {
  const text = `
01- (Inédita 7F ontes)
Sobre ICMS, assinale a alternativa correta.
A) Alternativa incorreta.
B) Alternativa correta.
C) Alternativa incorreta.
D) Alternativa incorreta.
E) Alternativa incorreta.
Gabarito: B
`;

  const result = parseObjectiveQuestions(text, { requireExplicitQuestionLabel: true });

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].number, 1);
  assert.match(result.questions[0].statement, /Sobre ICMS/);
});

// Teste A: Número de página isolado
test('Teste A — Número de página no meio de questão atravessando páginas', () => {
  const text = `
02 - (Inédita 7Fontes)
Enunciado da questão dois que atravessa páginas.
a) Alternativa A.
b) Alternativa B.
c) Alternativa C.

[Pagina 4]
4
d) Alternativa D.
e) Alternativa E.

03 - (Inédita 7Fontes)
Enunciado da questão três.
a) Alternativa A.
b) Alternativa B.
c) Alternativa C.
d) Alternativa D.
e) Alternativa E.
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].number, 2);
  assert.equal(result.questions[0].alternatives.length, 5);
  assert.deepEqual(
    result.questions[0].alternatives.map((a) => a.label),
    ['A', 'B', 'C', 'D', 'E']
  );
  assert.equal(result.questions[1].number, 3);
  assert.equal(result.questions[1].alternatives.length, 5);

  // Certificar-se de que a falsa questão "4" não foi criada
  assert.ok(!result.questions.some((q) => q.number === 4));
});

// Teste B: Listas internas numeradas
test('Teste B — Listas internas em enunciado', () => {
  const text = `
34 - (Inédita 7Fontes)
Sobre o imposto de renda, considere os itens:
1. Primeiro caso.
2. Segundo caso.
3. Terceiro caso.
4. Quarto caso.
Assinale a alternativa correta.
a) Apenas 1 e 2.
b) Apenas 2 e 3.
c) Apenas 3 e 4.
d) Todos estão corretos.
e) Nenhum está correto.

35 - (Inédita 7Fontes)
Próxima questão de teste.
a) Alt A.
b) Alt B.
c) Alt C.
d) Alt D.
e) Alt E.
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].number, 34);
  assert.match(result.questions[0].statement, /Primeiro caso/);
  assert.match(result.questions[0].statement, /Segundo caso/);
  assert.match(result.questions[0].statement, /Terceiro caso/);
  assert.match(result.questions[0].statement, /Quarto caso/);
  assert.equal(result.questions[0].alternatives.length, 5);

  assert.equal(result.questions[1].number, 35);
  assert.equal(result.questions[1].alternatives.length, 5);
});

// Teste C: Datas e Valores no início de linha
test('Teste C — Datas e valores no início de linha', () => {
  const text = `
34 - (Inédita 7Fontes)
Em data específica:
10/09/2026
Foi cobrado o valor de:
500.000,00
Com percentual de 20%
Nos termos do artigo 134 do CTN.
Assinale a opção correta.
a) Alt A.
b) Alt B.
c) Alt C.
d) Alt D.
e) Alt E.
`;

  const result = parseObjectiveQuestions(text);

  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].number, 34);
  assert.match(result.questions[0].statement, /10\/09\/2026/);
  assert.match(result.questions[0].statement, /500\.000,00/);
  assert.match(result.questions[0].statement, /20%/);
  assert.match(result.questions[0].statement, /artigo 134/);
  assert.equal(result.questions[0].alternatives.length, 5);
});
