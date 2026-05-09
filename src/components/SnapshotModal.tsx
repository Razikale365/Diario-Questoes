import React from 'react';
import { Archive, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { SyncHistoryEntry, SyncStatus } from '../types/sync';

interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: SyncHistoryEntry[];
  isLoading: boolean;
  snapshotName: string;
  setSnapshotName: (value: string) => void;
  onCreate: () => void;
  onRestore: (snapshotId: string) => void;
  syncStatus: SyncStatus;
}

const formatSnapshotDate = (date: string) => (
  new Date(date).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
);

export const SnapshotModal: React.FC<SnapshotModalProps> = ({
  isOpen,
  onClose,
  history,
  isLoading,
  snapshotName,
  setSnapshotName,
  onCreate,
  onRestore,
  syncStatus
}) => {
  if (!isOpen) return null;

  const canUseCloud = syncStatus !== 'unauthenticated' && syncStatus !== 'idle';

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-black/70 md:items-center md:justify-center">
      <div className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[#404040] bg-[#333333] shadow-2xl md:max-w-2xl md:rounded-xl">
        <div className="flex items-center justify-between border-b border-[#404040] bg-[#262626] px-5 py-4">
          <div className="flex items-center gap-3">
            <Archive className="h-5 w-5 text-[#84cc16]" />
            <div>
              <h2 className="text-lg font-black text-white">Snapshots</h2>
              <p className="text-xs text-gray-400">Pontos manuais para voltar antes de importações grandes.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-[#404040] hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {!canUseCloud && (
            <div className="mb-4 rounded-lg border border-yellow-700/60 bg-yellow-900/20 p-4 text-sm text-yellow-100">
              O sync está em modo local. Entre na conta para criar e restaurar snapshots na nuvem.
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.target.value)}
              placeholder="Ex.: backup antes de importar semana 37"
              className="h-12 rounded-lg border border-[#525252] bg-[#1f1f1f] px-4 text-sm text-white outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              disabled={!canUseCloud || isLoading}
            />
            <button
              onClick={onCreate}
              disabled={!canUseCloud || isLoading}
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#84cc16] px-5 text-sm font-black uppercase text-black transition-colors hover:bg-[#a3e635] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Criar
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {isLoading && history.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando snapshots...
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#525252] px-4 py-8 text-center text-sm text-gray-400">
                Nenhum snapshot manual ou automático encontrado.
              </div>
            ) : (
              history.map(entry => (
                <div key={entry.id} className="flex flex-col gap-3 rounded-lg border border-[#404040] bg-[#2b2b2b] p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-bold text-white">
                      {entry.snapshot_name || (entry.source === 'manual' ? 'Snapshot manual' : 'Snapshot automático')}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      {formatSnapshotDate(entry.snapshot_at)} · {entry.task_count ?? 0} tarefas
                    </div>
                  </div>
                  <button
                    onClick={() => onRestore(entry.id)}
                    disabled={isLoading}
                    className="flex h-11 items-center justify-center gap-2 rounded-lg border border-purple-500/40 px-4 text-sm font-bold text-purple-200 transition-colors hover:bg-purple-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" /> Restaurar
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
