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

test('stripPdfPageArtifacts removes a physical page number joined to the final alternative', () => {
  const input = [
    'd) Todas as afirmações estão corretas.',
    'e) Apenas a segunda afirmação está correta. 23',
    '12345678901 - NOME DO ALUNO',
  ].join('\n');

  const result = stripPdfPageArtifacts(input, 23);

  assert.equal(
    result,
    'd) Todas as afirmações estão corretas.\ne) Apenas a segunda afirmação está correta.',
  );
});

test('stripPdfPageArtifacts removes content appended after the physical page footer', () => {
  const input = [
    'd) R$ 70.000,00.',
    'e) R$ 78.000,00 24 CONTABILIDADE PÚBLICA',
  ].join('\n');

  const result = stripPdfPageArtifacts(input, 24);

  assert.equal(result, 'd) R$ 70.000,00.\ne) R$ 78.000,00');
});

test('stripPdfPageArtifacts handles an inline final alternative and footer', () => {
  const input =
    'Questão 22 A) Primeira. B) Segunda. C) Terceira. D) Quarta. E) Se VPL < 0, então TIR = i%. 10 ADMINISTRAÇÃO E GOVERNANÇA PÚBLICA';

  const result = stripPdfPageArtifacts(input, 10);

  assert.equal(
    result,
    'Questão 22 A) Primeira. B) Segunda. C) Terceira. D) Quarta. E) Se VPL < 0, então TIR = i%.',
  );
});

test('stripPdfPageArtifacts removes the promotional tail from a final page', () => {
  const input = [
    'e) A opinião não modificada é adequada.',
    '30',
    'O QUE VOCÊ ACHOU DESTE SIMULADO ?',
    'Conte-nos como foi sua experiência ao fazer este simulado.',
    'http://estrategi.ac/assinaturas',
  ].join('\n');

  const result = stripPdfPageArtifacts(input, 30);

  assert.equal(result, 'e) A opinião não modificada é adequada.');
});

test('stripPdfPageArtifacts removes promotion from a continuation page without an E marker', () => {
  const input = [
    'continuação da alternativa final.',
    'O QUE VOCÊ ACHOU DESTE SIMULADO ?',
    'Conte-nos como foi sua experiência ao fazer este simulado.',
  ].join('\n');

  const result = stripPdfPageArtifacts(input, 31);

  assert.equal(result, 'continuação da alternativa final.');
});

test('stripPdfPageArtifacts preserves a terminal number outside an alternatives block', () => {
  const input = 'O benefício está previsto no artigo 23';
  const result = stripPdfPageArtifacts(input, 23);
  assert.equal(result, input);
});

test('stripPdfPageArtifacts removes private course headers, footers and watermarks', () => {
  const input = [
    'Rodadas Avançadas de Simulados para SEFAZ-CE - 16/05/2026',
    'SEFAZ-CE - Rodadas Avançadas de Simulados - (Pós-Edital)',
    '2ª Rodada',
    'Eduardo Da Rocha',
    'www.estrategiaconcursos.com.br',
    '==194fae==',
    'Caderno de Prova',
    'Nome: ___________________________________________',
    '12345678901 - NOME DO ALUNO',
    'A alternativa correta é a letra B.',
  ].join('\n');

  const result = stripPdfPageArtifacts(input, 12);

  assert.equal(result, 'A alternativa correta é a letra B.');
});
