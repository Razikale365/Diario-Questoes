import React, { memo, useRef, forwardRef, useState, useEffect } from 'react';
import { Lock, Unlock, Edit2, Trash2, CheckSquare, Check, X, Flag, Eye, EyeOff, GripVertical, LayoutGrid, Columns, Target, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActivityBlock, Question } from '../types';
import { useSnapResizer } from '../hooks/useSnapResizer';

interface PerformanceStats {
  total: number;
  answered: number;
  correct: number;
  incorrect: number;
  doubts: number;
  accuracy: number;
  doubtsCorrect: number;
  doubtsIncorrect: number;
}

interface ActivityBlockCardProps {
  block: ActivityBlock;
  index: number;
  onUpdateQuestion: (blockId: string, qNumber: number, updates: Partial<Question>) => void;
  onToggleLock: (blockId: string) => void;
  onEditBlock: (block?: ActivityBlock) => void;
  onDeleteBlock: (blockId: string) => void;
  onImportGabarito: (blockId: string) => void;
  onToggleLayout: (blockId: string) => void;
  globalShowStats: boolean;
  onToggleStats: (blockId: string) => void;
  onUpdateLayout: (blockId: string, layout: { width?: number; rowSpan?: number }) => void;
  onEditSection?: (sectionTitle: string) => void;
  onAutoSnap?: () => void;
  onRenameSection?: (oldTitle: string, newTitle: string) => void;
  onToggleGabarito: (blockId: string) => void;
  onToggleSectionLock?: (sectionTitle: string) => void;
  onToggleSectionStats?: (sectionTitle: string) => void;
  sectionStats?: PerformanceStats;
}

const PerformanceBadge: React.FC<{ stats: PerformanceStats; compact?: boolean }> = ({ stats, compact }) => {
  if (stats.answered === 0 && stats.doubts === 0) return null;

  return (
    <div className={`flex items-center gap-3 px-3 py-1.5 bg-black/20 rounded-xl border border-white/5 backdrop-blur-sm ${compact ? 'scale-90 origin-right' : ''}`}>
      {stats.answered > 0 && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-[#84cc16] font-black text-xs">{stats.correct}</span>
            <Check className="w-3 h-3 text-[#84cc16]/50" />
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-red-500 font-black text-xs">{stats.incorrect}</span>
            <X className="w-3 h-3 text-red-500/50" />
          </div>
          <div className="w-[1px] h-3 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-purple-400 font-black text-xs">{stats.accuracy.toFixed(0)}%</span>
            <Target className="w-3 h-3 text-purple-400/50" />
          </div>
        </>
      )}
      {stats.doubts > 0 && (
        <>
          {stats.answered > 0 && <div className="w-[1px] h-3 bg-white/10" />}
          <div className="flex items-center gap-1.5">
            <span className="text-orange-500 font-black text-xs">{stats.doubts}</span>
            <Flag className="w-3 h-3 text-orange-500/50 fill-orange-500/20" />
            <span className="text-[10px] text-gray-500 font-bold ml-0.5">
              ({stats.doubtsCorrect} <span className="text-[#84cc16]/70">✔</span> / {stats.doubtsIncorrect} <span className="text-red-500/70">✖</span>)
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export const ActivityBlockCard = memo(forwardRef<HTMLDivElement, ActivityBlockCardProps>((props, ref) => {
  const {
    block,
    onUpdateQuestion,
    onToggleLock,
    onEditBlock,
    onDeleteBlock,
    onImportGabarito,
    onToggleLayout,
    onToggleStats,
    onUpdateLayout,
    onEditSection,
    onAutoSnap,
    onRenameSection,
    onToggleSectionLock,
    onToggleSectionStats,
    onToggleGabarito,
    globalShowStats,
    sectionStats
  } = props;

  const [isRenaming, setIsRenaming] = useState(false);
  const [tempTitle, setTempTitle] = useState(block.title);

  useEffect(() => {
    setTempTitle(block.title);
  }, [block.title]);

  const handleFinishRename = () => {
    if (tempTitle !== block.title && onRenameSection) {
      onRenameSection(block.title, tempTitle);
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFinishRename();
    if (e.key === 'Escape') {
      setTempTitle(block.title);
      setIsRenaming(false);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: block.id,
    disabled: block.isLocked // Lock-to-Anchor requirement
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    opacity: isDragging ? 0.6 : 1,
    gridRowEnd: `span ${block.layout?.rowSpan || 1}`
  };

  const { onMouseDown, isResizing, currentColSpan: ghostWidth, currentRowSpan: ghostHeight } = useSnapResizer({
    initialColSpan: block.layout?.width || 12,
    initialRowSpan: block.layout?.rowSpan || 1,
    onResizeEnd: (dims) => onUpdateLayout(block.id, dims)
  });

  const getLayoutClasses = () => {
    if (block.layout?.type === 'grid') return 'grid gap-4';
    return 'flex flex-wrap gap-4';
  };

  const getDynamicStyles = () => {
    if (block.layout?.type === 'grid') {
      return {
        gridTemplateColumns: `repeat(${block.layout.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${block.layout.rows}, minmax(0, 1fr))`
      };
    }
    return {};
  };

  const currentWidth = block.layout?.width || 12;
  const colSpanMap: Record<number, string> = {
    3: 'col-span-12 xl:col-span-3',
    6: 'col-span-12 xl:col-span-6',
    9: 'col-span-12 xl:col-span-9',
    12: 'col-span-12'
  };

  // Renders a Section Header
  if (block.isSection) {
    return (
      <motion.div
        ref={setNodeRef}
        style={style}
        className="col-span-12 mt-10 mb-4 group/section"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center justify-between border-b-2 border-white/10 pb-4 relative">
          <div className="flex items-center gap-4 flex-1">
            <div 
              {...attributes} 
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-2 text-white/20 hover:text-white hover:bg-white/10 rounded transition-all"
            >
              <GripVertical className="w-6 h-6" />
            </div>
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1 max-w-xl">
                <input
                  autoFocus
                  type="text"
                  value={tempTitle}
                  onChange={e => setTempTitle(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={handleKeyDown}
                  className="bg-[#2d2d2d] border-2 border-purple-500 rounded-xl px-4 py-2 text-3xl font-black text-white w-full outline-none"
                />
                <button onClick={handleFinishRename} className="p-2 bg-purple-600 rounded-lg text-white">
                  <Check className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <h2 
                  onDoubleClick={() => setIsRenaming(true)}
                  className="text-3xl font-black text-white/90 tracking-tight uppercase cursor-text group-hover/section:text-white transition-colors"
                  title="Double click to rename"
                >
                  {block.title}
                </h2>
                {sectionStats && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-xl border border-white/5 shadow-inner">
                    <CheckSquare className="w-4 h-4 text-[#84cc16]" />
                    <span className="text-sm font-black text-gray-400">
                      {sectionStats.total} 
                      <span className="text-[10px] text-gray-500 uppercase ml-1.5 tracking-wider">questões no total</span>
                    </span>
                  </div>
                )}
                {globalShowStats && block.showStats !== false && sectionStats && (
                  <PerformanceBadge stats={sectionStats} />
                )}
              </div>
            )}
          </div>
          
          {!isRenaming && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5 mr-2">
                <button
                  onClick={() => onToggleSectionStats?.(block.title)}
                  className={`p-2 rounded-lg transition-all ${block.showStats === false ? 'text-gray-600 hover:text-gray-400' : 'text-purple-500 hover:bg-purple-500/10'}`}
                  title={block.showStats === false ? "Mostrar desempenho da seção" : "Ocultar desempenho da seção"}
                >
                  {block.showStats === false ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
                <button
                  onClick={() => onToggleSectionLock?.(block.title)}
                  className={`p-2 rounded-lg transition-colors ${block.isLocked ? 'text-purple-500 bg-purple-500/10' : 'text-gray-600 hover:text-white hover:bg-white/5'}`}
                  title={block.isLocked ? "Desbloquear seção" : "Bloquear seção para edição"}
                >
                  {block.isLocked ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                </button>
              </div>
              <button
                onClick={() => onAutoSnap?.()}
                className="px-4 py-2 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 rounded-xl text-xs font-bold border border-purple-500/20 transition-all flex items-center gap-2"
                title="Organizar blocos desta aula automaticamente"
              >
                <LayoutGrid className="w-4 h-4" />
                Auto-Snap
              </button>
              <button
                onClick={() => onEditSection?.(block.title)}
                className="px-4 py-2 bg-[#84cc16]/10 text-[#84cc16] hover:bg-[#84cc16]/20 rounded-xl text-xs font-bold border border-[#84cc16]/20 transition-all flex items-center gap-2"
                title="Ajustar todos os blocos desta seção"
              >
                <Edit2 className="w-4 h-4" />
                Editar Seção
              </button>
              <button 
                onClick={() => onDeleteBlock(block.id)}
                className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  // Activity Block Logic
  const blockStatsRaw = {
    total: block.questions.length,
    answered: block.questions.filter(q => q.answer).length,
    correct: block.questions.filter(q => q.isCorrect === true).length,
    incorrect: block.questions.filter(q => q.isCorrect === false).length,
    doubts: block.questions.filter(q => q.hasDoubt).length,
    doubtsCorrect: block.questions.filter(q => q.hasDoubt && q.isCorrect === true).length,
    doubtsIncorrect: block.questions.filter(q => q.hasDoubt && q.isCorrect === false).length,
  };
  const accuracy = blockStatsRaw.answered > 0 ? (blockStatsRaw.correct / blockStatsRaw.answered) * 100 : 0;
  const currentBlockStats: PerformanceStats = { ...blockStatsRaw, accuracy };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${colSpanMap[currentWidth] || 'col-span-12'}`}
    >
      <motion.div
        ref={containerRef}
        className={`bg-[#262626] border-2 h-full ${block.isLocked ? 'border-[#333333]' : 'border-[#404040] hover:border-purple-500/30'} flex flex-col rounded-2xl p-4 transition-all overflow-hidden ${isResizing ? 'ring-2 ring-purple-500' : ''}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div 
              {...attributes} 
              {...listeners}
              className={`p-1.5 rounded transition-all ${block.isLocked ? 'cursor-not-allowed text-white/5' : 'cursor-grab active:cursor-grabbing text-white/20 hover:bg-white/10 hover:text-white'}`}
            >
              <GripVertical className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-black uppercase text-purple-400/80 bg-purple-500/10 px-2 py-0.5 rounded tracking-widest">{block.bank || 'Outra'}</span>
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-tight line-clamp-1">{block.title}</h3>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5">
            {globalShowStats && block.showStats !== false && (
              <PerformanceBadge stats={currentBlockStats} compact />
            )}
            <button onClick={() => onToggleStats(block.id)} className={`p-1.5 rounded-lg transition-all ${block.showStats === false ? 'text-gray-600 hover:text-gray-400' : 'text-purple-500 hover:bg-purple-500/10'}`}>
              {block.showStats === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button onClick={() => onToggleLock(block.id)} className={`p-1.5 rounded-lg transition-colors ${block.isLocked ? 'text-purple-500 bg-purple-500/10' : 'text-gray-600 hover:text-white hover:bg-white/5'}`} title={block.isLocked ? "Desbloquear bloco" : "Bloquear bloco"}>
              {block.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
            <button 
              onClick={() => onToggleGabarito(block.id)} 
              className={`p-1.5 rounded-lg transition-all ${block.showGabarito ? 'text-purple-400 bg-purple-500/10' : 'text-gray-600 hover:text-white hover:bg-white/5'}`}
              title={block.showGabarito ? "Ocultar Gabarito Manual" : "Mostrar Gabarito Manual (Editar)"}
            >
              <BookOpen className="w-4 h-4" />
            </button>
            <button 
              onClick={() => onImportGabarito(block.id)} 
              className="p-1.5 text-gray-600 hover:text-[#84cc16] hover:bg-[#84cc16]/10 rounded-lg transition-colors"
              title="Importar Gabarito"
            >
              <CheckSquare className="w-4 h-4" />
            </button>
            <button onClick={() => onEditBlock(block)} className="p-1.5 text-gray-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors" title="Editar bloco"><Edit2 className="w-4 h-4" /></button>
            <button onClick={() => onDeleteBlock(block.id)} className="p-1.5 text-gray-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" title="Excluir bloco"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4 text-[10px] font-bold text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Aula / Assunto">
            <Columns className="w-3 h-3 text-purple-500" /> {block.lesson}
          </span>
          {block.pages && (
            <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Páginas do material">
              <BookOpen className="w-3 h-3 text-blue-400" /> {block.pages}
            </span>
          )}
          <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Total de questões">
            <CheckSquare className="w-3 h-3 text-[#84cc16]" /> {block.questions.length} questões
          </span>
        </div>

        <div className={`overflow-y-auto pr-1 flex-1 scrollbar-thin scrollbar-thumb-white/5 scrollbar-track-transparent ${getLayoutClasses()}`} style={getDynamicStyles()}>
          {block.questions.map((q) => (
            <div key={q.number} className="group/q flex flex-col gap-1.5 p-2 bg-[#1a1a1a] rounded-xl border border-white/5 hover:border-white/10 transition-all">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span 
                    onDoubleClick={() => onUpdateQuestion(block.id, q.number, { isMultipleChoice: !q.isMultipleChoice })}
                    className={`text-[10px] p-2 font-black rounded-lg text-gray-400 w-6 h-6 flex items-center justify-center cursor-pointer select-none transition-all ${q.isMultipleChoice ? 'bg-purple-600/30 text-purple-400 ring-1 ring-purple-500/30' : 'bg-[#2d2d2d] hover:text-white hover:bg-purple-600/20'}`}
                    title="Dê um duplo clique para alternar entre CERTO/ERRADO e Múltipla Escolha"
                  >
                    {q.number}
                  </span>
                </div>
                
                <div className="flex items-center gap-1.5 px-2 py-1 bg-[#1a1a1a] rounded-lg border border-white/5">
                  {(q.isMultipleChoice || (block.bank?.toUpperCase() !== 'CEBRASPE' && block.bank?.toUpperCase() !== 'CESPE') ? ['A', 'B', 'C', 'D', 'E'] : ['C', 'E']).map((alt) => {
                    const isEliminated = q.eliminated?.includes(alt);
                    return (
                      <button key={alt}
                        onClick={() => {
                          if (q.answer === alt) {
                            onUpdateQuestion(block.id, q.number, { answer: '' });
                          } else {
                            const newEliminated = (q.eliminated || []).filter(a => a !== alt);
                            onUpdateQuestion(block.id, q.number, { answer: alt, eliminated: newEliminated.length > 0 ? newEliminated : undefined });
                          }
                        }}
                        onDoubleClick={() => {
                          if (block.isLocked) return;
                          const current = q.eliminated || [];
                          const next = current.includes(alt)
                            ? current.filter(a => a !== alt)
                            : [...current, alt];
                          onUpdateQuestion(block.id, q.number, { eliminated: next });
                        }}
                        disabled={block.isLocked}
                        className={`min-w-[28px] h-6 rounded text-[10px] font-black transition-all ${
                          q.answer === alt
                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                            : isEliminated
                              ? 'line-through text-gray-700 bg-red-900/10 cursor-pointer hover:text-gray-500 hover:bg-red-900/20'
                              : 'text-gray-500 hover:text-white hover:bg-white/5'
                        }`}>
                        {alt}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1">
                  <button onClick={() => onUpdateQuestion(block.id, q.number, { hasDoubt: !q.hasDoubt })} disabled={block.isLocked}
                    className={`p-1.5 rounded-lg transition-all ${q.hasDoubt ? 'text-orange-500 bg-orange-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}><Flag className={`w-3.5 h-3.5 ${q.hasDoubt ? 'fill-orange-500' : ''}`} /></button>
                  <div className="w-[1px] h-4 bg-white/5 mx-1" />
                  <button onClick={() => onUpdateQuestion(block.id, q.number, { isCorrect: true })} disabled={block.isLocked}
                    className={`p-1.5 rounded-lg transition-all ${q.isCorrect === true ? 'text-[#84cc16] bg-[#84cc16]/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => onUpdateQuestion(block.id, q.number, { isCorrect: false })} disabled={block.isLocked}
                    className={`p-1.5 rounded-lg transition-all ${q.isCorrect === false ? 'text-red-500 bg-red-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}><X className="w-3.5 h-3.5" /></button>
                  
                  {block.showGabarito && (
                    <div className="ml-2 pl-3 border-l border-white/5 flex flex-col items-center">
                      <span className="text-[8px] uppercase font-black text-gray-600 mb-0.5">Gabarito</span>
                      <span 
                        onDoubleClick={() => {
                          if (block.isLocked) return;
                          const options = q.isMultipleChoice || (block.bank?.toUpperCase() !== 'CEBRASPE' && block.bank?.toUpperCase() !== 'CESPE') ? ['A', 'B', 'C', 'D', 'E'] : ['C', 'E'];
                          const current = q.correctAnswer?.toUpperCase() || '';
                          const nextIdx = (options.indexOf(current) + 1) % options.length;
                          onUpdateQuestion(block.id, q.number, { correctAnswer: options[nextIdx] });
                        }}
                        className={`text-[10px] font-black px-1.5 rounded cursor-pointer select-none transition-all ${q.correctAnswer ? 'text-purple-400 hover:bg-purple-500/10' : 'text-gray-700 bg-white/5 hover:text-white hover:bg-white/10'}`}
                        title="Duplo clique para alterar o gabarito"
                      >
                        {q.correctAnswer || '?'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!block.isLocked && (
          <div 
            className="absolute bottom-0 right-0 w-8 h-8 cursor-nwse-resize group/resizer"
            onMouseDown={(e) => containerRef.current && onMouseDown(e, containerRef.current)}
          >
            <div className={`absolute bottom-2 right-2 w-2 h-2 rounded-full bg-purple-500/20 group-hover/resizer:bg-purple-500 transition-all ${isResizing ? 'scale-150 bg-purple-500' : ''}`} />
          </div>
        )}

        {isResizing && (
          <div className="absolute inset-0 bg-purple-500/5 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none border-2 border-purple-500/50 rounded-2xl">
            <span className="bg-purple-600 text-white px-3 py-1 rounded-lg font-black text-xs shadow-xl">{ghostWidth} × {ghostHeight}</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}));
