import React, { useMemo, useState, useEffect } from 'react';
import { History, AlertCircle, Trash2, ChevronLeft, ChevronRight, Flag, Search, X, RotateCcw } from 'lucide-react';
import { StudyTask, ActivityBlock, Question } from '../types';

interface HistoryListProps {
  tasks: StudyTask[];
  historyPage: number;
  setHistoryPage: (page: number | ((p: number) => number)) => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onRestoreTask: (id: string) => void;
  onPermanentlyDeleteTask: (id: string) => void;
}

const ITEMS_PER_PAGE = 10;
type DateFilter = 'all' | 'last7' | 'last30';
type StatusFilter = 'all' | 'completed' | 'in_progress' | 'deleted';

export const HistoryList: React.FC<HistoryListProps> = ({
  tasks,
  historyPage,
  setHistoryPage,
  onOpenTask,
  onDeleteTask,
  onRestoreTask,
  onPermanentlyDeleteTask
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const filteredTasks = useMemo(() => {
    let result = [...tasks].reverse();

    if (statusFilter === 'deleted') {
      result = result.filter(task => task.deletedAt);
    } else {
      result = result.filter(task => !task.deletedAt);
    }

    // Text Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const normalizedTerm = term === 'cespe' ? 'cebraspe' : term;

      result = result.filter(task => {
        const matchesTerm = (val?: string) => val?.toLowerCase().includes(term);
        const matchesNormalized = (val?: string) => val?.toLowerCase().includes(normalizedTerm);

        return (
          matchesTerm(task.discipline) || 
          matchesTerm(task.assunto) ||
          matchesTerm(task.planejamento) ||
          matchesTerm(task.bank) ||
          (term === 'cespe' && task.bank?.toUpperCase() === 'CEBRASPE') ||
          (term === 'cebraspe' && task.bank?.toUpperCase() === 'CESPE')
        );
      });
    }

    // Status Filter
    if (statusFilter !== 'all' && statusFilter !== 'deleted') {
      result = result.filter(task => task.status === statusFilter);
    }

    // Date Filter
    if (dateFilter !== 'all') {
      const now = new Date();
      const limitDate = new Date();
      if (dateFilter === 'last7') limitDate.setDate(now.getDate() - 7);
      if (dateFilter === 'last30') limitDate.setDate(now.getDate() - 30);
      
      result = result.filter(task => new Date(task.date) >= limitDate);
    }

    return result;
  }, [tasks, searchTerm, statusFilter, dateFilter]);

  const totalPages = Math.ceil(filteredTasks.length / ITEMS_PER_PAGE);
  const currentHistoryTasks = useMemo(() => {
    const startIndex = (historyPage - 1) * ITEMS_PER_PAGE;
    return filteredTasks.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredTasks, historyPage]);

  useEffect(() => {
    setHistoryPage(1);
  }, [searchTerm, statusFilter, dateFilter, setHistoryPage]);

  const renderPerformance = (task: StudyTask) => {
    const allQ = (task.blocks || []).flatMap((b: ActivityBlock) => b.questions || []);
    const totalQ = allQ.length;
    const correct = allQ.filter((q: Question) => q.isCorrect === true).length;
    const errors = allQ.filter((q: Question) => q.isCorrect === false).length;
    const doubts = allQ.filter((q: Question) => q.hasDoubt).length;
    const answered = correct + errors;
    const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : null;
    const doubtsPct = totalQ > 0 ? Math.round((doubts / totalQ) * 100) : 0;

    if (accuracy === null && doubts === 0) {
      return <span className="text-gray-500 text-xs italic">S/N</span>;
    }

    return (
      <div className="flex flex-col gap-1">
        {accuracy !== null && (
          <>
            <span className="text-purple-400 font-bold whitespace-nowrap">{accuracy}%</span>
            <span className="text-xs font-semibold whitespace-nowrap">
              <span className="text-green-400">{correct} ✔</span>
              <span className="text-[#525252] mx-1">/</span>
              <span className="text-red-400">{errors} ✖</span>
            </span>
          </>
        )}
        {doubts > 0 && (
          <span className="text-yellow-500 text-xs font-semibold whitespace-nowrap mt-0.5 flex items-center gap-1">
            {doubts} <Flag className="w-3 h-3 fill-current" /> ({doubtsPct}%)
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="bg-[#333333] rounded-lg border border-[#404040] shadow-xl overflow-hidden">
      <div className="bg-[#262626] px-4 py-4 md:px-6 border-b border-[#404040]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-6 h-6 text-[#84cc16]" /> Histórico de Tarefas
            <span className="text-sm font-normal text-gray-400 bg-[#333333] px-2 py-0.5 rounded-full border border-[#404040]">
              {filteredTasks.length}
            </span>
          </h2>

          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
            {/* Search */}
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-purple-400 transition-colors" />
              <input
                type="text"
                placeholder="Buscar disciplina ou assunto..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-[#1a1a1a] border border-[#404040] text-gray-200 text-sm rounded-lg pl-9 pr-8 py-2 w-full md:w-64 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div className="flex items-center bg-[#1a1a1a] border border-[#404040] rounded-lg p-1 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all ${statusFilter === 'all' ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-gray-400 hover:text-white'}`}
              >
                Tudo
              </button>
              <button
                onClick={() => setStatusFilter('completed')}
                className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all ${statusFilter === 'completed' ? 'bg-green-600 text-white shadow-lg shadow-green-900/20' : 'text-gray-400 hover:text-white'}`}
              >
                Concluídas
              </button>
              <button
                onClick={() => setStatusFilter('in_progress')}
                className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all ${statusFilter === 'in_progress' ? 'bg-yellow-600 text-white shadow-lg shadow-yellow-900/20' : 'text-gray-400 hover:text-white'}`}
              >
                Ativas
              </button>
              <button
                onClick={() => setStatusFilter('deleted')}
                className={`px-3 py-1 text-xs font-bold rounded flex items-center gap-1.5 transition-all ${statusFilter === 'deleted' ? 'bg-red-700 text-white shadow-lg shadow-red-900/20' : 'text-gray-400 hover:text-white'}`}
              >
                Lixeira
              </button>
            </div>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="bg-[#1a1a1a] border border-[#404040] text-gray-300 text-xs font-bold rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500/50 transition-all cursor-pointer w-full md:w-auto"
            >
              <option value="all">Sempre</option>
              <option value="last7">Últimos 7 dias</option>
              <option value="last30">Últimos 30 dias</option>
            </select>
          </div>
        </div>
      </div>
      <div className="p-0">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{statusFilter === 'deleted' ? 'A lixeira está vazia.' : 'Nenhuma tarefa encontrada.'}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-4 md:hidden">
              {currentHistoryTasks.map((task: StudyTask) => (
                <button
                  key={task.id}
                  onClick={() => !task.deletedAt && onOpenTask(task.id)}
                  className="rounded-xl border border-[#404040] bg-[#2b2b2b] p-4 text-left transition-colors hover:bg-[#363636]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
                        {new Date(task.date).toLocaleDateString('pt-BR')}
                      </div>
                      <div className="mt-1 text-base font-bold text-white">
                        {task.tarefa ? `Tarefa ${task.tarefa} - ` : ''}{task.discipline}
                      </div>
                      {task.assunto && (
                        <div className="mt-1 text-sm text-gray-300">{task.assunto}</div>
                      )}
                    </div>
                    {task.deletedAt ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRestoreTask(task.id); }}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-[#84cc16] transition-colors hover:bg-[#84cc16]/10"
                        aria-label="Restaurar tarefa"
                        title="Restaurar"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-900/30 hover:text-red-300"
                        aria-label="Mover tarefa para lixeira"
                        title="Mover para lixeira"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="rounded-full bg-[#1a1a1a] px-2.5 py-1 text-gray-300">
                      {(task.blocks || []).length} blocos
                    </span>
                    <span className="rounded-full bg-[#1a1a1a] px-2.5 py-1 text-gray-300">
                      {(task.blocks || []).reduce((acc: number, b: ActivityBlock) => acc + (b.questions || []).length, 0)} questões
                    </span>
                    <span className={`rounded-full px-2.5 py-1 ${task.deletedAt ? 'bg-red-900/50 text-red-300' : task.status === 'completed' ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                      {task.deletedAt ? 'Na lixeira' : task.status === 'completed' ? 'Finalizada' : 'Em andamento'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="text-xs text-gray-500">
                      {task.planejamento || 'Sem Planejamento'} {task.meta && `> Meta ${task.meta}`} · {task.bank}
                    </div>
                    <div className="shrink-0">{renderPerformance(task)}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="text-xs uppercase bg-[#262626] text-gray-400 border-b border-[#404040]">
                <tr>
                  <th className="px-6 py-4 font-bold">Data</th>
                  <th className="px-6 py-4 font-bold">Disciplina</th>
                  <th className="px-6 py-4 font-bold">Blocos</th>
                  <th className="px-6 py-4 font-bold">Desempenho</th>
                  <th className="px-6 py-4 font-bold">Status</th>
                  <th className="px-6 py-4 font-bold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {currentHistoryTasks.map((task: StudyTask) => (
                  <tr
                    key={task.id}
                    onClick={() => !task.deletedAt && onOpenTask(task.id)}
                    className={`border-b border-[#404040] transition-colors ${task.deletedAt ? 'opacity-75' : 'hover:bg-[#3a3a3a] cursor-pointer'}`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(task.date).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 font-semibold text-white">
                      {task.tarefa ? `Tarefa ${task.tarefa} - ` : ''}{task.discipline}
                      {task.assunto && <span className="block text-sm text-gray-300 mt-1">{task.assunto}</span>}
                      <span className="block text-xs text-gray-500 font-normal mt-1">
                        {task.planejamento || 'Sem Planejamento'} {task.meta && `> Meta ${task.meta}`} &gt; Banca: {task.bank}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {(task.blocks || []).length} atividades
                      <span className="block text-xs text-gray-500 mt-1">
                        {(task.blocks || []).reduce((acc: number, b: ActivityBlock) => acc + (b.questions || []).length, 0)} questões
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {renderPerformance(task)}
                    </td>
                    <td className="px-6 py-4">
                      {task.deletedAt ? (
                        <span className="bg-red-900/50 text-red-300 px-2.5 py-1 rounded text-xs font-bold border border-red-800">Lixeira</span>
                      ) : task.status === 'completed' ? (
                        <span className="bg-green-900/50 text-green-400 px-2.5 py-1 rounded text-xs font-bold border border-green-800">Finalizada</span>
                      ) : (
                        <span className="bg-yellow-900/50 text-yellow-400 px-2.5 py-1 rounded text-xs font-bold border border-yellow-800 whitespace-nowrap">Em Andamento</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {task.deletedAt ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); onRestoreTask(task.id); }}
                            className="text-[#84cc16] hover:text-[#a3e635] p-2 hover:bg-[#84cc16]/10 rounded transition-colors"
                            title="Restaurar"
                          >
                            <RotateCcw className="w-5 h-5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onPermanentlyDeleteTask(task.id); }}
                            className="text-red-400 hover:text-red-300 p-2 hover:bg-red-900/30 rounded transition-colors"
                            title="Excluir definitivamente"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id); }}
                          className="text-red-400 hover:text-red-300 p-2 hover:bg-red-900/30 rounded transition-colors"
                          title="Mover para lixeira"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            
            {totalPages > 1 && (
              <div className="flex flex-col gap-3 px-4 py-4 border-t border-[#404040] bg-[#262626] md:flex-row md:items-center md:justify-between md:px-6">
                <span className="text-sm text-gray-400 font-medium">
                  Mostrando {(historyPage - 1) * ITEMS_PER_PAGE + 1} a {Math.min(historyPage * ITEMS_PER_PAGE, filteredTasks.length)} de {filteredTasks.length} tarefas
                </span>
                <div className="flex items-center justify-between gap-2 md:justify-start">
                  <button
                    onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                    disabled={historyPage === 1}
                    className="flex h-10 w-10 items-center justify-center rounded hover:bg-[#404040] text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  
                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }).map((_, idx) => {
                      const page = idx + 1;
                      if (
                        page === 1 ||
                        page === totalPages ||
                        (page >= historyPage - 1 && page <= historyPage + 1)
                      ) {
                        return (
                          <button
                            key={page}
                            onClick={() => setHistoryPage(page)}
                            className={`h-9 w-9 flex items-center justify-center rounded text-sm font-bold transition-colors ${
                              historyPage === page 
                                ? 'bg-purple-600 text-white' 
                                : 'hover:bg-[#404040] text-gray-400 hover:text-white'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      } else if (
                        page === historyPage - 2 ||
                        page === historyPage + 2
                      ) {
                        return <span key={page} className="text-gray-500 w-8 text-center pt-1">...</span>;
                      }
                      return null;
                    })}
                  </div>

                  <button
                    onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                    disabled={historyPage === totalPages}
                    className="flex h-10 w-10 items-center justify-center rounded hover:bg-[#404040] text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
