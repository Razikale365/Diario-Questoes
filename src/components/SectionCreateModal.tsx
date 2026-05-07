import React, { useEffect, useState } from 'react';
import { Check, Layers, X } from 'lucide-react';

interface SectionCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (title: string) => void;
}

export const SectionCreateModal: React.FC<SectionCreateModalProps> = ({
  isOpen,
  onClose,
  onCreate
}) => {
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (isOpen) setTitle('');
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onCreate(trimmedTitle);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-[100] p-0 md:items-center md:p-4">
      <div className="bg-[#262626] w-full border border-[#404040] shadow-2xl rounded-t-3xl p-5 md:max-w-md md:rounded-2xl md:p-6">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-purple-500" />
            Criar Seção
          </h3>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-400 transition-colors hover:bg-[#333333] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="mb-2 block text-sm font-bold text-gray-300">Título da seção</label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate();
            if (event.key === 'Escape') onClose();
          }}
          placeholder="Ex: Aula 09"
          className="w-full rounded-xl border border-[#404040] bg-[#1a1a1a] p-4 text-white outline-none transition-colors focus:border-purple-500"
        />

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-[#333333] px-4 py-3 font-bold text-gray-300 transition-colors hover:text-white">
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim()}
            className="min-h-12 flex-1 rounded-xl bg-purple-600 px-4 py-3 font-bold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" />
            Criar
          </button>
        </div>
      </div>
    </div>
  );
};
