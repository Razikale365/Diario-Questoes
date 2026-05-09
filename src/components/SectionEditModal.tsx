import React, { useState, useEffect } from 'react';
import { Edit2, Layout, Maximize2, Check, X } from 'lucide-react';

interface SectionEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (layout: { width: number; rowSpan: number }, newTitle: string) => void;
  sectionTitle: string;
}

export const SectionEditModal: React.FC<SectionEditModalProps> = ({
  isOpen,
  onClose,
  onSave,
  sectionTitle
}) => {
  const [width, setWidth] = useState(12);
  const [rowSpan, setRowSpan] = useState(1);
  const [newTitle, setNewTitle] = useState(sectionTitle);

  useEffect(() => {
    if (isOpen) {
      setNewTitle(sectionTitle);
    }
  }, [isOpen, sectionTitle]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-end justify-center z-[100] p-0 md:items-center md:p-4">
      <div className="bg-[#1a1a1a] p-5 w-full min-h-[88vh] rounded-t-3xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden md:min-h-0 md:max-w-lg md:rounded-3xl md:p-8">
        {/* Background Decor */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-purple-500/10 blur-[80px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-[#84cc16]/10 blur-[80px] rounded-full" />

        <div className="relative z-10">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h3 className="text-2xl font-black text-white flex items-center gap-3 uppercase tracking-tight">
                <Layout className="w-8 h-8 text-purple-500" />
                Ajustar Seção
              </h3>
              <p className="text-gray-400 text-sm mt-1 font-medium">
                Configurações globais para esta aula
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-all">
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="space-y-8">
            {/* Title Editor */}
            <div className="space-y-3">
              <label className="text-sm font-black text-gray-400 uppercase tracking-widest">Renomear Seção</label>
              <div className="relative group">
                <Edit2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-purple-500/50 group-focus-within:text-purple-500 transition-colors" />
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Ex: Aula 01"
                  className="w-full bg-[#262626] border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white font-bold focus:outline-none focus:border-purple-500/50 transition-all placeholder:text-gray-600"
                />
              </div>
              <p className="text-[10px] text-gray-500 italic px-2">
                * Ao renomear, todos os blocos desta seção também serão atualizados.
              </p>
            </div>

            {/* Width Selector */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-black text-gray-400 uppercase tracking-widest">Largura dos Blocos</label>
                <span className="text-2xl font-black text-purple-400">{width} Cols</span>
              </div>
              <input
                type="range"
                min="3"
                max="12"
                step="3"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value))}
                className="w-full h-2 bg-[#2d2d2d] rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[10px] font-black text-gray-600 uppercase px-1">
                <span>Compacto</span>
                <span>Médio</span>
                <span>Largo</span>
                <span>Full</span>
              </div>
            </div>

            {/* RowSpan Selector */}
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-sm font-black text-gray-400 uppercase tracking-widest">Altura dos Blocos</label>
                <span className="text-2xl font-black text-[#84cc16]">{rowSpan} Rows</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={rowSpan}
                onChange={(e) => setRowSpan(parseInt(e.target.value))}
                className="w-full h-2 bg-[#2d2d2d] rounded-lg appearance-none cursor-pointer accent-[#84cc16]"
              />
              <div className="flex justify-between text-[10px] font-black text-gray-600 uppercase px-1">
                <span>1</span>
                <span>2</span>
                <span>3</span>
                <span>4</span>
                <span>5</span>
                <span>6+</span>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                onClick={onClose}
                className="flex-1 px-6 py-4 bg-[#2d2d2d] hover:bg-[#3d3d3d] text-white rounded-2xl font-bold transition-all border border-white/5"
              >
                Cancelar
              </button>
              <button
                onClick={() => onSave({ width, rowSpan }, newTitle)}
                className="flex-[1.5] px-6 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-2xl font-black shadow-xl shadow-purple-500/20 flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <Check className="w-5 h-5" />
                SALVAR ALTERAÇÕES
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
