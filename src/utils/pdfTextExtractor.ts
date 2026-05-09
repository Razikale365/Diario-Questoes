export interface PdfExtractedPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  fileName: string;
  pageCount: number;
  pages: PdfExtractedPage[];
  text: string;
}

export type PdfPageLoader = (data: Uint8Array) => Promise<PdfExtractedPage[]>;

const isPdfFile = (file: File): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

const formatPages = (pages: PdfExtractedPage[]): string =>
  pages
    .map(page => `--- Página ${page.pageNumber} ---\n${page.text.trim()}`)
    .join('\n\n')
    .trim();

export const extractPdfTextWithLoader = async (
  file: File,
  loadPages: PdfPageLoader
): Promise<PdfExtractionResult> => {
  if (!isPdfFile(file)) {
    throw new Error('Selecione um arquivo PDF da meta LS.');
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const pages = await loadPages(data);
  const text = formatPages(pages);

  if (!text.replace(/--- Página \d+ ---/g, '').trim()) {
    throw new Error('O PDF foi aberto, mas não trouxe texto legível. Ele pode estar protegido, escaneado ou vazio.');
  }

  return {
    fileName: file.name,
    pageCount: pages.length,
    pages,
    text
  };
};

const loadPdfPages: PdfPageLoader = async (data) => {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const document = await pdfjs.getDocument({ data }).promise;
  const pages: PdfExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({ pageNumber, text });
  }

  return pages;
};

export const extractPdfText = async (file: File): Promise<PdfExtractionResult> =>
  extractPdfTextWithLoader(file, loadPdfPages);
