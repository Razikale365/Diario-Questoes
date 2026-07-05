import React from 'react';
import { BookOpen, CalendarDays, CheckCircle2, History, Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle, LogIn } from 'lucide-react';
import { SyncStatus } from '../types/sync';

type ActiveTab = 'caderno' | 'planner' | 'revisao' | 'historico';

interface BottomNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  syncStatus: SyncStatus;
  onSyncNow: () => void;
  onAuth: () => void;
  inProgressCount?: number;
}

const statusConfig: Record<SyncStatus, { icon: typeof Cloud; color: string }> = {
  idle: { icon: CloudOff, color: 'text-gray-400' },
  syncing: { icon: RefreshCw, color: 'text-yellow-400' },
  synced: { icon: CheckCircle, color: 'text-green-400' },
  error: { icon: AlertCircle, color: 'text-red-400' },
  offline: { icon: CloudOff, color: 'text-gray-400' },
  unauthenticated: { icon: LogIn, color: 'text-purple-400' },
};

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  setActiveTab,
  syncStatus,
  onSyncNow,
  onAuth,
  inProgressCount = 0
}) => {
  const SyncIcon = statusConfig[syncStatus].icon;
  const syncColor = statusConfig[syncStatus].color;

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
        onClick={() => setActiveTab('planner')}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${
          activeTab === 'planner' ? 'text-white' : 'text-purple-300'
        }`}
      >
        <CalendarDays className="w-6 h-6" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Planner</span>
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
          {syncStatus === 'unauthenticated' ? 'Login' : 'Sync'}
        </span>
      </button>
    </nav>
  );
};
