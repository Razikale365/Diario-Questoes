import React, { useState } from 'react';
import { ChevronDown, Edit2, Save, Columns, Brain, Flag, Eye, EyeOff, Check, SlidersHorizontal, Timer, Pause, Play, Focus } from 'lucide-react';
import { LayoutPatch, StudyTask } from '../types';
import { BANKS, PLANEJAMENTOS, DISCIPLINAS } from '../utils/constants';
import { DEFAULT_ACTIVITY_LAYOUT, LAYOUT_TEMPLATES } from '../utils/layout';
import { formatDuration } from '../utils/productInsights';

interface TaskEditForm {
  planejamento: string;
  meta: string;
  tarefa: string;
  assunto: string;
  discipline: string;
  bank: string;
}

interface TaskHeaderProps {
  task: StudyTask;
  isEditing: boolean;
  editForm: TaskEditForm;
  setEditForm: (form: TaskEditForm) => void;
  onSave: () => void;
  onCancel: () => void;
  onEditStart: () => void;
  onFinishTask?: () => void;
  onPause?: () => void;
  onReopen?: () => void;
  onUpdateAllLayouts?: (layout: LayoutPatch) => void;
  elapsedSeconds?: number;
  isTimerRunning?: boolean;
  onStartTimer?: () => void;
  onPauseTimer?: () => void;
  onFocusMode?: () => void;
  showDate?: boolean;
  showStats?: boolean;
  onToggleStats?: () => void;
}

export const TaskHeader: React.FC<TaskHeaderProps> = ({
  task,
  isEditing,
  editForm,
  setEditForm,
  onSave,
  onCancel,
  onEditStart,
  onFinishTask,
  onPause,
  onReopen,
  onUpdateAllLayouts,
  elapsedSeconds = 0,
  isTimerRunning = false,
  onStartTimer,
  onPauseTimer,
  onFocusMode,
  showDate,
  showStats = true,
  onToggleStats
}) => {
  const [isCopied, setIsCopied] = useState(false);
  const [showMobileMeta, setShowMobileMeta] = useState(false);
  const [showMobileLayout, setShowMobileLayout] = useState(false);

  if (isEditing) {
    return (
      <div className="bg-[#333333] p-6 rounded-lg border border-[#404040] shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Edit2 className="w-5 h-5 text-purple-500" />
            Editar Informações da Tarefa
          </h3>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors font-medium">Cancelar</button>
            <button onClick={onSave} className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all active:scale-95 shadow-lg shadow-purple-900/20">Salvar</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Planejamento</label>
            <select
              value={editForm.planejamento}
              onChange={(e) => setEditForm({...editForm, planejamento: e.target.value})}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            >
              <option value="">Nenhum</option>
              {PLANEJAMENTOS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Meta</label>
            <input
              type="number"
              value={editForm.meta}
              onChange={(e) => setEditForm({...editForm, meta: e.target.value})}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Tarefa</label>
            <input
              type="number"
              value={editForm.tarefa}
              onChange={(e) => setEditForm({...editForm, tarefa: e.target.value})}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Disciplina</label>
            <select
              value={editForm.discipline}
              onChange={(e) => setEditForm({...editForm, discipline: e.target.value})}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            >
              <option value="">Selecione</option>
              {DISCIPLINAS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Assunto</label>
            <input
              type="text"
              value={editForm.assunto}
              onChange={(e) => setEditForm({...editForm, assunto: e.target.value})}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-black text-gray-500 tracking-widest mb-1.5">Banca</label>
            <select
              value={editForm.bank}
              onChange={(e) => {
                let val = e.target.value;
                if (val === 'CESPE') val = 'CEBRASPE';
                setEditForm({...editForm, bank: val});
              }}
              className="w-full bg-[#2d2d2d] border border-[#404040] rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500 transition-colors"
            >
              <option value="">Nenhuma</option>
              {['CEBRASPE', 'FCC', 'FGV', 'VUNESP', 'CESPE', 'Outra'].map(b => (
                <option key={b} value={b === 'CESPE' ? 'CEBRASPE' : b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  }

  const handleGlobalLayout = (key: 'type' | 'columns' | 'rows', val: string | number) => {
    if (!onUpdateAllLayouts || task.blocks.length === 0) return;
    const firstLayout = task.blocks[0].layout || DEFAULT_ACTIVITY_LAYOUT;
    const newLayout = { ...firstLayout, [key]: val };
    onUpdateAllLayouts(newLayout);
  };

  const generateAIPrompt = () => {
    // Filter questions by category to save user time and increase AI focus
    const reviewData = task.blocks.map(block => {
      const qs = block.questions || [];
      return {
        title: block.title || block.lesson || 'Atividade',
        bank: block.bank || task.bank || 'Não informada',
        // Group by 'Confidence x Result' matrix
        critical: qs.filter(q => q.hasDoubt && q.isCorrect === false),
        unsure: qs.filter(q => q.hasDoubt && q.isCorrect === true),
        errors: qs.filter(q => !q.hasDoubt && q.isCorrect === false)
      };
    }).filter(b => b.critical.length > 0 || b.unsure.length > 0 || b.errors.length > 0);

    if (reviewData.length === 0) {
      alert("Nada para revisar ainda! Continue fazendo questões.");
      return;
    }

    const sections = reviewData.map(b => {
      let content = `### 📌 ${b.title} (${b.bank})\n`;
      
      if (b.critical.length > 0) {
        content += `**🚨 ERROS CRÍTICOS (Dúvida + Erro):**\n- Questões: ${b.critical.map(q => q.number).join(', ')}\n`;
        content += `*Objetivo: Entender por que a intuição falhou e onde está o buraco conceitual.*\n`;
      }
      
      if (b.unsure.length > 0) {
        content += `**⚠️ LACUNAS DE CONFIANÇA (Dúvida + Acerto):**\n- Questões: ${b.unsure.map(q => q.number).join(', ')}\n`;
        content += `*Objetivo: Sanar a dúvida para que esse acerto não seja apenas sorte/intuição rasa.*\n`;
      }
      
      if (b.errors.length > 0) {
        content += `**❌ ERROS DIRETOS:**\n- Questões: ${b.errors.map(q => q.number).join(', ')}\n`;
        content += `*Objetivo: Corrigir a interpretação ou o conceito que eu achei que sabia.*\n`;
      }

      return content;
    }).join('\n');

    const prompt = `---
ATUAÇÃO: Tutor Especialista em concursos para AUDITOR FISCAL.
OBJETIVO: Sanar lacunas teóricas e técnicas para garantir alta performance.
CONTEXTO: Disciplina de ${task.discipline}${task.assunto ? ` > ${task.assunto}` : ''}.
MÉTODO: Vou te passar as questões que errei ou tive dúvidas. Use o material (PDF/NotebookLM) que eu disponibilizei para extrair as respostas.

---

### 📋 LISTA DE REVISÃO

${sections}

---

### 🛠️ INSTRUÇÕES PARA CADA PONTO:
1. **CONCEITO CENTRAL**: Explique a base doutrinária/legal por trás dessas questões.
2. **ALERTA DE PEGADINHA**: Aponte como a banca costuma tentar enganar o candidato nesse tema.
3. **PONTO DE MEMORIZAÇÃO**: Forneça um mnemônico ou uma frase curta para fixação definitiva (importante para Auditoria/Contabilidade/Direito).
4. **PRIORIDADE**: Comece pelos ERROS CRÍTICOS, pois são os maiores riscos para o dia da prova.

*Linguagem: Direta, técnica e focada em salvar meu tempo.*`;

    navigator.clipboard.writeText(prompt);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const firstLayout = task.blocks[0]?.layout || DEFAULT_ACTIVITY_LAYOUT;
  const timerDeltaSeconds = task.idealMinutes ? elapsedSeconds - task.idealMinutes * 60 : null;

  return (
    <div className="bg-[#333333] p-4 md:p-6 rounded-lg border border-[#404040] shadow-xl relative group overflow-hidden">
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-purple-600/10 blur-3xl rounded-full" />
      

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
        <div className="flex-1">
          <div className="text-xs text-purple-400 font-black uppercase tracking-[0.2em] mb-1">
            {task.planejamento || 'Sem Planejamento'} {task.meta && `> Meta ${task.meta}`}
          </div>
          <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-3">
            <span>{task.tarefa ? `Tarefa ${task.tarefa} - ` : ''}{task.discipline}</span>
            <button 
              onClick={onEditStart} 
              className="p-1.5 text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-all"
              title="Editar Informações da Tarefa"
            >
              <Edit2 className="w-4 h-4" />
            </button>
          </h2>
          {task.assunto && (
            <p className="text-lg text-gray-300 mb-2 font-medium">{task.assunto}</p>
          )}
          <div className="md:hidden mt-4 flex flex-col gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setShowMobileMeta(prev => !prev)}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#525252] bg-[#2d2d2d] px-4 py-2 text-sm font-bold text-gray-200 transition-colors hover:border-purple-500/40 hover:text-white"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showMobileMeta ? 'rotate-180' : ''}`} />
                Detalhes
              </button>
              {onUpdateAllLayouts && task.blocks.length > 0 && (
                <button
                  onClick={() => setShowMobileLayout(prev => !prev)}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#525252] bg-[#2d2d2d] px-4 py-2 text-sm font-bold text-gray-200 transition-colors hover:border-purple-500/40 hover:text-white"
                >
                  <SlidersHorizontal className="h-4 w-4 text-purple-400" />
                  Layout
                </button>
              )}
            </div>
            {showMobileMeta && (
              <div className="rounded-2xl border border-[#404040] bg-[#2d2d2d] p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-gray-300">
                  <span className="rounded-full bg-[#1f1f1f] px-2.5 py-1">Banca: {task.bank}</span>
                  <span className="rounded-full bg-[#1f1f1f] px-2.5 py-1">{task.blocks.length} atividades</span>
                  <span className="rounded-full bg-[#1f1f1f] px-2.5 py-1">{task.blocks.flatMap(b => b.questions || []).length} questões</span>
                  {showDate && (
                    <span className="rounded-full bg-[#1f1f1f] px-2.5 py-1">{new Date(task.date).toLocaleDateString('pt-BR')}</span>
                  )}
                </div>
                <div className="mt-3 text-sm text-gray-400">
                  {task.planejamento || 'Sem Planejamento'} {task.meta && `> Meta ${task.meta}`}
                </div>
              </div>
            )}
            {showMobileLayout && onUpdateAllLayouts && task.blocks.length > 0 && (
              <div className="fixed inset-x-0 bottom-0 z-[80] rounded-t-3xl border border-[#404040] bg-[#2d2d2d] p-5 pb-24 shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-black tracking-widest text-purple-400">Layout Global</span>
                  <button
                    onClick={() => setShowMobileLayout(false)}
                    className="rounded-lg bg-[#1f1f1f] px-3 py-1.5 text-xs font-bold text-gray-300"
                  >
                    Fechar
                  </button>
                </div>
                <div className="mb-4 text-xs font-bold text-gray-500">{firstLayout.columns} col · {firstLayout.rows} lin</div>
                <div className="flex items-center gap-2 bg-[#1f1f1f] p-1 rounded-lg border border-[#3d3d3d]">
                  <button 
                    onClick={() => handleGlobalLayout('type', 'columns')}
                    className={`flex-1 px-3 py-2 rounded text-[11px] font-bold transition-all ${task.blocks.every(b => b.layout?.type === 'columns') ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-gray-400 hover:bg-[#3d3d3d]'}`}
                  >
                    COLUNAS
                  </button>
                  <button 
                    onClick={() => handleGlobalLayout('type', 'grid')}
                    className={`flex-1 px-3 py-2 rounded text-[11px] font-bold transition-all ${task.blocks.every(b => b.layout?.type === 'grid') ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-gray-400 hover:bg-[#3d3d3d]'}`}
                  >
                    GRADE
                  </button>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1.5 flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Colunas</span>
                      <span className="text-xs font-black text-purple-400 bg-purple-500/10 px-1.5 rounded">{firstLayout.columns}</span>
                    </div>
                    <input
                      type="range" min="2" max="8" value={firstLayout.columns}
                      onChange={(e) => handleGlobalLayout('columns', parseInt(e.target.value))}
                      className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex justify-between items-center">
                      <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Linhas</span>
                      <span className="text-xs font-black text-purple-400 bg-purple-500/10 px-1.5 rounded">{firstLayout.rows}</span>
                    </div>
                    <input
                      type="range" min="1" max="20" value={firstLayout.rows}
                      onChange={(e) => handleGlobalLayout('rows', parseInt(e.target.value))}
                      className="w-full h-2 bg-[#404040] rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="hidden md:flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-400">
            <span className="font-semibold">Banca: {task.bank}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#525252]" />
            <span className="font-semibold uppercase text-[10px] tracking-widest">{task.blocks.length} atividades</span>
            
            {(() => {
              const allQuestions = task.blocks.flatMap(b => b.questions || []);
              const totalQ = allQuestions.length;
              const correct = allQuestions.filter(q => q.isCorrect === true).length;
              const errors = allQuestions.filter(q => q.isCorrect === false).length;
              const doubts = allQuestions.filter(q => q.hasDoubt).length;
              const doubtsCorrect = allQuestions.filter(q => q.hasDoubt && q.isCorrect === true).length;
              const doubtsIncorrect = allQuestions.filter(q => q.hasDoubt && q.isCorrect === false).length;
              const answered = correct + errors;
              const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : null;
              const doubtsPct = totalQ > 0 ? Math.round((doubts / totalQ) * 100) : 0;
              
              if (accuracy === null && doubts === 0) return null;
              
              return (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#525252]" />
                  <span className="font-semibold uppercase text-[10px] tracking-widest">{totalQ} questões</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#525252]" />
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={onToggleStats}
                      title={showStats ? "Ocultar Estatísticas (Evitar Ansiedade)" : "Mostrar Estatísticas"}
                      className="flex items-center gap-1.5 animate-in fade-in slide-in-from-right-2 duration-300 hover:opacity-75 transition-opacity"
                    >
                      {showStats ? (
                        <span className="font-semibold flex items-center gap-1.5">
                          {accuracy !== null && (
                            <span className="flex items-center gap-1">
                              <span className="text-green-400">{correct} ✔</span>{' '}
                              <span className="text-[#525252]">/</span>{' '}
                              <span className="text-red-400">{errors} ✖</span>{' '}
                              <span className="text-purple-400">({accuracy}%)</span>
                            </span>
                          )}
                          {doubts > 0 && (
                            <>
                              {accuracy !== null && <span className="text-[#525252] font-normal mx-1">|</span>}
                              <span className="text-yellow-500 flex items-center gap-1">
                                {doubts} <Flag className="w-3 h-3 fill-current" /> ({doubtsPct}%)
                                <span className="text-[10px] text-gray-500 font-bold ml-1">
                                  ({doubtsCorrect} <span className="text-green-400/70 font-black">✔</span> / {doubtsIncorrect} <span className="text-red-400/70 font-black">✖</span>)
                                </span>
                              </span>
                            </>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black text-gray-500 tracking-[0.2em] uppercase italic bg-[#404040]/50 px-2 py-0.5 rounded border border-[#525252]/20 shadow-sm animate-in zoom-in-95 duration-200 hover:text-purple-400 hover:border-purple-500/30 transition-all">
                          ESTATÍSTICAS OCULTAS
                        </span>
                      )}
                    </button>

                    {onToggleStats && (
                      <button
                        onClick={onToggleStats}
                        title={showStats ? "Ocultar Estatísticas (Evitar Ansiedade)" : "Mostrar Estatísticas"}
                        className="p-1.5 hover:bg-[#404040] rounded-lg transition-all active:scale-90 group/toggle"
                      >
                        {showStats ? (
                          <EyeOff className="w-3.5 h-3.5 text-gray-500 group-hover/toggle:text-purple-400 transition-colors" />
                        ) : (
                          <Eye className="w-3.5 h-3.5 text-purple-400 group-hover/toggle:text-purple-300 transition-colors" />
                        )}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

            {showDate && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[#525252]" />
                <span className="font-semibold">{new Date(task.date).toLocaleDateString('pt-BR')}</span>
              </>
            )}
          </div>
          
          {onUpdateAllLayouts && task.blocks.length > 0 && (
            <div className="hidden md:flex mt-6 pt-4 border-t border-[#404040]/50 flex-wrap items-center gap-8 animate-in fade-in slide-in-from-left-4 duration-500 delay-150">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase font-black text-purple-500 tracking-widest">Layout Global</span>
                <div className="flex items-center gap-2 bg-[#2d2d2d] p-1 rounded-lg border border-[#3d3d3d]">
                  <button 
                    onClick={() => handleGlobalLayout('type', 'columns')}
                    className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${task.blocks.every(b => b.layout?.type === 'columns') ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-gray-400 hover:bg-[#3d3d3d]'}`}
                  >
                    COLUNAS
                  </button>
                  <button 
                    onClick={() => handleGlobalLayout('type', 'grid')}
                    className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${task.blocks.every(b => b.layout?.type === 'grid') ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20' : 'text-gray-400 hover:bg-[#3d3d3d]'}`}
                  >
                    GRADE
                  </button>
                </div>
              </div>

              <div className="flex-1 max-w-[150px]">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Colunas</span>
                  <span className="text-xs font-black text-purple-400 bg-purple-500/10 px-1.5 rounded">{firstLayout.columns}</span>
                </div>
                <input
                  type="range" min="2" max="8" value={firstLayout.columns}
                  onChange={(e) => handleGlobalLayout('columns', parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[#404040] rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div className="flex-1 max-w-[150px]">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[10px] uppercase font-bold text-gray-500 tracking-widest">Linhas</span>
                  <span className="text-xs font-black text-purple-400 bg-purple-500/10 px-1.5 rounded">{firstLayout.rows}</span>
                </div>
                <input
                  type="range" min="1" max="20" value={firstLayout.rows}
                  onChange={(e) => handleGlobalLayout('rows', parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[#404040] rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {LAYOUT_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => onUpdateAllLayouts(template.layout)}
                    className="rounded-lg border border-[#404040] bg-[#2d2d2d] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-300 transition-colors hover:border-purple-500/50 hover:text-white"
                    title={template.description}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 w-full md:w-auto">
          {(onStartTimer || onPauseTimer) && (
            <div className="rounded-xl border border-[#404040] bg-[#2d2d2d] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <Timer className="h-3.5 w-3.5 text-[#84cc16]" />
                    Tempo
                  </div>
                  <div className="mt-1 text-xl font-black text-white">{formatDuration(elapsedSeconds)}</div>
                  {task.idealMinutes && (
                    <div className={`mt-1 text-xs font-bold ${timerDeltaSeconds && timerDeltaSeconds > 0 ? 'text-red-300' : 'text-[#84cc16]'}`}>
                      Ideal: {task.idealMinutes}min
                    </div>
                  )}
                </div>
                <button
                  onClick={isTimerRunning ? onPauseTimer : onStartTimer}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${isTimerRunning ? 'bg-yellow-500/15 text-yellow-300' : 'bg-[#84cc16] text-black'}`}
                  title={isTimerRunning ? 'Pausar timer' : 'Iniciar timer'}
                >
                  {isTimerRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
              </div>
            </div>
          )}

          {onFocusMode && (
            <button
              onClick={onFocusMode}
              className="flex items-center justify-center gap-2 rounded-xl border border-[#525252] bg-[#2d2d2d] px-5 py-3 text-sm font-bold text-gray-200 transition-colors hover:border-purple-500/50 hover:text-white"
            >
              <Focus className="h-4 w-4 text-purple-400" />
              Modo foco
            </button>
          )}

          <button 
            onClick={generateAIPrompt}
            className={`group relative flex items-center justify-center gap-2 px-5 py-3 rounded-xl transition-all duration-300 active:scale-95 border ${isCopied ? 'bg-[#84cc16]/10 border-[#84cc16]/50 shadow-[0_0_15px_rgba(132,204,22,0.2)]' : 'bg-[#2d2d2d] hover:bg-[#3d3d3d] border-purple-500/30 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)]'}`}
          >
            {isCopied ? (
              <>
                <Check className="w-5 h-5 text-[#84cc16]" />
                <span className="text-sm font-bold text-[#84cc16]">Prompt Copiado!</span>
              </>
            ) : (
              <>
                <Brain className="w-5 h-5 text-purple-400" />
                <span className="text-sm font-bold text-gray-200">Revisar com IA</span>
              </>
            )}
          </button>

          {onReopen && (
            <button
              onClick={onReopen}
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-xl active:scale-95 group/btn"
            >
              Reabrir Tarefa
            </button>
          )}
          {onPause && (
            <button
              onClick={onPause}
              className="bg-[#404040] hover:bg-[#525252] text-gray-300 hover:text-white px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 border border-[#525252]"
              title="Deixar esta tarefa em aberto e voltar ao menu"
            >
              <Columns className="w-4 h-4" />
              <span>Trocar Tarefa</span>
            </button>
          )}

          {onFinishTask && (
            <button
              onClick={onFinishTask}
              className="bg-[#84cc16] hover:bg-[#65a30d] text-white px-8 py-4 rounded-xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl active:scale-95 group/btn"
            >
              <Save className="w-5 h-5 flex-shrink-0" />
              <span className="text-lg">Finalizar Tarefa</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
