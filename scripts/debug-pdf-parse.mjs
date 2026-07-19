import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseObjectiveQuestions } from '../src/utils/objectiveQuestionParser.ts';

const pdfPath = process.argv[2];
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

const textItemsToPageText = (items) => {
  const lines = [];
  let currentLine = [];
  let previousY = null;
  const flushLine = () => {
    const line = currentLine.join(' ').replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
    currentLine = [];
  };
  for (const item of items) {
    const value = item.str?.trim();
    if (!value) continue;
    const y = item.transform?.[5];
    if (typeof y === 'number' && previousY !== null && Math.abs(y - previousY) > 2.5) flushLine();
    currentLine.push(value);
    previousY = typeof y === 'number' ? y : previousY;
    if (item.hasEOL) flushLine();
  }
  flushLine();
  return lines.join('\n');
};

const pages = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const pageText = textItemsToPageText(textContent.items);
  if (pageText) pages.push(`[Pagina ${pageNumber}]\n${pageText}`);
}

const text = pages.join('\n\n');
await pdf.cleanup();

for (const requireExplicit of [false, true]) {
  const result = parseObjectiveQuestions(text, { requireExplicitQuestionLabel: requireExplicit });
  console.log(`\n=== requireExplicitQuestionLabel=${requireExplicit} ===`);
  console.log('questions:', result.questions.length);
  console.log('rejectedBlocks:', result.rejectedBlocks);
  if (result.questions.length > 0) {
    console.log('first:', result.questions[0].number, result.questions[0].statement.slice(0, 80));
    console.log('last:', result.questions[result.questions.length - 1].number, result.questions[result.questions.length - 1].statement.slice(0, 80));
    const nums = result.questions.map((q) => q.number);
    const missing = [];
    for (let i = 1; i <= 80; i += 1) if (!nums.includes(i)) missing.push(i);
    console.log('missing numbers (1-80):', missing.slice(0, 20), missing.length > 20 ? `... +${missing.length - 20}` : '');
    const bad = result.questions.filter((q) => q.alternatives.length < 4);
    console.log('questions with <4 alts:', bad.length);
  }
}
