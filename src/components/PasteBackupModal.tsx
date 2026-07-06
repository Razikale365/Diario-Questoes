import React, { useState } from 'react';
import { Clipboard, X, Check, Plus } from 'lucide-react';

interface PasteBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (json: string) => void;
  onMerge: (json: string) => void;
}

export const PasteBackupModal: React.FC<PasteBackupModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onMerge
}) => {
  const [text, setText] = useState('');

  const handleImport = () => {
    if (!text.trim()) return;
    onImport(text);
    setText('');
    onClose();
  };

  const handleMerge = () => {
    if (!text.trim()) return;
    onMerge(text);
    setText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#262626] p-6 rounded-xl w-full max-w-lg border border-[#404040] shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Clipboard className="w-6 h-6 text-purple-500" />
            Colar Backup JSON
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Cole o JSON de tarefas ou do banco de questões para restaurar, mesclar ou importar histórico.
        </p>
        <textarea
          className="w-full h-48 bg-[#1a1a1a] border border-[#404040] rounded-lg p-4 text-white font-mono text-sm mb-6 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none"
          placeholder='[ { "id": "...", "date": "...", ... } ] ou { "schema": "diario-questoes.question-bank", ... }'
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="flex justify-end gap-3 flex-wrap">
          <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white hover:bg-[#333333] rounded-lg transition-colors font-medium mr-auto">
            Cancelar
          </button>
          <button 
            onClick={handleMerge} 
            disabled={!text.trim()}
            className="bg-[#404040] hover:bg-[#525252] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center gap-2 border border-[#525252]"
          >
            <Plus className="w-4 h-4" />
            Mesclar (Adicionar)
          </button>
          <button 
            onClick={handleImport} 
            disabled={!text.trim()}
            className="bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Importar (Substituir)
          </button>
        </div>
      </div>
    </div>
  );
};
