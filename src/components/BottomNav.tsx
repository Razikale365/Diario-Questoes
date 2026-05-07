import React from 'react';
import { Archive, BookOpen, CheckCircle2, History, Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle, LogIn } from 'lucide-react';
import { SyncStatus } from '../types/sync';

interface BottomNavProps {
  activeTab: 'caderno' | 'revisao' | 'historico';
  setActiveTab: (tab: 'caderno' | 'revisao' | 'historico') => void;
  syncStatus: SyncStatus;
  onSyncNow: () => void;
  onAuth: () => void;
  onOpenSnapshots: () => void;
  inProgressCount?: number;
}

const statusConfig: Record<SyncStatus, { icon: typeof Cloud; color: string; label: string }> = {
  idle: { icon: CloudOff, color: 'text-gray-300', label: 'Local' },
  syncing: { icon: RefreshCw, color: 'text-yellow-300', label: 'Salvando' },
  synced: { icon: CheckCircle, color: 'text-green-300', label: 'Salvo' },
  error: { icon: AlertCircle, color: 'text-red-300', label: 'Erro' },
  offline: { icon: CloudOff, color: 'text-gray-300', label: 'Offline' },
  unauthenticated: { icon: LogIn, color: 'text-purple-200', label: 'Entrar' },
};

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  syncStatus,
  onSyncNow,
  onAuth,
  onOpenSnapshots,
  inProgressCount = 0
}) => {
  const SyncIcon = statusConfig[syncStatus].icon;
  const syncColor = statusConfig[syncStatus].color;
  const syncLabel = statusConfig[syncStatus].label;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#5c2092] border-t border-purple-800/50 flex items-center justify-around px-2 py-1 z-50 pb-safe">
      <button
        onClick={() => setActiveTab('caderno')}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${
          activeTab === 'caderno' ? 'text-white' : 'text-purple-300'
        }`}
      >
        <div className="relative">
          <BookOpen className="w-6 h-6" />
          {inProgressCount > 0 && (
            <span className="absolute -top-1 -right-2 bg-[#84cc16] text-white text-[10px] px-1 rounded-full font-black border border-[#5c2092]">
              {inProgressCount}
            </span>
          )}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-tighter">Caderno</span>
      </button>

      <button
        onClick={() => setActiveTab('revisao')}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${
          activeTab === 'revisao' ? 'text-white' : 'text-purple-300'
        }`}
      >
        <CheckCircle2 className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Revisão</span>
      </button>

      <button
        onClick={() => setActiveTab('historico')}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${
          activeTab === 'historico' ? 'text-white' : 'text-purple-300'
        }`}
      >
        <History className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Histórico</span>
      </button>

      <button
        onClick={syncStatus === 'unauthenticated' ? onAuth : onSyncNow}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${syncColor}`}
      >
        <SyncIcon className={`w-6 h-6 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
        <span className="text-[10px] font-bold uppercase tracking-tighter">
          {syncLabel}
        </span>
      </button>

      <button
        onClick={onOpenSnapshots}
        className="flex flex-col items-center gap-1 p-2 text-purple-300 transition-colors hover:text-white"
      >
        <Archive className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Backup</span>
      </button>
    </nav>
  );
};
