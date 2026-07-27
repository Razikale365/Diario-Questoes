import React, { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

import type { QuestionSourcePage } from '../types';
import { loadQuestionSourceDocument } from '../storage/questionSourceDocuments';
import { calculatePdfPageScale } from '../utils/pdfPageRender';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface QuestionSourcePageViewerProps {
  sourcePage?: QuestionSourcePage;
}

export const QuestionSourcePageViewer: React.FC<QuestionSourcePageViewerProps> = ({ sourcePage }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [renderRevision, setRenderRevision] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');

  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => setRenderRevision((current) => current + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !sourcePage) return;
    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

    const renderPage = async () => {
      setStatus('loading');
      try {
        const record = await loadQuestionSourceDocument(sourcePage.documentId);
        if (cancelled) return;
        if (!record) {
          setStatus('missing');
          return;
        }

        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(record.data.slice(0)) });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(sourcePage.pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const availableWidth = Math.max((viewportRef.current?.clientWidth || 0) - 24, 0);
        const scale = calculatePdfPageScale(availableWidth, baseViewport.width, zoom);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) throw new Error('Canvas indisponível.');

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${Math.ceil(viewport.width)}px`;
        canvas.style.height = `${Math.ceil(viewport.height)}px`;
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        }).promise;
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [isOpen, renderRevision, sourcePage, zoom]);

  if (!sourcePage) return null;

  return (
    <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.04]">
      <button
        type="button"
        onClick={() => {
          setIsOpen((current) => {
            if (current) setIsFullscreen(false);
            return !current;
          });
        }}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-black text-amber-100 hover:bg-amber-400/[0.06]"
      >
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-300" />
          Ver página original {sourcePage.pageNumber}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70">
          {sourcePage.likelyVisual ? 'visual preservado' : isOpen ? 'ocultar' : 'abrir'}
        </span>
      </button>

      {isOpen && (
        <div className={isFullscreen
          ? 'fixed inset-3 z-[90] overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#202020] p-4 shadow-2xl'
          : 'border-t border-amber-400/15 p-3'
        }>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-gray-400">Página completa, com tabelas, gráficos, fórmulas e legendas.</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsFullscreen((current) => !current)}
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Abrir página em tela cheia'}
                className="mr-1 flex items-center gap-1.5 rounded border border-amber-300/20 px-2 py-1.5 text-[11px] font-bold text-amber-100 hover:bg-amber-300/10"
              >
                {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              </button>
              <button type="button" onClick={() => setZoom((current) => Math.max(0.75, current - 0.25))} aria-label="Diminuir página" className="rounded border border-white/10 p-1.5 text-gray-300 hover:text-white">
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-12 text-center text-[11px] font-bold text-gray-400">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((current) => Math.min(2, current + 0.25))} aria-label="Aumentar página" className="rounded border border-white/10 p-1.5 text-gray-300 hover:text-white">
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div
            ref={viewportRef}
            className={`min-h-24 overflow-auto rounded bg-white p-3 text-center ${isFullscreen ? 'max-h-[calc(100vh-7rem)]' : ''}`}
          >
            {status === 'loading' && <p className="flex items-center justify-center gap-2 py-8 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" />Carregando página local...</p>}
            {status === 'missing' && <p className="py-8 text-sm text-red-700">PDF local não encontrado. Reimporte o arquivo para restaurar esta página.</p>}
            {status === 'error' && <p className="py-8 text-sm text-red-700">Não foi possível renderizar esta página.</p>}
            <canvas ref={canvasRef} className={status === 'ready' ? 'mx-auto block max-w-none' : 'hidden'} />
          </div>
        </div>
      )}
    </div>
  );
};
