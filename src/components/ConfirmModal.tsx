import React from 'react';
import { Trash2 } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  isDestructive = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#1c1c1c] rounded-xl shadow-2xl border border-[#404040] p-6 w-full max-w-sm transform scale-100 animate-in zoom-in-95 duration-200">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-2 ${
            isDestructive ? 'bg-red-900/20 text-red-500' : 'bg-purple-900/20 text-purple-500'
          }`}>
            {isDestructive ? <Trash2 className="w-8 h-8" /> : null}
          </div>
          <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed pb-2">
            {message}
          </p>
          
          <div className="flex w-full gap-3 pt-2">
            <button 
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-[#404040]/50 hover:bg-[#404040] text-gray-300 hover:text-white rounded-lg transition-colors font-medium border border-[#555]/30 focus:outline-none focus:ring-2 focus:ring-gray-500/40"
            >
              {cancelText}
            </button>
            <button 
              onClick={onConfirm}
              className={`flex-1 px-4 py-3 text-white rounded-lg transition-colors font-bold focus:outline-none focus:ring-2 ${
                isDestructive 
                  ? 'bg-red-600 hover:bg-red-700 shadow-[0_0_15px_rgba(220,38,38,0.2)] focus:ring-red-500/40' 
                  : 'bg-purple-600 hover:bg-purple-700 shadow-[0_0_15px_rgba(147,51,234,0.2)] focus:ring-purple-500/40'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
