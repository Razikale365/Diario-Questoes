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

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].title, 'Atividade 2 - Bloco 1');
  assert.equal(blocks[0].lesson, 'Aula 9 - Versão Original');
  assert.equal(blocks[0].pages, '51 a 63');
  assert.deepEqual(
    blocks[0].questions.map(question => question.number),
    Array.from({ length: 15 }, (_, index) => index + 1)
  );
  assert.equal(blocks[1].title, 'Atividade 2 - Bloco 2');
  assert.equal(blocks[1].pages, '90 a 95');
  assert.deepEqual(
    blocks[1].questions.map(question => question.number),
    Array.from({ length: 10 }, (_, index) => index + 1)
  );
});
