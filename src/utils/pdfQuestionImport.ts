import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

import {
  parseObjectiveQuestions,
  ParseObjectiveQuestionsOptions,
  ParseObjectiveQuestionsResult,
} from './objectiveQuestionParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfTextItem {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

export interface PdfQuestionImportResult extends ParseObjectiveQuestionsResult {
  fileName: string;
  pageCount: number;
  extractedTextLength: number;
}

const textItemsToPageText = (items: PdfTextItem[]) => {
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
  return lines.join('\n');
};

export const extractPdfText = async (file: File) => {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textItemsToPageText(textContent.items as PdfTextItem[]);
      if (pageText) pages.push(`[Pagina ${pageNumber}]\n${pageText}`);
    }

    return {
      text: pages.join('\n\n'),
      pageCount: pdf.numPages,
    };
  } finally {
    await pdf.cleanup();
  }
};

export const importObjectiveQuestionsFromPdf = async (
  file: File,
  options: ParseObjectiveQuestionsOptions = {}
): Promise<PdfQuestionImportResult> => {
  const extracted = await extractPdfText(file);
  const parsed = parseObjectiveQuestions(extracted.text, options);

  return {
    ...parsed,
    fileName: file.name,
    pageCount: extracted.pageCount,
    extractedTextLength: extracted.text.length,
  };
};
