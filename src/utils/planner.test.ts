import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerTask } from '../types';
import { autoSchedulePlannerTasks, mergePlannerTasks, parseLsMetaText } from './planner';

test('parseLsMetaText extracts current meta summary and task rows', () => {
  const text = `
Meta atual | Meta 6 (#45)
Planejamento SEFAZ CE Experiente
19 disciplinas
29 tarefas
meta iniciada em 26/06/2026
Próxima meta 03/07/2026
Total de Tarefas 29
Quantidade de Matérias 19
Meta Concluída(%) 27%
Tarefas Concluídas 8
Tarefas Pendentes 21
Tarefas Ignoradas 0
Tarefas Iniciadas 0

Número Disciplina Formato Descrição Tempo Tarefa Desempenho Status Avaliação Relevância Ver
1 Português Revisão e Exercícios Todo conteúdo p... 00:00 0% Pendente   10
8 Direito Financeiro Revisão e Exercícios Lei nº 4.320, d... 01:00 80% Concluído   7
13 Direito Tributário - Reforma Tributária Lei Seca Arts. 97 a 104... 01:00 0% Concluído   10
17 Fluencia de dados Teórico e Exercícios Governança e Ét... 00:00 0% Pendente   10
`;

  const result = parseLsMetaText(text, 'ls-meta-text');

  assert.equal(result.meta.metaNumber, 45);
  assert.equal(result.meta.title, 'Meta 6 (#45)');
  assert.equal(result.meta.planejamento, 'SEFAZ CE Experiente');
  assert.equal(result.meta.totalTasks, 29);
  assert.equal(result.meta.totalDisciplines, 19);
  assert.equal(result.tasks.length, 4);
  assert.equal(result.tasks[0].discipline, 'Português');
  assert.equal(result.tasks[0].format, 'Revisão e Exercícios');
  assert.equal(result.tasks[0].status, 'pending');
  assert.equal(result.tasks[0].estimatedMinutes, 60);
  assert.equal(result.tasks[1].spentMinutes, 60);
  assert.equal(result.tasks[1].performance, 80);
  assert.equal(result.tasks[2].discipline, 'Direito Tributário - Reforma Tributária');
  assert.equal(result.tasks[2].format, 'Lei Seca');
});

test('parseLsMetaText extracts detailed LS PDF task sections with instructions and tips', () => {
  const text = `
META 7 (SEFAZ CE Experiente)
04/07/2026
Referência interna #1
META 46

29) Legis. Tribut. Estadual (ICMS)
Material indicado:  TEC Concursos + Seus resumos e materiais.
Assunto(s):  Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)
Relevância:  10

Assuntos:
Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)

Atividade 1
- Leitura dos Arts. 01 ao 06 da Lei 18.665/2023

Atividade 2
SEFAZ-CE: CURSO DE QUESTÕES INÉDITAS DE LTE PARA SEFAZ CE - Professor Raphael Sena
- Clique em Aula 03 - Lei 18.665/2023
- Realize as 15 questões presentes nesta bateria de exercícios
OU
- Resolva as questões 1 a 48 (total de questões: 48) - tempo ideal: 80 minutos.
Nome do Caderno: LS - LTE - SEFAZ CE - PÓS EDITAL - CADERNO 11
Link do caderno de questões: https://www.tecconcursos.com.br/s/Q6XHkN
Obs: Lembrando que estas questões você provavelmente já realizou nas tarefas anteriores.

ART. 2.º, LEI 18.665/2023
O artigo 2.º da Lei 18.665/2023 estabelece as hipóteses de incidência do ICMS.

ALERTAS DE PROVA — PEGADINHAS E DETALHES LITERAIS
1. ALIMENTAÇÃO E BEBIDAS = MERCADORIA, NÃO SERVIÇO

ONDE A FCC PODE CRIAR QUESTÕES
- Qual é o campo de incidência do ICMS segundo o art. 2.º da Lei 18.665/2023?
`;

  const result = parseLsMetaText(text, 'ls-meta-pdf');

  assert.equal(result.meta.metaNumber, 46);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].number, 29);
  assert.equal(result.tasks[0].discipline, 'Legis. Tribut. Estadual (ICMS)');
  assert.equal(result.tasks[0].description, 'Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)');
  assert.equal(result.tasks[0].relevance, 10);
  assert.equal(result.tasks[0].durationMinutes, 80);
  assert.match(result.tasks[0].details || '', /Aula 03 - Lei 18\.665\/2023/);
  assert.match(result.tasks[0].details || '', /CADERNO 11/);
  assert.doesNotMatch(result.tasks[0].details || '', /ALERTAS DE PROVA/);
  assert.match(result.tasks[0].tips || '', /ART\. 2\.º, LEI 18\.665\/2023/);
  assert.match(result.tasks[0].tips || '', /ONDE A FCC PODE CRIAR QUESTÕES/);
});

const makeTask = (overrides: Partial<PlannerTask>): PlannerTask => ({
  id: overrides.id || crypto.randomUUID(),
  number: overrides.number || 1,
  discipline: overrides.discipline || 'Direito Financeiro',
  format: overrides.format || 'Revisão e Exercícios',
  description: overrides.description || 'Lei 4.320',
  spentMinutes: 0,
  estimatedMinutes: 60,
  performance: null,
  status: overrides.status || 'pending',
  relevance: overrides.relevance || 8,
  durationMinutes: overrides.durationMinutes || 60,
  source: 'manual',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

test('autoSchedulePlannerTasks skips archived tasks', () => {
  const result = autoSchedulePlannerTasks(
    [
      makeTask({ id: 'active-task', number: 1, status: 'pending' }),
      makeTask({ id: 'archived-task', number: 2, status: 'archived' }),
    ],
    {
      maxTasksPerDay: 2,
      maxMinutesPerDay: 180,
      startTime: '08:00',
      availableWeekdays: [1, 2, 3, 4, 5],
      monthDate: new Date('2026-07-01T00:00:00'),
      startDate: new Date('2026-07-01T00:00:00'),
    }
  );

  assert.equal(result.find((task) => task.id === 'active-task')?.scheduledDate, '2026-07-01');
  assert.equal(result.find((task) => task.id === 'archived-task')?.scheduledDate, undefined);
});

test('autoSchedulePlannerTasks starts at the requested date inside the visible month', () => {
  const result = autoSchedulePlannerTasks(
    [
      makeTask({ id: 'first-task', number: 1, status: 'pending' }),
      makeTask({ id: 'second-task', number: 2, status: 'pending' }),
    ],
    {
      maxTasksPerDay: 1,
      maxMinutesPerDay: 180,
      startTime: '08:00',
      availableWeekdays: [1, 2, 3, 4, 5, 6],
      monthDate: new Date('2026-07-01T00:00:00'),
      startDate: new Date('2026-07-04T00:00:00'),
    }
  );

  assert.equal(result.find((task) => task.id === 'first-task')?.scheduledDate, '2026-07-04');
  assert.equal(result.find((task) => task.id === 'second-task')?.scheduledDate, '2026-07-06');
});

test('mergePlannerTasks refreshes reimported task details by meta and number without losing the calendar slot', () => {
  const existing = makeTask({
    id: 'old-task-29',
    number: 29,
    metaNumber: 46,
    description: 'Lei 18.665 antiga',
    scheduledDate: '2026-07-06',
    startTime: '09:15',
    linkedStudyTaskId: 'study-task-29',
  });
  const incoming = makeTask({
    id: 'new-parser-task-29',
    number: 29,
    metaNumber: 46,
    description: 'Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)',
    details: 'Atividade 2 - Aula 03',
    tips: 'ART. 2.º, LEI 18.665/2023',
  });

  const result = mergePlannerTasks([existing], [incoming]);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'old-task-29');
  assert.equal(result[0].description, 'Lei 18.665/2023 - Arts. 01 ao 06 (Revisão)');
  assert.equal(result[0].details, 'Atividade 2 - Aula 03');
  assert.equal(result[0].tips, 'ART. 2.º, LEI 18.665/2023');
  assert.equal(result[0].scheduledDate, '2026-07-06');
  assert.equal(result[0].startTime, '09:15');
  assert.equal(result[0].linkedStudyTaskId, 'study-task-29');
});
