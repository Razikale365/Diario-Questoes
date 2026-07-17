import React from 'react';
import { Edit2, Plus, X, Save, FileUp } from 'lucide-react';
import { ActivityBlock } from '../types';

export interface BlockEditModalState {
  isOpen: boolean;
  taskId: string;
  id: string;
  title: string;
  lesson: string;
  pages: string;
  bank: string;
  questionsText: string;
  layout: { columns: number; rows: number; type: 'grid' | 'columns' };
}

interface BlockEditModalProps {
  modalState: BlockEditModalState;
  onClose: () => void;
  onSave: () => void;
  setModalState: (state: BlockEditModalState) => void;
  onImportPdf?: (state: BlockEditModalState) => void;
}

export const BlockEditModal: React.FC<BlockEditModalProps> = ({
  modalState,
  onClose,
  onSave,
  setModalState,
  onImportPdf,
}) => {
  if (!modalState.isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#262626] p-6 rounded-xl w-full max-w-2xl border border-[#404040] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            {modalState.id ? <Edit2 className="w-6 h-6 text-purple-500" /> : <Plus className="w-6 h-6 text-purple-500" />}
            {modalState.id ? 'Editar Bloco de Atividade' : 'Novo Bloco de Atividade'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1">Título da Atividade</label>
            <input
              type="text"
              className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg p-3 text-white focus:outline-none focus:border-purple-500"
              placeholder="Ex: Atividade 1"
              value={modalState.title}
              onChange={e => setModalState({...modalState, title: e.target.value})}
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Aula / Assunto</label>
              <input
                type="text"
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg p-3 text-white focus:outline-none focus:border-purple-500"
                placeholder="Ex: Aula 05"
                value={modalState.lesson}
                onChange={e => setModalState({...modalState, lesson: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Banca</label>
              <select
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg p-3 text-white focus:outline-none focus:border-purple-500"
                value={modalState.bank}
                onChange={e => {
                  let val = e.target.value;
                  if (val === 'CESPE') val = 'CEBRASPE';
                  setModalState({...modalState, bank: val});
                }}
              >
                <option value="">Nenhuma</option>
                {['CEBRASPE', 'FCC', 'FGV', 'VUNESP', 'CESPE', 'Outra'].map(b => (
                  <option key={b} value={b === 'CESPE' ? 'CEBRASPE' : b}>{b}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1">Páginas</label>
            <input
              type="text"
              className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg p-3 text-white focus:outline-none focus:border-purple-500"
              placeholder="Ex: 77 a 83"
              value={modalState.pages}
              onChange={e => setModalState({...modalState, pages: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-300 mb-1">Questões</label>
            <p className="text-xs text-gray-400 mb-2">Informe os números das questões separados por vírgula ou hífen. Ex: 1-20, 25, 30</p>
            <textarea
              className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg p-3 text-white focus:outline-none focus:border-purple-500 resize-none h-24"
              placeholder="1-20"
              value={modalState.questionsText}
              onChange={e => setModalState({...modalState, questionsText: e.target.value})}
            />
          </div>

          <div className="pt-4 border-t border-[#404040]">
            <label className="block text-sm font-bold text-purple-400 mb-3">Configuração de Layout (lxc)</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1a1a1a] p-4 rounded-lg border border-[#333333]">
              <div className="col-span-1 md:col-span-2">
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Tipo de Preenchimento</label>
                <div className="flex bg-[#262626] p-1 rounded-lg border border-[#404040]">
                  <button
                    onClick={() => setModalState({...modalState, layout: { ...modalState.layout, type: 'columns' }})}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${modalState.layout.type === 'columns' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                  >
                    Vertical (Colunas)
                  </button>
                  <button
                    onClick={() => setModalState({...modalState, layout: { ...modalState.layout, type: 'grid' }})}
                    className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${modalState.layout.type === 'grid' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                  >
                    Horizontal (Grade)
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Colunas Desktop ({modalState.layout.columns})</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="2"
                    max="8"
                    step="1"
                    className="flex-1 accent-purple-500 h-1.5 bg-[#404040] rounded-lg appearance-none cursor-pointer"
                    value={modalState.layout.columns}
                    onChange={e => setModalState({...modalState, layout: { ...modalState.layout, columns: parseInt(e.target.value) }})}
                  />
                  <span className="text-white font-bold bg-[#404040] px-3 py-1 rounded border border-[#525252] text-sm tabular-nums min-w-[2rem] text-center">
                    {modalState.layout.columns}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Linhas Desktop ({modalState.layout.rows})</label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    className="flex-1 accent-purple-500 h-1.5 bg-[#404040] rounded-lg appearance-none cursor-pointer"
                    value={modalState.layout.rows}
                    onChange={e => setModalState({...modalState, layout: { ...modalState.layout, rows: parseInt(e.target.value) }})}
                  />
                  <span className="text-white font-bold bg-[#404040] px-3 py-1 rounded border border-[#525252] text-sm tabular-nums min-w-[2rem] text-center">
                    {modalState.layout.rows}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 mt-2 px-1 italic">
              * O preenchimento Vertical preenche colunas pela altura definida. O Horizontal segue a ordem sequencial das colunas.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-[#404040]">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-300 hover:text-white hover:bg-[#333333] rounded-lg transition-colors font-medium">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onImportPdf?.(modalState)}
            className="border border-[#f59e0b]/40 bg-[#f59e0b]/10 hover:bg-[#f59e0b]/20 text-[#fcd34d] px-5 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <FileUp className="w-5 h-5" />
            {modalState.id ? 'Importar questões neste bloco (PDF ou texto)' : 'Importar questões (PDF ou texto)'}
          </button>
          <button 
            onClick={onSave} 
            disabled={!modalState.questionsText.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <Save className="w-5 h-5" />
            Salvar Bloco
          </button>
        </div>
      </div>
    </div>
  );
};
