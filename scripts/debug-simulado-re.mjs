import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const data = new Uint8Array(fs.readFileSync(pdfPath));
const pdf = await pdfjsLib.getDocument({ data }).promise;
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
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const tc = await page.getTextContent();
  pages.push(textItemsToPageText(tc.items));
}
const text = pages.join('\n\n');
await pdf.cleanup();

const SIMULADO_RE = /(^|\n)\s*(\d{1,2})\s*-\s*\([^)]+\)/giu;
const matches = [...text.matchAll(SIMULADO_RE)];
console.log('simulado headers:', matches.length);
const nums = matches.map((m) => Number(m[2]));
console.log('numbers:', [...new Set(nums)].sort((a, b) => a - b).join(', '));
for (let i = 1; i <= 80; i += 1) {
  if (!nums.includes(i)) console.log('missing', i);
}
