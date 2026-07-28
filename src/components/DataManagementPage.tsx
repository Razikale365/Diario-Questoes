import type { ChangeEventHandler } from 'react';
import { ArrowLeft, Cloud, Download, KeyRound, LogIn, Merge, RefreshCw, Upload, UserRound, X } from 'lucide-react';

import type { SyncState, SyncStatus } from '../types/sync';

type DataManagementView = 'backup' | 'account';

interface DataManagementPageProps {
  view: DataManagementView;
  syncState: SyncState;
  onBack: () => void;
  onExport: () => void;
  onImport: ChangeEventHandler<HTMLInputElement>;
  onMerge: ChangeEventHandler<HTMLInputElement>;
  onPaste: () => void;
  onSyncNow: () => void;
  onAuth: () => void;
  onChangePassword: () => void;
  onDisconnect: () => void;
}

const statusLabels: Record<SyncStatus, string> = {
  idle: 'Somente local',
  syncing: 'Sincronizando',
  synced: 'Sincronizado',
  error: 'Erro de sincronização',
  offline: 'Offline',
  unauthenticated: 'Login necessário',
};

const PageHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
  <div className="flex items-start gap-4">
    <button
      type="button"
      onClick={onBack}
      aria-label="Voltar para Mais"
      className="mt-1 rounded-lg border border-white/10 p-2 text-gray-400 transition hover:border-purple-400/50 hover:text-white"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.25em] text-purple-300">Dados e acesso</p>
      <h1 className="text-3xl font-black text-white">{title}</h1>
    </div>
  </div>
);

const CloudActions = ({
  syncState,
  onSyncNow,
  onAuth,
  onChangePassword,
  onDisconnect,
}: Pick<DataManagementPageProps, 'syncState' | 'onSyncNow' | 'onAuth' | 'onChangePassword' | 'onDisconnect'>) => {
  const isUnauthenticated = syncState.status === 'unauthenticated';

  return (
    <section className="rounded-2xl border border-white/10 bg-[#242424] p-5" aria-labelledby="cloud-status-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-purple-300">Nuvem</p>
          <h2 id="cloud-status-title" className="mt-1 text-lg font-bold text-white">{statusLabels[syncState.status]}</h2>
        </div>
        <Cloud className={syncState.status === 'synced' ? 'h-6 w-6 text-lime-400' : 'h-6 w-6 text-gray-500'} />
      </div>

      {syncState.lastError && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">
          {syncState.lastError}
        </p>
      )}

      {isUnauthenticated ? (
        <div className="mt-5">
          <p className="text-sm leading-6 text-gray-300">
            Esta origem ainda não está conectada. <strong className="text-white">localhost</strong> e o endereço IP da rede
            guardam sessões separadas; entre com a mesma conta para receber as tarefas da nuvem.
          </p>
          <button
            type="button"
            onClick={onAuth}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#84cc16] px-4 py-3 text-sm font-black uppercase text-black hover:bg-[#74b80e]"
          >
            <LogIn className="h-4 w-4" />
            Entrar na nuvem
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-sm leading-6 text-gray-300">
            Esta origem está conectada. Alterar a senha é opcional; para atualizar os dados, use sincronizar agora.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onSyncNow}
              disabled={syncState.status === 'syncing'}
              className="inline-flex items-center gap-2 rounded-lg bg-[#84cc16] px-4 py-3 text-sm font-black uppercase text-black hover:bg-[#74b80e] disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncState.status === 'syncing' ? 'animate-spin' : ''}`} />
              Sincronizar agora
            </button>
            <button
              type="button"
              onClick={onChangePassword}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm font-bold text-gray-200 hover:border-purple-400/50 hover:text-white"
            >
              <KeyRound className="h-4 w-4" />
              Alterar senha (opcional)
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm font-bold text-gray-400 hover:border-red-400/50 hover:text-red-300"
            >
              <X className="h-4 w-4" />
              Desconectar
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export const DataManagementPage = ({
  view,
  syncState,
  onBack,
  onExport,
  onImport,
  onMerge,
  onPaste,
  onSyncNow,
  onAuth,
  onChangePassword,
  onDisconnect,
}: DataManagementPageProps) => {
  const cloudProps = { syncState, onSyncNow, onAuth, onChangePassword, onDisconnect };

  if (view === 'account') {
    return (
      <section className="space-y-5" aria-label="Conta e sincronização">
        <PageHeader title="Conta" onBack={onBack} />
        <CloudActions {...cloudProps} />
      </section>
    );
  }

  return (
    <section className="space-y-5" aria-label="Backup e sincronização">
      <PageHeader title="Backup e sincronização" onBack={onBack} />

      <section className="rounded-2xl border border-white/10 bg-[#242424] p-5" aria-labelledby="transfer-title">
        <div className="flex items-start gap-3">
          <Merge className="mt-1 h-5 w-5 flex-none text-purple-300" />
          <div>
            <h2 id="transfer-title" className="text-lg font-bold text-white">Transferir do IP da rede para localhost</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-300">
              <li>No endereço <strong className="text-white">192.168.15.74</strong>, exporte o JSON.</li>
              <li>No <strong className="text-white">localhost</strong>, escolha “Mesclar backup”.</li>
              <li>A mesclagem adiciona o que falta e não apaga as tarefas que já existem.</li>
            </ol>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#84cc16] px-4 py-3 text-sm font-black uppercase text-black hover:bg-[#74b80e]"
          >
            <Download className="h-4 w-4" />
            Exportar JSON
          </button>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-3 text-sm font-black uppercase text-white hover:bg-purple-500">
            <Merge className="h-4 w-4" />
            Mesclar backup no localhost
            <input type="file" accept=".json,application/json" onChange={onMerge} className="hidden" />
          </label>
          <label
            title="Substitui as tarefas atuais pelas tarefas do arquivo"
            className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm font-bold text-gray-300 hover:border-amber-400/50 hover:text-white"
          >
            <Upload className="h-4 w-4" />
            Substituir pelo backup
            <input type="file" accept=".json,application/json" onChange={onImport} className="hidden" />
          </label>
          <button
            type="button"
            onClick={onPaste}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-4 py-3 text-sm font-bold text-gray-300 hover:border-purple-400/50 hover:text-white"
          >
            <UserRound className="h-4 w-4" />
            Colar backup
          </button>
        </div>

        <p className="mt-4 text-xs leading-5 text-gray-500">
          O JSON transfere as tarefas e o histórico do caderno. A sincronização em nuvem também exige login separado em cada origem.
        </p>
      </section>

      <CloudActions {...cloudProps} />
    </section>
  );
};
