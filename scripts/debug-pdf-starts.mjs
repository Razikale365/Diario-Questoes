import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

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

const QUESTION_START_RE = /(^|\n)\s*(?:(?:quest(?:ão|ao)|q)\s*)?(\d{1,4})\s*(?:[.)\-–:]|\b)/giu;
const starts = Array.from(text.matchAll(QUESTION_START_RE)).map((match) => ({
  start: (match.index ?? 0) + (match[1]?.length ?? 0),
  number: Number(match[2]),
  context: text.slice(match.index ?? 0, (match.index ?? 0) + 80).replace(/\n/g, '\\n'),
}));

console.log('Total starts:', starts.length);
console.log('\nUnique numbers:', [...new Set(starts.map((s) => s.number))].sort((a,b)=>a-b).join(', '));

const byNumber = new Map();
for (const s of starts) {
  if (!byNumber.has(s.number)) byNumber.set(s.number, []);
  byNumber.get(s.number).push(s);
}

for (let n = 1; n <= 80; n += 1) {
  const matches = byNumber.get(n) || [];
  if (matches.length === 0) console.log(`MISSING Q${n}`);
  else if (matches.length > 1) {
    console.log(`MULTIPLE Q${n} (${matches.length}):`);
    matches.forEach((m, i) => console.log(`  ${i+1}: ${m.context}`));
  }
}

console.log('\n--- Suspicious low-number matches (likely page numbers) ---');
for (const s of starts.filter((x) => x.number <= 5)) {
  console.log(`Q${s.number}: ${s.context}`);
}
