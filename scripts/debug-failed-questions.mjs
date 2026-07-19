import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
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
for (let p = 1; p <= pdf.numPages; p++) pages.push(textItemsToPageText((await (await pdf.getPage(p)).getTextContent()).items));
const text = pages.join('\n\n');
await pdf.cleanup();

const SIMULADO_RE = /(^|\n)\s*(\d{1,2})\s*-\s*\([^)]+\)/giu;
const starts = [...text.matchAll(SIMULADO_RE)].map((m) => ({ n: Number(m[2]), start: (m.index ?? 0) + (m[1]?.length ?? 0) }));

for (const q of [36, 38, 65, 79]) {
  const idx = starts.findIndex((s) => s.n === q);
  const block = text.slice(starts[idx].start, starts[idx + 1]?.start ?? text.length);
  const result = parseObjectiveQuestions(block);
  console.log(`Q${q}: parsed=${result.questions.length} rejected=${result.rejectedBlocks}`);
  if (result.questions[0]) {
    console.log('  alts:', result.questions[0].alternatives.map((a) => a.label).join(','));
  }
}
