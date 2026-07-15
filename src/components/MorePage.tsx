import React from 'react';
import { Archive, BarChart3, BookOpen, Database, History, Map, RefreshCw, Settings, Sparkles, Target } from 'lucide-react';

export const MORE_SECTIONS = [
  { id: 'meta', label: 'Meta atual', description: 'Importação e visão da meta LS', icon: Target },
  { id: 'review', label: 'Revisão', description: 'Banco e revisões do caderno', icon: RefreshCw },
  { id: 'courses', label: 'Cursos', description: 'Materiais vinculados', icon: BookOpen },
  { id: 'insights', label: 'Insights', description: 'Evidências e pontos fracos', icon: BarChart3 },
  { id: 'maps', label: 'Mapas', description: 'Cobertura por assunto', icon: Map },
  { id: 'history', label: 'Histórico', description: 'Metas e execuções anteriores', icon: History },
  { id: 'generator', label: 'Próxima meta', description: 'Rascunho assistido, sem inventar LS', icon: Sparkles },
  { id: 'archived', label: 'Arquivadas', description: 'Itens guardados sem poluir tarefas', icon: Archive },
  { id: 'backup', label: 'Backup e sincronização', description: 'Proteção dos seus dados', icon: Database },
  { id: 'account', label: 'Conta', description: 'Preferências e acesso', icon: Settings },
] as const;

export const MorePage: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => (
  <section aria-labelledby="more-title" className="space-y-5">
    <div>
      <p className="text-[11px] font-black uppercase tracking-[0.25em] text-purple-300">Ferramentas</p>
      <h1 id="more-title" className="text-3xl font-black text-white">Mais, quando você precisar</h1>
      <p className="mt-2 text-sm text-gray-400">O trabalho diário ficou nas três primeiras telas. Configuração e análise vivem aqui.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {MORE_SECTIONS.map(({ id, label, description, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onOpen(id)} className="min-h-24 rounded-xl border border-white/10 bg-[#242424] p-4 text-left transition hover:border-purple-400/50 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#84cc16]">
          <Icon className="h-5 w-5 text-purple-300" />
          <strong className="mt-3 block text-sm text-white">{label}</strong>
          <span className="mt-1 block text-xs text-gray-500">{description}</span>
        </button>
      ))}
    </div>
  </section>
);
