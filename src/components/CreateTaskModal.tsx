import React from 'react';
import { Plus, X } from 'lucide-react';
import { RevisionTaskModalState } from '../types';
import { PLANEJAMENTOS, DISCIPLINAS } from '../utils/constants';

interface CreateTaskModalProps {
  modalState: RevisionTaskModalState;
  setModalState: React.Dispatch<React.SetStateAction<RevisionTaskModalState | null>>;
  onConfirm: () => void;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  modalState,
  setModalState,
  onConfirm
}) => {
  if (!modalState.isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-[#262626] rounded-xl shadow-2xl border border-[#404040] w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-[#404040]">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Plus className="w-6 h-6 text-purple-500" /> Confirmar Tarefa de Revisão
          </h2>
          <button 
            onClick={() => setModalState(null)}
            className="text-gray-400 hover:text-white transition-colors"
            title="Fechar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Planejamento</label>
              <select
                value={modalState.planejamento}
                onChange={(e) => setModalState({...modalState, planejamento: e.target.value})}
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">Selecione</option>
                {PLANEJAMENTOS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Meta</label>
              <input
                type="number"
                value={modalState.meta}
                onChange={(e) => setModalState({...modalState, meta: e.target.value})}
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Tarefa</label>
              <input
                type="number"
                value={modalState.tarefa}
                onChange={(e) => setModalState({...modalState, tarefa: e.target.value})}
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-1">Disciplina</label>
              <select
                value={modalState.discipline}
                onChange={(e) => setModalState({...modalState, discipline: e.target.value})}
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                <option value="">Selecione</option>
                {DISCIPLINAS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-300 mb-1">Assunto</label>
              <input
                type="text"
                value={modalState.assunto}
                onChange={(e) => setModalState({...modalState, assunto: e.target.value})}
                className="w-full bg-[#1a1a1a] border border-[#404040] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <h3 className="font-bold text-white mb-3">Pré-visualização dos Blocos ({modalState.blocks.length})</h3>
            <div className="space-y-3">
              {modalState.blocks.map((block, idx) => (
                <div key={idx} className="bg-[#1a1a1a] p-3 rounded-lg border border-[#404040]">
                  <div className="text-sm font-bold text-white mb-1">{block.title}</div>
                  <div className="text-xs text-gray-400">
                    {block.lesson} • Páginas {block.pages} • {block.bank} • {block.questions.length} questões
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#404040] flex justify-end gap-3 bg-[#1a1a1a] rounded-b-xl">
          <button 
            onClick={() => setModalState(null)} 
            className="px-5 py-2 text-gray-300 hover:text-white hover:bg-[#333333] rounded transition-colors font-medium border border-[#404040]"
          >
            Cancelar
          </button>
          <button 
            onClick={onConfirm}
            className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded font-bold transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Criar Tarefa
          </button>
        </div>
      </div>
    </div>
  );
};
