import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLSTask } from './parser';

test('parseLSTask captures bullet ranges after "Resolva as questões:" without breaking activity grouping', () => {
  const text = `Assunto: Balanço de pagamentos.

Atividade 1
Estude a teoria da Aula 9 do PDF Original - Tópico Posição internacional de investimentos até Tópico Principais mudanças no BPM6 (páginas 32 a 49).

Assuntos estudados: Posição internacional de investimentos; Erros e omissões; Relações fundamentais do BP; Saldo em transações correntes e poupança externa; Saldo do BP e ativos de reserva; Contabilização e lançamentos no BP; Principais mudanças do BPM6

Sugestão de descanso, caso seja necessário: 5 a 10 minutos.

Atividade 2
Aula 9 - Versão Original
Resolva as questões:
- 1 a 15 (total de questões: 15) das páginas 51 a 63
- 1 a 10 (total de questões: 10) das páginas 90 a 95
Tempo ideal: 60 minutos.`;

  const blocks = parseLSTask(text).filter(block => !block.isSection);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].title, 'Atividade 1');
  assert.equal(blocks[0].lesson, 'Aula 9');
  assert.equal(blocks[0].pages, '32 a 49');
  assert.equal(blocks[0].questions.length, 0);
  assert.equal(blocks[1].title, 'Atividade 2 - Bloco 1');
  assert.equal(blocks[1].lesson, 'Aula 9 - Versão Original');
  assert.equal(blocks[1].pages, '51 a 63');
  assert.deepEqual(
    blocks[1].questions.map(question => question.number),
    Array.from({ length: 15 }, (_, index) => index + 1)
  );
  assert.equal(blocks[2].title, 'Atividade 2 - Bloco 2');
  assert.equal(blocks[2].pages, '90 a 95');
  assert.deepEqual(
    blocks[2].questions.map(question => question.number),
    Array.from({ length: 10 }, (_, index) => index + 1)
  );
});

test('parseLSTask captures inline LS instructions with lesson, pages and bank', () => {
  const text = `Atividade 1
Aula 12 - Versão Original
Resolva as questões 3, 5 e 7 das páginas 10 a 12. CEBRASPE

Atividade 2
Na Aula 13 - Resolver as questões FCC 1 a 4 das páginas 20 a 22.`;

  const blocks = parseLSTask(text).filter(block => !block.isSection);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, 'Atividade 1');
  assert.equal(blocks[0].lesson, 'Aula 12 - Versão Original');
  assert.equal(blocks[0].bank, 'CEBRASPE');
  assert.equal(blocks[0].pages, '10 a 12');
  assert.deepEqual(blocks[0].questions.map(question => question.number), [3, 5, 7]);
  assert.equal(blocks[1].lesson, 'Aula 13');
  assert.equal(blocks[1].bank, 'FCC');
  assert.deepEqual(blocks[1].questions.map(question => question.number), [1, 2, 3, 4]);
});

test('parseLSTask treats CESPE as CEBRASPE and preserves revision-style blocks', () => {
  const text = `Revisão
- Na Aula 4 - Resolver as questões CESPE 2 a 3 (total: 2 questões) (páginas 44 a 45).`;

  const blocks = parseLSTask(text).filter(block => !block.isSection);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, 'Revisão - Bloco 1 (CEBRASPE)');
  assert.equal(blocks[0].lesson, 'Aula 4');
  assert.equal(blocks[0].bank, 'CEBRASPE');
  assert.equal(blocks[0].pages, '44 a 45');
  assert.deepEqual(blocks[0].questions.map(question => question.number), [2, 3]);
});

test('parseLSTask creates reading blocks from real LS theory-only activities', () => {
  const text = `Atividade 1
- Estude a versão simplificada da teoria da Aula 15 - Assunto "Funções Essenciais À Justiça" até antes de "Questões Comentadas" (páginas 03 a 20)

Sugestão de descanso, caso seja necessário: 05 a 10 minutos.

Atividade 2
- Estude a teoria da Aula 15 do PDF Original - Assunto DIREITO DAS SUCESSÕES até antes do assunto Descendentes e Cônjuges (páginas 03 a 24).`;

  const blocks = parseLSTask(text).filter(block => !block.isSection);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, 'Atividade 1');
  assert.equal(blocks[0].lesson, 'Aula 15 - Funções Essenciais À Justiça');
  assert.equal(blocks[0].pages, '03 a 20');
  assert.equal(blocks[0].questions.length, 0);
  assert.equal(blocks[1].lesson, 'Aula 15 - DIREITO DAS SUCESSÕES');
  assert.equal(blocks[1].pages, '03 a 24');
});
