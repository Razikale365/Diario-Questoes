import React, { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardPaste, FileText, Play, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import { StudyTask } from '../types';
import { analyzeImportText } from '../utils/productInsights';
import { applyLayoutToBlocks, getLayoutTemplate, LayoutTemplateId, LAYOUT_TEMPLATES } from '../utils/layout';
import { PLANEJAMENTOS, DISCIPLINAS, BANKS } from '../utils/constants';

interface ImportAreaProps {
  onImport: (task: StudyTask) => void;
  showToast: (msg: string) => void;
}

export const ImportArea: React.FC<ImportAreaProps> = ({ onImport, showToast }) => {
  const [importText, setImportText] = useState('');
  const [importPlanejamento, setImportPlanejamento] = useState('');
  const [importMeta, setImportMeta] = useState('');
  const [importTarefa, setImportTarefa] = useState('');
  const [importAssunto, setImportAssunto] = useState('');
  const [importDiscipline, setImportDiscipline] = useState('');
  const [importBank, setImportBank] = useState('CEBRASPE');
  const [layoutTemplate, setLayoutTemplate] = useState<LayoutTemplateId>('default');
  const [isPasting, setIsPasting] = useState(false);
  const [isReviewingImport, setIsReviewingImport] = useState(false);

  const importAnalysis = useMemo(
    () => (importText.trim() ? analyzeImportText(importText) : null),
    [importText]
  );
  const parsedPreviewBlocks = importAnalysis?.blocks.filter(block => !block.isSection) || [];

  const handlePasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      showToast('A cola automática não está disponível neste navegador.');
      return;
    }

    try {
      setIsPasting(true);
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        showToast('A área de transferência está vazia.');
        return;
      }
      setImportText(clipboardText);
      showToast('Texto colado para importação.');
    } catch {
      showToast('Não foi possível ler a área de transferência.');
    } finally {
      setIsPasting(false);
    }
  };

  const buildTask = (): StudyTask | null => {
    if (!importDiscipline) {
      showToast('Por favor, informe a disciplina.');
      return null;
    }
    const parsedBlocks = importAnalysis?.blocks || [];
    if (parsedBlocks.length === 0) {
      showToast('Não foi possível identificar blocos de questões no texto.');
      return null;
    }

    // Derive the Assunto pattern from the pasted text. Prefer a top-line declaration
    // like "Assunto: ..." or "Assuntos: ...". Fallback to existing manually entered value
    // only if no pattern is found in the text.
    let extractedAssunto = importAssunto;
    const assuntoLineTop = importText.match(/^\s*Assuntos?:\s*(.+)$/im);
    if (assuntoLineTop && assuntoLineTop[1]) {
      extractedAssunto = assuntoLineTop[1].trim();
    } else {
      const assuntoMatch = importText.match(/Assuntos?:\s*(.+)/i);
      if (assuntoMatch) {
        extractedAssunto = assuntoMatch[1].trim();
      }
    }

    return {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      planejamento: importPlanejamento,
      meta: importMeta,
      tarefa: importTarefa,
      assunto: extractedAssunto,
      discipline: importDiscipline,
      bank: importBank,
      idealMinutes: importAnalysis?.idealMinutes,
      blocks: applyLayoutToBlocks(parsedBlocks, getLayoutTemplate(layoutTemplate)),
      status: 'in_progress'
    };
  };

  const handleReviewImport = () => {
    const newTask = buildTask();
    if (!newTask) return;
    setIsReviewingImport(true);
  };

  const handleImport = () => {
    const newTask = buildTask();
    if (!newTask) return;
    onImport(newTask);
    
    // Reset form after import
    setImportText('');
    setImportPlanejamento('');
    setImportMeta('');
    setImportTarefa('');
    setImportAssunto('');
    setImportDiscipline('');
    setImportBank('CEBRASPE');
    setLayoutTemplate('default');
    setIsReviewingImport(false);
  };

  return (
    <div className="bg-[#333333] rounded-lg border border-[#404040] shadow-xl overflow-hidden">
      <div className="bg-[#262626] px-6 py-4 border-b border-[#404040]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#84cc16]" /> Importar Nova Tarefa
        </h2>
      </div>
      <div className="p-4 md:p-6 space-y-5 md:space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Planejamento</label>
            <select
              value={importPlanejamento}
              onChange={(e) => setImportPlanejamento(e.target.value)}
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              <option value="">Todos</option>
              {PLANEJAMENTOS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Meta</label>
            <input
              type="number"
              value={importMeta}
              onChange={(e) => setImportMeta(e.target.value)}
              placeholder="Ex: 1"
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Tarefa</label>
            <input
              type="number"
              value={importTarefa}
              onChange={(e) => setImportTarefa(e.target.value)}
              placeholder="Ex: 1"
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Disciplina *</label>
            <select
              value={importDiscipline}
              onChange={(e) => setImportDiscipline(e.target.value)}
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              <option value="">Selecione</option>
              {DISCIPLINAS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Assunto</label>
            <input
              type="text"
              value={importAssunto}
              onChange={(e) => setImportAssunto(e.target.value)}
              placeholder="Auto-preenchido se colado"
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-2">Banca</label>
            <select
              value={importBank}
              onChange={(e) => setImportBank(e.target.value)}
              className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
            >
              {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="lg:col-span-3">
            <label className="block text-sm font-bold text-gray-300 mb-2">Template de layout</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {LAYOUT_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setLayoutTemplate(template.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${layoutTemplate === template.id ? 'border-purple-500 bg-purple-500/15 text-white' : 'border-[#404040] bg-[#262626] text-gray-300 hover:border-purple-500/40'}`}
                >
                  <div className="text-sm font-black">{template.label}</div>
                  <div className="mt-1 text-xs text-gray-500">{template.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
            <label className="block text-sm font-bold text-gray-300">Texto da Tarefa (Copie da plataforma LS)</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteFromClipboard}
                disabled={isPasting}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#525252] bg-[#262626] px-3 py-2 text-xs font-bold text-gray-200 transition-colors hover:border-[#84cc16]/50 hover:text-white disabled:opacity-60"
              >
                <ClipboardPaste className="h-4 w-4 text-[#84cc16]" />
                Colar
              </button>
              <button
                type="button"
                onClick={() => setImportText('')}
                disabled={!importText.trim()}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#525252] bg-[#262626] px-3 py-2 text-xs font-bold text-gray-200 transition-colors hover:border-red-500/40 hover:text-white disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4 text-gray-400" />
                Limpar
              </button>
            </div>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Cole aqui o texto da tarefa. Ex:&#10;Atividade 1&#10;Aula 05 - Versão Original&#10;Resolva as questões 01 a 20..."
            className="min-h-60 w-full rounded-xl border border-[#525252] bg-[#404040] px-4 py-3 font-mono text-sm text-white focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500 md:min-h-48"
          />
        </div>
        {importText.trim() && importAnalysis && (
          <div className="rounded-xl border border-[#404040] bg-[#262626] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <Sparkles className="h-4 w-4 text-[#84cc16]" />
              Prévia da importação
            </div>
            {parsedPreviewBlocks.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-gray-300">
                  <span className="rounded-full bg-[#333333] px-2.5 py-1 text-[#84cc16]">
                    {parsedPreviewBlocks.length} blocos detectados
                  </span>
                  <span className="rounded-full bg-[#333333] px-2.5 py-1">
                    {parsedPreviewBlocks.reduce((total, block) => total + block.questions.length, 0)} questões
                  </span>
                  {importAnalysis.idealMinutes && (
                    <span className="rounded-full bg-[#333333] px-2.5 py-1">
                      tempo ideal: {importAnalysis.idealMinutes} min
                    </span>
                  )}
                  <span className="rounded-full bg-[#333333] px-2.5 py-1 text-gray-400">
                    {importAnalysis.ignoredLines.length} linhas ignoradas
                  </span>
                </div>
                <div className="grid gap-2">
                  {parsedPreviewBlocks.slice(0, 3).map((block) => (
                    <div key={block.id} className="rounded-lg border border-[#404040] bg-[#333333] px-3 py-2 text-sm text-gray-200">
                      <div className="font-bold text-white">{block.title}</div>
                      <div className="mt-1 text-xs text-gray-400">
                        {block.lesson || 'Sem aula'} · {block.questions.length} questões{block.pages ? ` · ${block.pages}` : ''}
                      </div>
                    </div>
                  ))}
                  {parsedPreviewBlocks.length > 3 && (
                    <div className="text-xs text-gray-500">
                      + {parsedPreviewBlocks.length - 3} blocos adicionais serão importados.
                    </div>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[#404040] bg-[#1f1f1f] p-2">
                  {importAnalysis.recognizedLines.concat(importAnalysis.ignoredLines).sort((a, b) => a.index - b.index).map(line => (
                    <div key={line.index} className={`mb-1 flex gap-2 rounded px-2 py-1.5 text-xs ${line.status === 'recognized' ? 'bg-[#84cc16]/10 text-gray-200' : 'bg-red-500/10 text-red-200'}`}>
                      {line.status === 'recognized' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#84cc16]" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />}
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] opacity-90">L{line.index}: {line.text}</div>
                        <div className="mt-0.5 text-[10px] opacity-60">{line.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                O texto ainda não formou um bloco reconhecível. Você pode colar o conteúdo completo e revisar aqui antes de iniciar.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={handleReviewImport}
            disabled={!importText.trim()}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#84cc16] px-6 py-3 font-bold text-white transition-colors hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Play className="w-5 h-5" /> Pré-visualizar e Iniciar
          </button>
        </div>
      </div>

      {isReviewingImport && importAnalysis && (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/70 md:items-center md:justify-center">
          <div className="max-h-[92vh] w-full overflow-hidden rounded-t-2xl border border-[#404040] bg-[#333333] shadow-2xl md:max-w-3xl md:rounded-xl">
            <div className="flex items-center justify-between border-b border-[#404040] bg-[#262626] px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-white">Revisar importação</h3>
                <p className="text-xs text-gray-400">Confira blocos, questões e linhas antes de criar a tarefa.</p>
              </div>
              <button onClick={() => setIsReviewingImport(false)} className="rounded-lg p-2 text-gray-400 hover:bg-[#404040] hover:text-white">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-5">
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl bg-[#262626] p-3">
                  <div className="text-xs text-gray-500">Blocos</div>
                  <div className="text-2xl font-black text-white">{parsedPreviewBlocks.length}</div>
                </div>
                <div className="rounded-xl bg-[#262626] p-3">
                  <div className="text-xs text-gray-500">Questões</div>
                  <div className="text-2xl font-black text-[#84cc16]">{importAnalysis.totalQuestions}</div>
                </div>
                <div className="rounded-xl bg-[#262626] p-3">
                  <div className="text-xs text-gray-500">Reconhecidas</div>
                  <div className="text-2xl font-black text-purple-300">{importAnalysis.recognizedLines.length}</div>
                </div>
                <div className="rounded-xl bg-[#262626] p-3">
                  <div className="text-xs text-gray-500">Ignoradas</div>
                  <div className="text-2xl font-black text-red-300">{importAnalysis.ignoredLines.length}</div>
                </div>
              </div>
              <div className="grid gap-3">
                {parsedPreviewBlocks.map(block => (
                  <div key={block.id} className="rounded-xl border border-[#404040] bg-[#262626] p-4">
                    <div className="font-black text-white">{block.title}</div>
                    <div className="mt-1 text-sm text-gray-400">{block.lesson || 'Sem aula'}{block.pages ? ` · páginas ${block.pages}` : ''}</div>
                    <div className="mt-2 text-xs font-bold text-[#84cc16]">{block.questions.length} questões</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[#404040] bg-[#262626] p-4 sm:flex-row sm:justify-end">
              <button onClick={() => setIsReviewingImport(false)} className="min-h-11 rounded-xl border border-[#525252] px-4 text-sm font-bold text-gray-300 hover:bg-[#404040]">
                Voltar e ajustar
              </button>
              <button onClick={handleImport} className="min-h-11 rounded-xl bg-[#84cc16] px-5 text-sm font-black uppercase text-black hover:bg-[#a3e635]">
                Criar tarefa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
