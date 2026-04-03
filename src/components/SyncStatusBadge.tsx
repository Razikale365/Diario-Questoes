import { SyncStatus } from '../types/sync';
import { Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle, LogIn } from 'lucide-react';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  lastSyncAt: string | null;
  onSyncNow: () => void;
  onAuth: () => void;
  onDisconnect: () => void;
  isCollapsed: boolean;
}

const statusConfig: Record<SyncStatus, { icon: typeof Cloud; color: string; label: string }> = {
  idle: { icon: CloudOff, color: 'text-gray-500', label: 'Local' },
  syncing: { icon: RefreshCw, color: 'text-yellow-400', label: 'Sincronizando...' },
  synced: { icon: CheckCircle, color: 'text-green-400', label: 'Sincronizado' },
  error: { icon: AlertCircle, color: 'text-red-400', label: 'Erro' },
  offline: { icon: CloudOff, color: 'text-gray-500', label: 'Offline' },
  unauthenticated: { icon: LogIn, color: 'text-purple-400', label: 'Login' },
};

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  lastSyncAt,
  onSyncNow,
  onAuth,
  onDisconnect,
  isCollapsed,
}) => {
  const config = statusConfig[status];
  const Icon = config.icon;

  const formatLastSync = () => {
    if (!lastSyncAt) return '';
    const diff = Date.now() - new Date(lastSyncAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    return `${hours}h atrás`;
  };

  if (isCollapsed) {
    return (
      <button
        onClick={status === 'unauthenticated' ? onAuth : onSyncNow}
        className={`w-full flex justify-center py-2 ${config.color} hover:text-white transition-colors`}
        title={config.label}
      >
        <Icon className={`w-4 h-4 ${status === 'syncing' ? 'animate-spin' : ''}`} />
      </button>
    );
  }

  return (
    <div className="px-4 py-2 border-t border-purple-800/50">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Icon className={`w-3.5 h-3.5 ${config.color} ${status === 'syncing' ? 'animate-spin' : ''}`} />
          <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider">{config.label}</span>
        </div>
        {lastSyncAt && status === 'synced' && (
          <span className="text-[9px] text-gray-500">{formatLastSync()}</span>
        )}
      </div>
      <div className="flex gap-1">
        {status !== 'unauthenticated' && status !== 'idle' && (
          <button
            onClick={onSyncNow}
            disabled={status === 'syncing'}
            className="flex-1 text-[9px] text-purple-400 hover:text-white py-1 rounded transition-colors disabled:opacity-50"
          >
            Sincronizar agora
          </button>
        )}
        {status === 'unauthenticated' && (
          <button
            onClick={onAuth}
            className="flex-1 text-[9px] text-purple-400 hover:text-white py-1 rounded transition-colors"
          >
            Fazer login
          </button>
        )}
        {status === 'synced' && (
          <button
            onClick={onDisconnect}
            className="text-[9px] text-gray-500 hover:text-red-400 py-1 px-2 rounded transition-colors"
          >
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
};
