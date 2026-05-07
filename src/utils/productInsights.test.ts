import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeImportText, extractIdealMinutes, summarizeTask } from './productInsights';
import { StudyTask } from '../types';

test('analyzeImportText marks LS activity lines as recognized and free text as ignored', () => {
  const result = analyzeImportText(`Assunto: Balanço de pagamentos.

Atividade 2
Aula 9 - Versão Original
Resolva as questões:
- 1 a 15 (total de questões: 15) das páginas 51 a 63
Texto solto sem padrão`);

  assert.equal(result.recognizedLines.length >= 4, true);
  assert.equal(result.ignoredLines.some(line => line.text.includes('Texto solto')), true);
  assert.equal(result.blocks[0].lesson, 'Aula 9 - Versão Original');
  assert.equal(result.totalQuestions, 15);
});

test('extractIdealMinutes reads LS ideal time text', () => {
  assert.equal(extractIdealMinutes('Tempo ideal: 60 minutos.'), 60);
  assert.equal(extractIdealMinutes('tempo ideal de 1h30'), 90);
  assert.equal(extractIdealMinutes('Atividade Extra (Facultativa) - Estimativa de tempo: 15 minutos'), 15);
});

test('analyzeImportText recognizes LS theory-only study lines', () => {
  const result = analyzeImportText(`Atividade 1
- Estude a teoria da Aula 15 do PDF Original - Assunto DIREITO DAS SUCESSÕES até antes do assunto Descendentes e Cônjuges (páginas 03 a 24).`);

  assert.equal(result.blocks.filter(block => !block.isSection).length, 1);
  assert.equal(result.recognizedLines.some(line => /Estude a teoria/.test(line.text)), true);
});

test('summarizeTask returns performance, timing and weakest topics', () => {
  const task: StudyTask = {
    id: 't1',
    date: '2026-05-07T10:00:00.000Z',
    discipline: 'Economia',
    bank: 'Outra',
    status: 'completed',
    elapsedSeconds: 3900,
    idealMinutes: 60,
    blocks: [
      {
        id: 'b1',
        title: 'Aula 1',
        lesson: 'Setor externo',
        pages: '10 a 20',
        questions: [
          { number: 1, answer: 'A', isCorrect: true, hasDoubt: false },
          { number: 2, answer: 'B', isCorrect: false, hasDoubt: true }
        ]
      },
      {
        id: 'b2',
        title: 'Aula 2',
        lesson: 'BP',
        pages: '',
        questions: [
          { number: 3, answer: 'C', isCorrect: false, hasDoubt: false }
        ]
      }
    ]
  };

  const summary = summarizeTask(task);

  assert.equal(summary.totalQuestions, 3);
  assert.equal(summary.correct, 1);
  assert.equal(summary.errors, 2);
  assert.equal(summary.doubts, 1);
  assert.equal(summary.timeDeltaSeconds, 300);
  assert.equal(summary.weakTopics[0].lesson, 'BP');
});
