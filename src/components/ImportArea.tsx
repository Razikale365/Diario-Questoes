import React, { useState } from 'react';
import { FileText, Play } from 'lucide-react';
import { StudyTask } from '../types';
import { parseLSTask } from '../utils/parser';
import { PLANEJAMENTOS, DISCIPLINAS, BANKS } from '../utils/constants';
import { QuestionPdfImport } from './QuestionPdfImport';
import { LocalStudyPackageImport } from './LocalStudyPackageImport';

interface ImportAreaProps {
  onImport: (task: StudyTask) => void;
  onMergeLocalPackage: (tasks: StudyTask[]) =>
    Promise<
      | { ok: true; added: number; duplicates: number }
      | { ok: false; message: string }
    >;
  showToast: (msg: string) => void;
}

export const ImportArea: React.FC<ImportAreaProps> = ({ onImport, onMergeLocalPackage, showToast }) => {
  const [importText, setImportText] = useState('');
  const [importPlanejamento, setImportPlanejamento] = useState('');
  const [importMeta, setImportMeta] = useState('');
  const [importTarefa, setImportTarefa] = useState('');
  const [importAssunto, setImportAssunto] = useState('');
  const [importDiscipline, setImportDiscipline] = useState('');
  const [importBank, setImportBank] = useState('CEBRASPE');

  const handleImport = () => {
    if (!importDiscipline) {
      showToast('Por favor, informe a disciplina.');
      return;
    }
    const parsedBlocks = parseLSTask(importText);
    if (parsedBlocks.length === 0) {
      showToast('Não foi possível identificar blocos de questões no texto.');
      return;
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

    const newTask: StudyTask = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      planejamento: importPlanejamento,
      meta: importMeta,
      tarefa: importTarefa,
      assunto: extractedAssunto,
      discipline: importDiscipline,
      bank: importBank,
      blocks: parsedBlocks,
      status: 'in_progress'
    };

    onImport(newTask);
    
    // Reset form after import
    setImportText('');
    setImportPlanejamento('');
    setImportMeta('');
    setImportTarefa('');
    setImportAssunto('');
    setImportDiscipline('');
    setImportBank('CEBRASPE');
  };

  return (
    <div className="bg-[#333333] rounded-lg border border-[#404040] shadow-xl overflow-hidden">
      <div className="bg-[#262626] px-6 py-4 border-b border-[#404040]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-[#84cc16]" /> Importar Nova Tarefa
        </h2>
      </div>
      <div className="p-6 space-y-6">
        <LocalStudyPackageImport onMergeTasks={onMergeLocalPackage} showToast={showToast} />
        <div className="border-t border-[#404040]" />
        <QuestionPdfImport onImport={onImport} showToast={showToast} />
        <div className="border-t border-[#404040]" />
        <h3 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-purple-400" /> Texto da LS
        </h3>
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
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-300 mb-2">Texto da Tarefa (Copie da plataforma LS)</label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Cole aqui o texto da tarefa. Ex:&#10;Atividade 1&#10;Aula 05 - Versão Original&#10;Resolva as questões 01 a 20..."
            className="w-full h-48 bg-[#404040] border border-[#525252] rounded px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleImport}
            disabled={!importText.trim()}
            className="bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded font-bold flex items-center gap-2 transition-colors"
          >
            <Play className="w-5 h-5" /> Iniciar Tarefa
          </button>
        </div>
      </div>
    </div>
  );
};
