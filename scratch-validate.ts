import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { stripPdfPageArtifacts } from './src/utils/pdfTextCleanup';
import { parseObjectiveQuestions } from './src/utils/objectiveQuestionParser';

const pdfPath = 'C:\\Users\\JP\\Downloads\\simulado-02-conhecimentos-especificos-1vmmJky9.pdf';

const run = async () => {
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF file not found at: ${pdfPath}`);
    process.exit(1);
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    
    const items = textContent.items;
    const lines: string[] = [];
    let currentLine: string[] = [];
    let previousY: number | null = null;

    const flushLine = () => {
      const line = currentLine.join(' ').replace(/\s+/g, ' ').trim();
      if (line) lines.push(line);
      currentLine = [];
    };

    for (const item of items) {
      const value = item.str?.trim();
      if (!value) continue;

      const y = item.transform?.[5];
      if (typeof y === 'number' && previousY !== null && Math.abs(y - previousY) > 2.5) {
        flushLine();
      }

      currentLine.push(value);
      previousY = typeof y === 'number' ? y : previousY;

      if (item.hasEOL) flushLine();
    }

    flushLine();
    const pageText = lines.join('\n');
    if (pageText) {
      const cleaned = stripPdfPageArtifacts(pageText, pageNumber);
      if (cleaned.trim()) {
        pages.push(`[Pagina ${pageNumber}]\n${cleaned}`);
      }
    }
  }

  const rawText = pages.join('\n\n');
  const result = parseObjectiveQuestions(rawText);

  console.log('--- RESULTADO DA VALIDAÇÃO ---');
  console.log(`Páginas do PDF: ${pdf.numPages}`);
  console.log(`Total de questões parseadas: ${result.questions.length}`);
  console.log(`Blocos rejeitados: ${result.rejectedBlocks}`);
  
  if (result.diagnostics) {
    console.log(`Diagnósticos:`);
    console.log(`- Duplicados: [${result.diagnostics.duplicateNumbers.join(', ')}]`);
    console.log(`- Ausentes: [${result.diagnostics.missingNumbers.join(', ')}]`);
    console.log(`- Fora de ordem: [${result.diagnostics.outOfOrderNumbers.join(', ')}]`);
    console.log(`- Blocos rejeitados total: ${result.diagnostics.rejectedBlockCount}`);
  }

  const countMatch = result.questions.length === 80;
  const numbers = result.questions.map(q => q.number);
  const consecutive = numbers.every((num, idx) => idx === 0 || num === numbers[idx - 1] + 1);
  const noDuplicates = result.diagnostics ? result.diagnostics.duplicateNumbers.length === 0 : true;
  const noGaps = result.diagnostics ? result.diagnostics.missingNumbers.length === 0 : true;

  console.log('\n--- RELATÓRIO DE CRITÉRIOS DE ACEITE ---');
  console.log(`[${countMatch ? 'OK' : 'FALHA'}] Exatamente 80 questões (Encontradas: ${result.questions.length})`);
  console.log(`[${consecutive && numbers[0] === 1 && numbers[79] === 80 ? 'OK' : 'FALHA'}] Sequência de 1 a 80`);
  console.log(`[${noDuplicates ? 'OK' : 'FALHA'}] Nenhuma duplicidade`);
  console.log(`[${noGaps ? 'OK' : 'FALHA'}] Nenhuma lacuna`);

  const q2 = result.questions.find(q => q.number === 2);
  const q10 = result.questions.find(q => q.number === 10);
  const q34 = result.questions.find(q => q.number === 34);
  const q35 = result.questions.find(q => q.number === 35);

  console.log(`\nQuestão 2: ${q2 ? 'Encontrada' : 'NÃO ENCONTRADA'}`);
  if (q2) {
    console.log(`- Alternativas (${q2.alternatives.length}): ${q2.alternatives.map(a => a.label).join(', ')}`);
  }
  console.log(`Questão 10: ${q10 ? 'Encontrada' : 'NÃO ENCONTRADA'}`);
  console.log(`Questão 34: ${q34 ? 'Encontrada' : 'NÃO ENCONTRADA'}`);
  if (q34) {
    console.log(`- Alternativas (${q34.alternatives.length}): ${q34.alternatives.map(a => a.label).join(', ')}`);
    console.log(`- Possui lista interna 1-4 no statement? ${q34.statement.includes('1.') && q34.statement.includes('2.') ? 'Sim' : 'Não'}`);
  }
  console.log(`Questão 35: ${q35 ? 'Encontrada' : 'NÃO ENCONTRADA'}`);

  await pdf.cleanup();
};

run().catch(console.error);
