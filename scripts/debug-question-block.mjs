import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const qNum = Number(process.argv[3] || 79);
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

const re = new RegExp(`(^|\\n)\\s*${qNum}\\s*-\\s*\\([^)]+\\)`, 'giu');
const m = re.exec(text);
const start = (m.index ?? 0) + (m[1]?.length ?? 0);
const nextRe = new RegExp(`\\n${qNum + 1}\\s*-\\s*\\(`, 'u');
const next = nextRe.exec(text.slice(start));
console.log(text.slice(start, next ? start + next.index : start + 4000));
