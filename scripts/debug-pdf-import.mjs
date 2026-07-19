import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/debug-pdf-import.mjs <pdf-path>');
  process.exit(1);
}

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
    if (typeof y === 'number' && previousY !== null && Math.abs(y - previousY) > 2.5) {
      flushLine();
    }

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
console.log('=== PAGE COUNT ===', pdf.numPages);
console.log('=== TEXT LENGTH ===', text.length);
console.log('=== FIRST 4000 CHARS ===');
console.log(text.slice(0, 4000));
console.log('=== LAST 2000 CHARS ===');
console.log(text.slice(-2000));

await pdf.cleanup();
