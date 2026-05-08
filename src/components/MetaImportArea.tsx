import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, Play, RotateCcw, UploadCloud } from 'lucide-react';
import { StudyTask } from '../types';
import { BANKS, PLANEJAMENTOS } from '../utils/constants';
import { createTasksFromMetaDrafts, isDraftSelectedByDefault, MetaParseResult, parseMetaText } from '../utils/metaParser';
import { extractPdfText, PdfExtractionResult } from '../utils/pdfTextExtractor';

interface MetaImportAreaProps {
  onImport: (tasks: StudyTask[]) => void;
  showToast: (msg: string) => void;
}

const inferMetaNumber = (fileName: string, text: string): string => {
  const fileMatch = fileName.match(/meta[_\-\s]*(\d+)/i);
  if (fileMatch) return fileMatch[1];

  const textMatch = text.match(/\bMETA\s+(\d+)\b/i);
  return textMatch?.[1] || '';
};

export const MetaImportArea: React.FC<MetaImportAreaProps> = ({ onImport, showToast }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [planejamento, setPlanejamento] = useState('');
  const [meta, setMeta] = useState('');
  const [bank, setBank] = useState('CEBRASPE');
  const [pdfResult, setPdfResult] = useState<PdfExtractionResult | null>(null);
  const [parseResult, setParseResult] = useState<MetaParseResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const selectedCount = selectedIds.size;
  const selectedMinutes = useMemo(() => (
    parseResult?.drafts
      .filter(draft => selectedIds.has(draft.id))
      .reduce((total, draft) => total + (draft.tempoEstimadoMinutos || 0), 0) || 0
  ), [parseResult, selectedIds]);

  const reset = () => {
    setPdfResult(null);
    setParseResult(null);
    setSelectedIds(new Set());
    setErrorMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setErrorMessage('');
    setPdfResult(null);
    setParseResult(null);
    setSelectedIds(new Set());

    try {
      const extracted = await extractPdfText(file);
      const parsed = parseMetaText(extracted.text);
      const detectedMeta = inferMetaNumber(extracted.fileName, extracted.text);
      if (!meta && detectedMeta) setMeta(detectedMeta);
      setPdfResult(extracted);
      setParseResult(parsed);
      setSelectedIds(new Set(
        parsed.drafts
          .filter(isDraftSelectedByDefault)
          .map(draft => draft.id)
      ));

      if (parsed.drafts.length === 0) {
        setErrorMessage('PDF lido, mas nenhuma tarefa de meta foi detectada. Ele pode conter só orientação ou calendário.');
      } else {
        showToast(`${parsed.drafts.length} tarefas detectadas na meta.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível ler o PDF.';
      setErrorMessage(message);
      showToast(message);
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleDraft = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleImport = () => {
    if (!parseResult || selectedIds.size === 0) {
      showToast('Selecione pelo menos uma tarefa da meta.');
      return;
    }

    const tasks = createTasksFromMetaDrafts(parseResult.drafts, {
      planejamento,
      meta,
      bank,
      selectedDraftIds: Array.from(selectedIds)
    });

    onImport(tasks);
    reset();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-[#404040] bg-[#333333] shadow-xl">
      <div className="border-b border-[#404040] bg-[#262626] px-6 py-4">
        <h2 className="flex items-center gap-2 text-xl font-bold text-white">
          <FileUp className="h-6 w-6 text-cyan-400" /> Importar Meta LS
        </h2>
      </div>

      <div className="space-y-5 p-4 md:p-6">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">Planejamento</label>
            <select
              value={planejamento}
              onChange={(event) => setPlanejamento(event.target.value)}
              className="w-full rounded border border-[#525252] bg-[#404040] px-4 py-2 text-white focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            >
              <option value="">Todos</option>
              {PLANEJAMENTOS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">Meta</label>
            <input
              type="number"
              value={meta}
              onChange={(event) => setMeta(event.target.value)}
              placeholder="Ex: 37"
              className="w-full rounded border border-[#525252] bg-[#404040] px-4 py-2 text-white focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-gray-300">Banca padrão</label>
            <select
              value={bank}
              onChange={(event) => setBank(event.target.value)}
              className="w-full rounded border border-[#525252] bg-[#404040] px-4 py-2 text-white focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
            >
              {BANKS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-cyan-400/40 bg-[#262626] p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            className="sr-only"
          />
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
                {isExtracting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
              </div>
              <div>
                <div className="font-black text-white">{pdfResult?.fileName || 'Anexe o PDF da meta LS'}</div>
                <div className="mt-1 text-sm text-gray-400">
                  {isExtracting
                    ? 'Extraindo texto do PDF...'
                    : pdfResult
                      ? `${pdfResult.pageCount} páginas lidas`
                      : 'O app vai extrair o texto, detectar as tarefas e mostrar uma revisão antes de criar a fila.'}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isExtracting}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-black text-black transition-colors hover:bg-cyan-300 disabled:opacity-60 md:flex-none"
              >
                <FileUp className="h-4 w-4" />
                Selecionar PDF
              </button>
              {(pdfResult || errorMessage) && (
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#525252] px-3 text-gray-300 hover:bg-[#404040]"
                  title="Limpar PDF"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="flex gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>{errorMessage}</div>
          </div>
        )}

        {parseResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-[#262626] p-3">
                <div className="text-xs font-bold uppercase text-gray-500">Detectadas</div>
                <div className="text-2xl font-black text-white">{parseResult.summary.totalTasks}</div>
              </div>
              <div className="rounded-xl bg-[#262626] p-3">
                <div className="text-xs font-bold uppercase text-gray-500">Selecionadas</div>
                <div className="text-2xl font-black text-cyan-300">{selectedCount}</div>
              </div>
              <div className="rounded-xl bg-[#262626] p-3">
                <div className="text-xs font-bold uppercase text-gray-500">Tempo</div>
                <div className="text-2xl font-black text-[#84cc16]">{selectedMinutes}m</div>
              </div>
              <div className="rounded-xl bg-[#262626] p-3">
                <div className="text-xs font-bold uppercase text-gray-500">Ignoradas</div>
                <div className="text-2xl font-black text-red-300">{parseResult.ignoredLines.length}</div>
              </div>
            </div>

            {parseResult.drafts.length > 0 && (
              <div className="grid gap-3">
                {parseResult.drafts.map(draft => (
                  <label
                    key={draft.id}
                    className={`block rounded-xl border p-4 transition-colors ${selectedIds.has(draft.id) ? 'border-cyan-400/60 bg-cyan-400/10' : 'border-[#404040] bg-[#262626]'}`}
                  >
                    <div className="flex gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(draft.id)}
                        onChange={() => toggleDraft(draft.id)}
                        className="mt-1 h-5 w-5 accent-cyan-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-[#1f1f1f] px-2 py-1 text-xs font-black text-cyan-300">#{draft.numero}</span>
                          <span className="text-sm font-black text-white">{draft.discipline}</span>
                          <span className="rounded bg-purple-500/10 px-2 py-1 text-[11px] font-bold text-purple-200">{draft.formato}</span>
                          <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[11px] font-bold text-[#bef264]">{draft.tempoEstimadoMinutos ?? 0} min</span>
                          <span className="rounded bg-[#404040] px-2 py-1 text-[11px] font-bold text-gray-300">{draft.statusOrigem}</span>
                        </div>
                        <div className="mt-2 text-sm text-gray-200">{draft.descricao || 'Descrição não detectada'}</div>
                        <div className="mt-2 text-xs text-gray-500">{draft.blocks.length} bloco(s) iniciais</div>
                        {draft.warnings.length > 0 && (
                          <div className="mt-2 text-xs text-yellow-200">{draft.warnings.join(' ')}</div>
                        )}
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-400">Trecho detectado</summary>
                          <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-[#1f1f1f] p-3 text-[11px] text-gray-300">{draft.rawText}</pre>
                        </details>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {parseResult.ignoredLines.length > 0 && (
              <details className="rounded-xl border border-[#404040] bg-[#262626] p-4">
                <summary className="cursor-pointer text-sm font-bold text-gray-300">Linhas ignoradas do PDF</summary>
                <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                  {parseResult.ignoredLines.slice(0, 80).map(line => (
                    <div key={`${line.index}-${line.text}`} className="rounded-lg bg-[#1f1f1f] px-3 py-2 text-xs text-gray-400">
                      <span className="font-mono text-gray-500">L{line.index}</span> {line.text}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleImport}
                disabled={selectedIds.size === 0}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#84cc16] px-6 text-sm font-black uppercase text-black transition-colors hover:bg-[#a3e635] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Play className="h-4 w-4" />
                Criar fila da meta
              </button>
            </div>
          </div>
        )}

        {pdfResult && parseResult?.drafts.length === 0 && (
          <details className="rounded-xl border border-[#404040] bg-[#262626] p-4">
            <summary className="cursor-pointer text-sm font-bold text-gray-300">Ver texto extraído para diagnóstico</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[#1f1f1f] p-3 text-xs text-gray-300">{pdfResult.text}</pre>
          </details>
        )}

        {parseResult && parseResult.drafts.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <CheckCircle2 className="h-4 w-4 text-cyan-300" />
            O importador de tarefa avulsa abaixo continua disponível para texto colado.
          </div>
        )}
      </div>
    </div>
  );
};
