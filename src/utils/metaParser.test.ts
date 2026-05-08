import test from 'node:test';
import assert from 'node:assert/strict';

import { createTasksFromMetaDrafts, parseMetaText } from './metaParser';

test('parseMetaText detects LS meta table rows with discipline, format, description, time and status', () => {
  const text = `CALENDÁRIO DAS TAREFAS
Número Disciplina Formato Descrição Tempo Tarefa Desempenho Status
1 Direito Tributário Revisão Revisão Intermediária - Introdução ao Direito Tributário 00:00 0% Pendente
2 Contabilidade Geral Revisão e Exercícios Estoque e critérios de avaliação 01:00 85% Concluído
3 Tecnologia da Informação Revisão e Exercícios Análise de Informações 00:15 100% Concluído`;

  const result = parseMetaText(text);

  assert.equal(result.drafts.length, 3);
  assert.equal(result.drafts[0].numero, '1');
  assert.equal(result.drafts[0].discipline, 'Direito Tributário');
  assert.equal(result.drafts[0].formato, 'Revisão');
  assert.equal(result.drafts[0].descricao, 'Revisão Intermediária - Introdução ao Direito Tributário');
  assert.equal(result.drafts[0].tempoEstimadoMinutos, 0);
  assert.equal(result.drafts[0].statusOrigem, 'pendente');
  assert.equal(result.drafts[1].tempoEstimadoMinutos, 60);
  assert.equal(result.drafts[2].tempoEstimadoMinutos, 15);
  assert.equal(result.summary.totalEstimatedMinutes, 75);
});

test('parseMetaText preserves descriptions broken across extracted PDF lines', () => {
  const text = `6 Economia Teórico e Exercícios Balanço de paga
mentos e posição internacional de investimentos 01:30 0% Pendente
7 Direito Tributário - Reforma Tributária Lei seca e exercícios Título II - DO SISTEMA TRIBUTÁRIO 02:00 0% Concluído`;

  const result = parseMetaText(text);

  assert.equal(result.drafts.length, 2);
  assert.equal(result.drafts[0].discipline, 'Economia');
  assert.equal(result.drafts[0].descricao, 'Balanço de pagamentos e posição internacional de investimentos');
  assert.equal(result.drafts[0].tempoEstimadoMinutos, 90);
  assert.equal(result.drafts[1].discipline, 'Direito Tributário - Reforma Tributária');
  assert.equal(result.drafts[1].formato, 'Lei seca e exercícios');
});

test('parseMetaText ignores orientation and calendar text that is not a task row', () => {
  const text = `ORIENTAÇÕES INICIAIS - PLANEJAMENTO PERSONALIZADO LS CONCURSOS
Querido(a) aluno(a), leia com atenção e conte conosco.
O Calendário das Tarefas serve para você organizar o seu cronograma.
Legenda: Concluída Pendente Ignoradas Iniciada
10 Raciocínio Lógico Exercícios Raciocínio Crítico 00:00 0% Pendente`;

  const result = parseMetaText(text);

  assert.equal(result.drafts.length, 1);
  assert.equal(result.ignoredLines.length >= 3, true);
  assert.equal(result.drafts[0].numero, '10');
  assert.equal(result.drafts[0].discipline, 'Raciocínio Lógico');
});

test('parseMetaText detects detailed numbered task sections extracted from Meta PDFs', () => {
  const text = `.  3) Estatística  Material indicado: Curso Regular para Área Fiscal. Assunto(s): Assimetria e Curtose  Assuntos: - Momentos de uma Distribuição de Frequência - Assimetria - Curtose Atividade 1 - Estude a teoria da Aula 05 do PDF Simplificado - Assunto Momentos de uma Distribuição de Frequência até Assunto Curtose (páginas 3 a 13). Sugestão de descanso, caso seja necessário: 05 a 10 minutos. Atividade 2 - Resolva a questão 1 da página 46 - Resolva as questões 1 a 7 das páginas 48 a 51 - Resolva as questões 1 e 7 das páginas 55 a 57 (total: 15 questões) O tempo ideal de resolução é de 45 minutos.
.  4) Direito Constitucional  Material indicado: Curso Básico. Assunto(s): Administração Pública. Disposições gerais, servidores públicos. Atividade 1 - Estude a versão simplificada da teoria da Aula 10 - Assunto "ADMINISTRAÇÃO PÚBLICA" até antes de "Remuneração dos servidores públicos:" (páginas 03 a 23)`;

  const result = parseMetaText(text);

  assert.equal(result.drafts.length, 2);
  assert.equal(result.drafts[0].numero, '3');
  assert.equal(result.drafts[0].discipline, 'Estatística');
  assert.equal(result.drafts[0].formato, 'Teórico e Exercícios');
  assert.equal(result.drafts[0].descricao, 'Assimetria e Curtose');
  assert.equal(result.drafts[0].tempoEstimadoMinutos, 45);
  assert.equal(result.drafts[0].blocks.filter(block => !block.isSection).length >= 1, true);
  assert.equal(result.drafts[1].numero, '4');
  assert.equal(result.drafts[1].discipline, 'Direito Constitucional');
  assert.equal(result.drafts[1].formato, 'Teórico');
  assert.equal(result.drafts[1].descricao, 'Administração Pública. Disposições gerais, servidores públicos.');
});

test('parseMetaText prefers detailed sections over summary rows for the same task number', () => {
  const text = `1 Português Revisão Ortografia oficial. Acentuação gráfica. 02:00 0% Pendente
.  1) Português Material indicado: Curso. Assunto(s): Ortografia oficial. Acentuação gráfica. Atividade 1: Resolva as questões 01 a 24 (total de questões: 24) - tempo ideal: 48 minutos.`;

  const result = parseMetaText(text);

  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].tempoEstimadoMinutos, 48);
  assert.equal(result.drafts[0].blocks.some(block => block.questions.length === 24), true);
});

test('createTasksFromMetaDrafts converts selected drafts into StudyTask shells with default blocks', () => {
  const result = parseMetaText(`14 Economia Revisão e Exercícios Revisão intermediária - Balanço de pagamentos 00:45 0% Pendente`);

  const tasks = createTasksFromMetaDrafts(result.drafts, {
    planejamento: 'Planejamento Iniciante Fiscal [115852]',
    meta: '37',
    bank: 'CEBRASPE',
    selectedDraftIds: [result.drafts[0].id],
    now: '2026-05-07T12:00:00.000Z',
    idFactory: () => 'task-1'
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, 'task-1');
  assert.equal(tasks[0].planejamento, 'Planejamento Iniciante Fiscal [115852]');
  assert.equal(tasks[0].meta, '37');
  assert.equal(tasks[0].tarefa, '14');
  assert.equal(tasks[0].discipline, 'Economia');
  assert.equal(tasks[0].bank, 'CEBRASPE');
  assert.equal(tasks[0].assunto, 'Revisão intermediária - Balanço de pagamentos');
  assert.equal(tasks[0].idealMinutes, 45);
  assert.equal(tasks[0].status, 'in_progress');
  assert.equal(tasks[0].blocks.length, 1);
  assert.equal(tasks[0].blocks[0].title, 'Revisão e Exercícios');
  assert.equal(tasks[0].blocks[0].lesson, 'Revisão intermediária - Balanço de pagamentos');
  assert.equal(tasks[0].blocks[0].questions.length, 0);
});
