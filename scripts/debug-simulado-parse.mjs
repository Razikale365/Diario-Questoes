import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const SIMULADO_QUESTION_START_RE = /(^|\n)\s*(\d{1,2})\s*-\s*\([^)]+\)/giu;

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
const text = pages.join('\n\n').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
await pdf.cleanup();

const starts = [...text.matchAll(SIMULADO_QUESTION_START_RE)].map((match) => ({
  start: (match.index ?? 0) + (match[1]?.length ?? 0),
  number: Number(match[2]),
}));

const isValidAlternativeSet = (alternatives) => {
  const labels = alternatives.map((a) => a.label);
  const uniqueLabels = new Set(labels);
  if (uniqueLabels.size !== labels.length) return false;
  if (alternatives.some((a) => !a.text)) return false;
  return ['A', 'B', 'C', 'D'].every((label) => uniqueLabels.has(label));
};

const parseAlternativesByLines = (body) => {
  const statementLines = [];
  const alternatives = [];
  let currentAlternative = null;
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*(?:\(?([A-Ea-e])\)?\s*[.)\-–:]|([A-Ea-e])\s{2,})(?:\s+)?(.*)$/u);
    if (match) {
      currentAlternative = { label: (match[1] || match[2]).toUpperCase(), text: (match[3] || '').replace(/\s+/g, ' ').trim() };
      alternatives.push(currentAlternative);
      continue;
    }
    if (currentAlternative) currentAlternative.text = `${currentAlternative.text} ${line}`.replace(/\s+/g, ' ').trim();
    else statementLines.push(line);
  }
  return { statement: statementLines.join(' ').replace(/\s+/g, ' ').trim(), alternatives };
};

const removeQuestionHeader = (block, number) => {
  const simuladoRe = new RegExp(`^\\s*0*${number}\\s*-\\s*\\([^)]+\\)\\s*`, 'iu');
  const without = block.replace(simuladoRe, '').trim();
  if (without !== block.trim()) return without;
  const headerRe = new RegExp(`^\\s*(?:(?:quest(?:ão|ao)|q)\\s*)?0*${number}\\s*(?:[.)\\-–:]|\\b)\\s*`, 'iu');
  return block.replace(headerRe, '').trim();
};

let ok = 0; let fail = [];
for (let i = 0; i < starts.length; i++) {
  const block = text.slice(starts[i].start, starts[i + 1]?.start ?? text.length).trim();
  const body = removeQuestionHeader(block, starts[i].number);
  const parsed = parseAlternativesByLines(body);
  if (parsed.statement && isValidAlternativeSet(parsed.alternatives)) ok++;
  else fail.push({ n: starts[i].number, stmt: parsed.statement?.slice(0, 60), alts: parsed.alternatives.length });
}
console.log('parsed ok:', ok, 'failed:', fail.length);
fail.forEach((f) => console.log('FAIL Q' + f.n, 'alts=' + f.alts, f.stmt));
