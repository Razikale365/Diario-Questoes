import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// inline patched parser logic for quick test
import { parseObjectiveQuestions } from '../src/utils/objectiveQuestionParser.ts';

const pdfPath = process.argv[2];
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;
const textItemsToPageText = (items) => {
  const lines = []; let currentLine = []; let previousY = null;
  const flushLine = () => { const line = currentLine.join(' ').replace(/\s+/g, ' ').trim(); if (line) lines.push(line); currentLine = []; };
  for (const item of items) {
    const value = item.str?.trim(); if (!value) continue;
    const y = item.transform?.[5];
    if (typeof y === 'number' && previousY !== null && Math.abs(y - previousY) > 2.5) flushLine();
    currentLine.push(value); previousY = typeof y === 'number' ? y : previousY;
    if (item.hasEOL) flushLine();
  }
  flushLine(); return lines.join('\n');
};
const pages = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  pages.push(textItemsToPageText((await page.getTextContent()).items));
}
const text = pages.join('\n\n');
await pdf.cleanup();

const result = parseObjectiveQuestions(text);
console.log('questions', result.questions.length, 'rejected', result.rejectedBlocks);
if (result.questions.length) {
  console.log('Q1 stmt:', result.questions[0].statement.slice(0, 100));
  console.log('Q1 alts:', result.questions[0].alternatives.map(a => a.label).join(','));
  console.log('Q80 stmt:', result.questions[79]?.statement?.slice(0, 100));
}
