import { SyncStatus } from '../types/sync';
import { Cloud, CloudOff, RefreshCw, AlertCircle, CheckCircle, LogIn } from 'lucide-react';

interface SyncStatusBadgeProps {
  status: SyncStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingChanges: number;
  conflictMessage?: string | null;
  onSyncNow: () => void;
  onAuth: () => void;
  onDisconnect: () => void;
  isCollapsed: boolean;
}

const statusConfig: Record<SyncStatus, { icon: typeof Cloud; color: string; label: string; helper: string }> = {
  idle: { icon: CloudOff, color: 'text-gray-500', label: 'Modo local', helper: 'Dados salvos neste aparelho.' },
  syncing: { icon: RefreshCw, color: 'text-yellow-400', label: 'Sincronizando...', helper: 'Enviando e buscando alterações.' },
  synced: { icon: CheckCircle, color: 'text-green-400', label: 'Sincronizado', helper: 'Nuvem ativa.' },
  error: { icon: AlertCircle, color: 'text-red-400', label: 'Erro no sync', helper: 'Alterações continuam salvas localmente.' },
  offline: { icon: CloudOff, color: 'text-gray-500', label: 'Offline', helper: 'Salvando localmente até a conexão voltar.' },
  unauthenticated: { icon: LogIn, color: 'text-purple-400', label: 'Sync desativado', helper: 'Entre na conta para salvar na nuvem.' },
};

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  status,
  lastSyncAt,
  lastError,
  pendingChanges,
  conflictMessage,
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
        title={`${config.label}: ${config.helper}`}
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
      <div className="mb-1 text-[9px] leading-snug text-purple-200/80">
        {status === 'error' && lastError ? lastError : config.helper}
        {pendingChanges > 0 && status !== 'synced' && (
          <span className="block text-yellow-200">{pendingChanges} alteração(ões) aguardando sync.</span>
        )}
        {conflictMessage && (
          <span className="mt-1 block rounded bg-yellow-500/10 px-2 py-1 text-yellow-100">
            {conflictMessage}
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {status !== 'unauthenticated' && (
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
