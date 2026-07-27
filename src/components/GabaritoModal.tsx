import React, { useState } from 'react';
import { CheckSquare, X, Check } from 'lucide-react';
import { parseGabarito } from '../utils/gabaritoParser';

interface GabaritoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (parsedAnswers: Map<number, string>) => void;
}

export const GabaritoModal: React.FC<GabaritoModalProps> = ({
  isOpen,
  onClose,
  onImport
}) => {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!text.trim()) return;
    const result = parseGabarito(text);
    if (result.errors.length > 0) {
      setError(result.errors.join(' '));
      return;
    }

    onImport(result.answers);
    setText('');
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#262626] p-6 rounded-xl w-full max-w-lg border border-[#404040] shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-purple-500" />
            Importar Gabarito
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Cole o gabarito abaixo. O sistema tentará identificar o número da questão e a resposta (A-E, Certo/Errado).
        </p>
        <textarea
          className="w-full h-48 bg-[#1a1a1a] border border-[#404040] rounded-lg p-4 text-white font-mono text-sm mb-6 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none"
          placeholder="Exemplo:&#10;1 B&#10;2 D&#10;3 C&#10;4 ERRADO&#10;5 CERTO"
          value={text}
          onChange={e => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p role="alert" className="-mt-3 mb-4 text-sm text-red-300">{error}</p>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-300 hover:text-white hover:bg-[#333333] rounded-lg transition-colors font-medium">
            Cancelar
          </button>
          <button 
            onClick={handleImport} 
            disabled={!text.trim()}
            className="bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <Check className="w-5 h-5" />
            Importar e Validar
          </button>
        </div>
      </div>
    </div>
  );
};
