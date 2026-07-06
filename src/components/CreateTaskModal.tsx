import React from 'react';
import { Plus, X } from 'lucide-react';
import { RevisionTaskModalState } from '../types';
import { PLANEJAMENTOS, DISCIPLINAS } from '../utils/constants';
import { createResizableModalStyle } from '../utils/modalSizing';

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
      <div
        className="bg-[#262626] rounded-2xl shadow-2xl border border-[#404040] flex flex-col"
        style={createResizableModalStyle({
          width: 'min(1180px, calc(100vw - 2rem))',
          minHeight: '520px',
        })}
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 p-5 md:p-6 border-b border-[#404040]">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
              <Plus className="w-6 h-6 text-purple-500 shrink-0" /> Confirmar Tarefa de Revisão
            </h2>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-gray-500">
              Ajuste os metadados e confira os blocos antes de criar
            </p>
          </div>
          <button
            onClick={() => setModalState(null)}
            className="text-gray-400 hover:text-white transition-colors"
            title="Fechar"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(340px,0.9fr)_minmax(460px,1.2fr)] gap-6">
            <section className="space-y-4 rounded-xl border border-white/5 bg-[#202020] p-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-purple-300">Dados da tarefa</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1.5">Planejamento</label>
                  <select
                    value={modalState.planejamento}
                    onChange={(e) => setModalState({...modalState, planejamento: e.target.value})}
                    className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Selecione</option>
                    {PLANEJAMENTOS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1.5">Meta</label>
                    <input
                      type="number"
                      value={modalState.meta}
                      onChange={(e) => setModalState({...modalState, meta: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1.5">Tarefa</label>
                    <input
                      type="number"
                      value={modalState.tarefa}
                      onChange={(e) => setModalState({...modalState, tarefa: e.target.value})}
                      className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1.5">Disciplina</label>
                  <select
                    value={modalState.discipline}
                    onChange={(e) => setModalState({...modalState, discipline: e.target.value})}
                    className="w-full bg-[#1a1a1a] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Selecione</option>
                    {DISCIPLINAS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-gray-500 mb-1.5">Assunto</label>
                  <textarea
                    value={modalState.assunto}
                    onChange={(e) => setModalState({...modalState, assunto: e.target.value})}
                    rows={4}
                    className="w-full resize-y bg-[#1a1a1a] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </section>

            <section className="min-h-0 rounded-xl border border-white/5 bg-[#202020] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-purple-300">
                  Pré-visualização dos Blocos
                </h3>
                <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                  {modalState.blocks.filter(b => !b.isSection).length} atividades
                </span>
              </div>

              <div className="max-h-[48vh] overflow-y-auto pr-1 space-y-3 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {modalState.blocks.map((block, idx) => {
                  if (block.isSection) {
                    return (
                      <div key={idx} className="mt-5 mb-2 border-b border-[#333] pb-1">
                        <div className="text-sm font-bold text-purple-400 uppercase tracking-wider">{block.title}</div>
                      </div>
                    );
                  }

                  return (
                    <div key={idx} className="bg-[#1a1a1a] p-3 rounded-lg border border-[#404040]">
                      <div className="text-sm font-bold text-white mb-1">{block.title}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                        <span>{block.lesson}</span>
                        {block.pages && <span>Páginas {block.pages}</span>}
                        {block.bank && <span>{block.bank}</span>}
                        <span>{block.questions.length} questões</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        <div className="shrink-0 p-5 md:p-6 border-t border-[#404040] flex flex-wrap justify-end gap-3 bg-[#1a1a1a] rounded-b-2xl">
          <button
            onClick={() => setModalState(null)}
            className="px-5 py-2.5 text-gray-300 hover:text-white hover:bg-[#333333] rounded-lg transition-colors font-medium border border-[#404040]"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Criar Tarefa
          </button>
        </div>
      </div>
    </div>
  );
};
