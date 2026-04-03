import { BookOpen, CheckCircle2, History, Download, Upload, Plus, User, Clipboard, ChevronLeft, ChevronRight } from 'lucide-react';
import { SyncStatusBadge } from './SyncStatusBadge';
import { SyncStatus } from '../types/sync';

interface SidebarProps {
  activeTab: 'caderno' | 'revisao' | 'historico';
  setActiveTab: React.Dispatch<React.SetStateAction<'caderno' | 'revisao' | 'historico'>>;
  setHistoryPage: (page: number) => void;
  exportBackup: () => void;
  importBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  mergeBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenPasteBackup: () => void;
  inProgressCount?: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  syncStatus: SyncStatus;
  syncLastSyncAt: string | null;
  onSyncNow: () => void;
  onAuth: () => void;
  onDisconnect: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  setHistoryPage,
  exportBackup,
  importBackup,
  mergeBackup,
  onOpenPasteBackup,
  inProgressCount = 0,
  isCollapsed,
  onToggleCollapse,
  syncStatus,
  syncLastSyncAt,
  onSyncNow,
  onAuth,
  onDisconnect
}) => {
  return (
    <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-[#5c2092] flex-shrink-0 flex flex-col shadow-2xl z-20 transition-all duration-300 relative group`}>
      <button 
        onClick={onToggleCollapse}
        className="absolute -right-3 top-10 w-6 h-6 bg-[#84cc16] text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-all opacity-0 group-hover:opacity-100 z-30"
        title={isCollapsed ? "Expandir Menu" : "Recolher Menu"}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      <div className={`p-6 flex flex-col items-center border-b border-purple-800/50 overflow-hidden ${isCollapsed ? 'px-2' : ''}`}>
        <div className={`${isCollapsed ? 'w-10 h-10' : 'w-20 h-20'} bg-white rounded-full flex items-center justify-center mb-3 shadow-inner transition-all duration-300`}>
          <User className={`${isCollapsed ? 'w-5 h-5' : 'w-10 h-10'} text-purple-900 transition-all`} />
        </div>
        {!isCollapsed && (
          <div className="text-center animate-in fade-in duration-500">
            <p className="text-xs text-purple-300 mb-1 uppercase tracking-wider">Orientação de Estudos</p>
            <p className="text-sm font-bold text-white text-center truncate w-full">ALUNO LS</p>
            <div className="flex gap-2 mt-3 text-xs text-purple-200 justify-center">
              <button className="hover:text-white underline">Minha Conta</button>
              <span>|</span>
              <button className="hover:text-white underline">Sair</button>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        <button
          onClick={() => setActiveTab('caderno')}
          className={`w-full flex items-center gap-3 px-6 py-3 text-sm font-bold transition-all ${
            activeTab === 'caderno' ? 'bg-purple-800/50 text-white border-l-4 border-[#84cc16]' : 'text-purple-200 hover:bg-purple-800/30 hover:text-white border-l-4 border-transparent'
          } ${isCollapsed ? 'px-0 justify-center border-l-0' : ''}`}
          title={isCollapsed ? "Caderno de Respostas" : ""}
        >
          <BookOpen className="w-5 h-5 flex-shrink-0" /> 
          {!isCollapsed && <span className="flex-1 text-left">Caderno de Respostas</span>}
          {inProgressCount > 0 && (
            <span className={`bg-[#84cc16] text-white text-[10px] px-1.5 py-0.5 rounded-full font-black ${isCollapsed ? 'absolute top-2 right-4' : ''}`}>
              {inProgressCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('revisao')}
          className={`w-full flex items-center gap-3 px-6 py-3 text-sm font-bold transition-all ${
            activeTab === 'revisao' ? 'bg-purple-800/50 text-white border-l-4 border-[#84cc16]' : 'text-purple-200 hover:bg-purple-800/30 hover:text-white border-l-4 border-transparent'
          } ${isCollapsed ? 'px-0 justify-center border-l-0' : ''}`}
          title={isCollapsed ? "Gerar Revisão" : ""}
        >
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> 
          {!isCollapsed && <span>Gerar Revisão</span>}
        </button>
        <button
          onClick={() => {
            setActiveTab('historico');
            setHistoryPage(1);
          }}
          className={`w-full flex items-center gap-3 px-6 py-3 text-sm font-bold transition-all ${
            activeTab === 'historico' ? 'bg-purple-800/50 text-white border-l-4 border-[#84cc16]' : 'text-purple-200 hover:bg-purple-800/30 hover:text-white border-l-4 border-transparent'
          } ${isCollapsed ? 'px-0 justify-center border-l-0' : ''}`}
          title={isCollapsed ? "Histórico de Tarefas" : ""}
        >
          <History className="w-5 h-5 flex-shrink-0" /> 
          {!isCollapsed && <span>Histórico de Tarefas</span>}
        </button>
      </nav>

      <div className={`p-4 border-t border-purple-800/50 flex flex-col gap-2 transition-all ${isCollapsed ? 'items-center px-0' : ''}`}>
        {!isCollapsed && <p className="text-xs text-purple-300 mb-1 uppercase tracking-wider px-2">Dados</p>}
        
        <button 
          onClick={exportBackup}
          className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-purple-200 hover:text-white hover:bg-purple-800/30 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? "Exportar JSON" : ""}
        >
          <span className="flex items-center gap-2">
            <Download className="w-4 h-4" /> 
            {!isCollapsed && <span>Exportar JSON</span>}
          </span>
        </button>
        
        <label className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-purple-200 hover:text-white hover:bg-purple-800/30 rounded transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-purple-500/50 ${isCollapsed ? 'justify-center' : ''}`} title={isCollapsed ? "Importar Backup" : ""}>
          <span className="flex items-center gap-2">
            <Upload className="w-4 h-4" /> 
            {!isCollapsed && <span>Importar Backup</span>}
          </span>
          <input type="file" accept=".json" onChange={importBackup} className="hidden" />
        </label>

        <label className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-purple-200 hover:text-white hover:bg-purple-800/30 rounded transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-purple-500/50 ${isCollapsed ? 'justify-center' : ''}`} title={isCollapsed ? "Mesclar Backup" : "Adiciona tarefas do arquivo sem apagar as existentes"}>
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> 
            {!isCollapsed && <span>Mesclar Backup</span>}
          </span>
          <input type="file" accept=".json" onChange={mergeBackup} className="hidden" />
        </label>

        <button 
          onClick={onOpenPasteBackup}
          className={`w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-purple-200 hover:text-white hover:bg-purple-800/30 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/50 ${isCollapsed ? 'justify-center' : ''}`}
          title={isCollapsed ? "Colar Backup" : "Permite colar o conteúdo JSON diretamente"}
        >
          <span className="flex items-center gap-2">
            <Clipboard className="w-4 h-4" /> 
            {!isCollapsed && <span>Colar Backup</span>}
          </span>
        </button>
      </div>

      <SyncStatusBadge
        status={syncStatus}
        lastSyncAt={syncLastSyncAt}
        onSyncNow={onSyncNow}
        onAuth={onAuth}
        onDisconnect={onDisconnect}
        isCollapsed={isCollapsed}
      />
    </aside>
  );
};
