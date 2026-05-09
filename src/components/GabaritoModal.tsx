import React, { useState } from 'react';
import { CheckSquare, X, Check } from 'lucide-react';

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

  const handleImport = () => {
    if (!text.trim()) return;

    const parsedAnswers = new Map<number, string>();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Tentativa 1: Parsing do formato em bloco (linhas alternadas de n°s e respostas)
    for (let i = 0; i < lines.length - 1; i++) {
      const isNumLine = /^(\d+\s+)+\d+$|^(\d+)$/.test(lines[i]);
      if (isNumLine) {
        const nums = lines[i].split(/\s+/).map(n => parseInt(n, 10));
        const possibleAnswersLine = lines[i+1];
        // Captura alternativas limpas incluindo ANULADA, CERTA, ERRADA
        const ansMatch = possibleAnswersLine.match(/\b(A|B|C|D|E|CERTO|CERTA|ERRADO|ERRADA|C|E|ANULADA)\b/gi);
        if (ansMatch && ansMatch.length >= nums.length) {
          nums.forEach((num, idx) => {
            let ans = ansMatch[idx].toUpperCase();
            if (ans === 'CERTO' || ans === 'CERTA') ans = 'C';
            if (ans === 'ERRADO' || ans === 'ERRADA') ans = 'E';
            parsedAnswers.set(num, ans);
          });
          i++; // Pula a linha de resposta pois já foi processada
          continue;
        }
      }
    }

    // Tentativa 2: Fallback pro formato tradicional linha a linha (Q1: A, 1. LETRA C, 5. ALTERNATIVA C)
    const regexFallback = /(\d+)\s*[-.)]?\s*(?:LETRA|ALTERNATIVA)?\s*([A-E]|CERTO|CERTA|ERRADO|ERRADA|C|E|ANULADA)\b/gi;
    let match;
    while ((match = regexFallback.exec(text)) !== null) {
      const num = parseInt(match[1], 10);
      if (!parsedAnswers.has(num)) {
        let ans = match[2].toUpperCase();
        if (ans === 'CERTO' || ans === 'CERTA') ans = 'C';
        if (ans === 'ERRADO' || ans === 'ERRADA') ans = 'E';
        parsedAnswers.set(num, ans);
      }
    }

    onImport(parsedAnswers);
    setText('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50 p-0 md:items-center md:p-4">
      <div className="bg-[#262626] p-5 w-full min-h-[80vh] border border-[#404040] shadow-2xl rounded-t-3xl md:min-h-0 md:max-w-lg md:rounded-xl md:p-6">
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
          onChange={e => setText(e.target.value)}
        />
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="min-h-12 px-5 py-2.5 text-gray-300 hover:text-white hover:bg-[#333333] rounded-lg transition-colors font-medium">
            Cancelar
          </button>
          <button 
            onClick={handleImport} 
            disabled={!text.trim()}
            className="min-h-12 bg-[#84cc16] hover:bg-[#65a30d] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold transition-colors flex items-center gap-2"
          >
            <Check className="w-5 h-5" />
            Importar e Validar
          </button>
        </div>
      </div>
    </div>
  );
};
