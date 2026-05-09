import React, { memo, useRef, forwardRef, useState, useEffect } from 'react';
import { Lock, Unlock, Edit2, Trash2, CheckSquare, Check, X, Flag, Eye, EyeOff, GripVertical, LayoutGrid, Columns, Target, BookOpen, MessageSquare, ChevronLeft, ChevronRight, MoreHorizontal, ArrowDown, ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActivityBlock, Question } from '../types';
import { useSnapResizer } from '../hooks/useSnapResizer';
import { getNextQuestionMode, getQuestionAlternatives, isQuestionMultipleChoice } from '../utils/questionMode';

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
  onMoveBlockStep?: (blockId: string, direction: -1 | 1) => void;
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
    sectionStats,
    onMoveBlockStep
  } = props;

  const [isRenaming, setIsRenaming] = useState(false);
  const [tempTitle, setTempTitle] = useState(block.title);
  const [editingObs, setEditingObs] = useState<Record<number, boolean>>({});
  const [mobileQuestionIndex, setMobileQuestionIndex] = useState(0);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setTempTitle(block.title);
  }, [block.title]);

  useEffect(() => {
    setMobileQuestionIndex((current) => {
      const lastIndex = Math.max((block.questions?.length || 1) - 1, 0);
      return Math.min(current, lastIndex);
    });
  }, [block.questions]);

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
    if (block.layout?.type === 'grid') return 'grid gap-2 md:gap-4';
    if (block.layout?.type === 'columns') return 'grid gap-2 md:gap-4';
    return 'flex flex-wrap gap-2 md:gap-4';
  };

  const getDynamicStyles = () => {
    const mobileCols = 1;
    const tabletCols = 2;
    const desktopCols = block.layout?.columns || 1;

    if (block.layout?.type === 'grid') {
      return {
        '--cols': mobileCols,
        '--tablet-cols': tabletCols,
        '--desktop-cols': desktopCols,
        '--rows': block.layout.rows || 1,
        gridTemplateColumns: `repeat(var(--current-cols, var(--cols)), minmax(0, 1fr))`,
        gridTemplateRows: `repeat(var(--rows), minmax(0, 1fr))`
      } as React.CSSProperties;
    }
    if (block.layout?.type === 'columns') {
      return {
        '--cols': mobileCols,
        '--tablet-cols': tabletCols,
        '--desktop-cols': desktopCols,
        '--rows': block.layout.rows || 1,
        gridTemplateColumns: `repeat(var(--current-cols, var(--cols)), minmax(0, 1fr))`,
        gridAutoFlow: 'column',
        gridTemplateRows: `repeat(var(--rows), minmax(0, 1fr))`
      } as React.CSSProperties;
    }
    return {};
  };

  const getAlternatives = (q: Question) => getQuestionAlternatives(q, block);

  const toggleQuestionMode = (q: Question) => {
    if (block.isLocked) return;
    const nextMode = getNextQuestionMode(q, block);
    const nextAlternatives = nextMode ? ['A', 'B', 'C', 'D', 'E'] : ['C', 'E'];
    const updates: Partial<Question> = {
      isMultipleChoice: nextMode,
      eliminated: (q.eliminated || []).filter(alt => nextAlternatives.includes(alt)),
      doubtedAlts: (q.doubtedAlts || []).filter(alt => nextAlternatives.includes(alt))
    };

    if (q.answer && !nextAlternatives.includes(q.answer)) updates.answer = '';
    if (q.correctAnswer && !nextAlternatives.includes(q.correctAnswer)) updates.correctAnswer = '';

    onUpdateQuestion(block.id, q.number, updates);
  };

  const toggleDoubted = (q: Question, alternative: string) => {
    if (block.isLocked) return;
    const current = q.doubtedAlts || [];
    const next = current.includes(alternative)
      ? current.filter((a: string) => a !== alternative)
      : [...current, alternative];
    onUpdateQuestion(block.id, q.number, { doubtedAlts: next });
  };

  const toggleEliminated = (q: Question, alternative: string) => {
    if (block.isLocked) return;
    const current = q.eliminated || [];
    const next = current.includes(alternative)
      ? current.filter((a: string) => a !== alternative)
      : [...current, alternative];
    onUpdateQuestion(block.id, q.number, { eliminated: next });
  };

  const selectAlternative = (q: Question, alternative: string) => {
    if (q.answer === alternative) {
      onUpdateQuestion(block.id, q.number, { answer: '' });
      return;
    }
    const newEliminated = (q.eliminated || []).filter((a: string) => a !== alternative);
    onUpdateQuestion(block.id, q.number, {
      answer: alternative,
      eliminated: newEliminated.length > 0 ? newEliminated : undefined
    });
  };

  const cycleCorrectAnswer = (q: Question) => {
    if (block.isLocked) return;
    const options = getAlternatives(q);
    const current = q.correctAnswer?.toUpperCase() || '';
    const nextIdx = (options.indexOf(current) + 1) % options.length;
    onUpdateQuestion(block.id, q.number, { correctAnswer: options[nextIdx] });
  };

  const renderObservationEditor = (q: Question, mobile = false) => (
    (editingObs[q.number] || q.observations) && (
      <div className={mobile ? 'px-0 py-1' : 'px-1 py-1'}>
        <textarea
          value={q.observations || ''}
          onChange={(e) => onUpdateQuestion(block.id, q.number, { observations: e.target.value })}
          disabled={block.isLocked}
          readOnly={block.isLocked}
          placeholder="Dúvidas, alternativas possíveis..."
          className={`w-full bg-[#0d0d0d] border border-white/5 rounded-lg p-2 text-gray-300 outline-none focus:border-blue-500/50 transition-all resize-none min-h-[40px] scrollbar-none ${mobile ? 'text-sm' : 'text-[11px]'} ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          rows={mobile ? 2 : 1}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = target.scrollHeight + 'px';
          }}
        />
      </div>
    )
  );

  const renderAlternatives = (q: Question, mobile = false) => (
    <div className={`flex items-center ${mobile ? 'justify-center' : ''}`}>
      <div className={`flex items-center ${mobile ? 'justify-center flex-wrap gap-2 bg-[#111111] p-2 rounded-xl border border-white/5' : 'gap-1 px-2 py-1 bg-[#1a1a1a] rounded-lg border border-white/5 overflow-x-auto no-scrollbar'}`}>
        {getAlternatives(q).map((alt) => {
          const isEliminated = (q.eliminated || []).includes(alt);
          const isDoubted = (q.doubtedAlts || []).includes(alt);

          return (
            <div key={alt} className={`flex items-center ${mobile ? 'gap-1' : 'gap-0.5'}`}>
              <button
                onClick={() => selectAlternative(q, alt)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  toggleDoubted(q, alt);
                }}
                onDoubleClick={() => toggleEliminated(q, alt)}
                disabled={block.isLocked}
                className={`${mobile ? 'min-w-[52px] h-11 text-sm' : 'min-w-[28px] h-7 text-[11px]'} rounded font-black transition-all relative ${
                  q.answer === alt
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                    : isEliminated
                      ? 'line-through text-gray-700 bg-red-900/10 cursor-pointer hover:text-gray-500 hover:bg-red-900/20'
                      : isDoubted
                        ? 'bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                        : 'text-gray-500 hover:text-white hover:bg-white/5'
                }`}
              >
                {alt}
              </button>
              <button
                type="button"
                onClick={() => toggleDoubted(q, alt)}
                disabled={block.isLocked}
                className={`relative flex items-center justify-center rounded transition-all ${
                  mobile ? 'h-11 w-10' : 'h-7 w-6'
                } ${
                  isDoubted
                    ? 'text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/40'
                    : 'text-gray-700 hover:text-gray-300 hover:bg-white/5'
                } ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                title={isDoubted ? 'Remover alternativa considerada' : 'Marcar alternativa considerada'}
                aria-label={isDoubted ? `Remover ${alt} das alternativas consideradas` : `Marcar ${alt} como alternativa considerada`}
              >
                <Flag className={mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderQuestionActions = (q: Question, mobile = false) => (
    <div className={`flex items-center ${mobile ? 'justify-between gap-2 pt-1' : 'gap-1 ml-auto'}`}>
      <div className={`flex items-center ${mobile ? 'gap-2' : 'gap-1'}`}>
        <button
          onClick={() => setEditingObs(prev => ({ ...prev, [q.number]: !prev[q.number] }))}
          disabled={block.isLocked}
          className={`${mobile ? 'h-11 flex-1 min-w-[88px] px-3 text-sm' : 'p-1.5'} rounded-lg transition-all ${q.observations || editingObs[q.number] ? 'text-blue-400 bg-blue-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
          title="Adicionar observação"
        >
          {mobile ? (
            <span className="flex items-center justify-center gap-2 font-bold">
              <MessageSquare className="w-4 h-4" />
              Obs
            </span>
          ) : (
            <MessageSquare className={`w-4 h-4 ${q.observations ? 'fill-blue-500/20' : ''}`} />
          )}
        </button>
        <button
          onClick={() => onUpdateQuestion(block.id, q.number, { hasDoubt: !q.hasDoubt })}
          disabled={block.isLocked}
          className={`${mobile ? 'h-11 flex-1 min-w-[88px] px-3 text-sm' : 'p-1.5'} rounded-lg transition-all ${q.hasDoubt ? 'text-orange-500 bg-orange-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
          title="Marcar dúvida"
        >
          {mobile ? (
            <span className="flex items-center justify-center gap-2 font-bold">
              <Flag className={`w-4 h-4 ${q.hasDoubt ? 'fill-orange-500' : ''}`} />
              Dúvida
            </span>
          ) : (
            <Flag className={`w-4 h-4 ${q.hasDoubt ? 'fill-orange-500' : ''}`} />
          )}
        </button>
      </div>
      <div className={`flex items-center ${mobile ? 'gap-2' : ''}`}>
        {!mobile && <div className="w-[1px] h-4 bg-white/5 mx-1" />}
        <button
          onClick={() => onUpdateQuestion(block.id, q.number, { isCorrect: true })}
          disabled={block.isLocked}
          className={`${mobile ? 'h-11 min-w-[56px] px-4' : 'p-1.5'} rounded-lg transition-all ${q.isCorrect === true ? 'text-[#84cc16] bg-[#84cc16]/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
        >
          {mobile ? <span className="font-black">✔</span> : <Check className="w-4 h-4" />}
        </button>
        <button
          onClick={() => onUpdateQuestion(block.id, q.number, { isCorrect: false })}
          disabled={block.isLocked}
          className={`${mobile ? 'h-11 min-w-[56px] px-4' : 'p-1.5'} rounded-lg transition-all ${q.isCorrect === false ? 'text-red-500 bg-red-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
        >
          {mobile ? <span className="font-black">✖</span> : <X className="w-4 h-4" />}
        </button>
        {block.showGabarito && (
          <div className={`${mobile ? 'ml-1' : 'ml-2 pl-3 border-l border-white/5'} flex flex-col items-center min-w-[36px]`}>
            <span className="text-[8px] uppercase font-black text-gray-600 mb-0.5">GAB</span>
            <span
              onDoubleClick={() => cycleCorrectAnswer(q)}
              className={`${mobile ? 'text-xs px-2 py-1' : 'text-[10px] px-1.5'} font-black rounded cursor-pointer select-none transition-all ${q.correctAnswer ? 'text-purple-400 hover:bg-purple-500/10' : 'text-gray-700 bg-white/5 hover:text-white hover:bg-white/10'}`}
            >
              {q.correctAnswer || '?'}
            </span>
          </div>
        )}
      </div>
    </div>
  );

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
    total: (block.questions || []).length,
    answered: (block.questions || []).filter(q => q.answer).length,
    correct: (block.questions || []).filter(q => q.isCorrect === true).length,
    incorrect: (block.questions || []).filter(q => q.isCorrect === false).length,
    doubts: (block.questions || []).filter(q => q.hasDoubt).length,
    doubtsCorrect: (block.questions || []).filter(q => q.hasDoubt && q.isCorrect === true).length,
    doubtsIncorrect: (block.questions || []).filter(q => q.hasDoubt && q.isCorrect === false).length,
  };
  const accuracy = blockStatsRaw.answered > 0 ? (blockStatsRaw.correct / blockStatsRaw.answered) * 100 : 0;
  const currentBlockStats: PerformanceStats = { ...blockStatsRaw, accuracy };
  const mobileQuestion = block.questions?.[mobileQuestionIndex];
  const goToPreviousMobileQuestion = () => {
    setMobileQuestionIndex((current) => Math.max(0, current - 1));
  };
  const goToNextMobileQuestion = () => {
    setMobileQuestionIndex((current) => Math.min((block.questions?.length || 1) - 1, current + 1));
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${colSpanMap[currentWidth as keyof typeof colSpanMap] || 'col-span-12'}`}
    >
      <motion.div
        ref={containerRef}
        className={`bg-[#262626] border-2 h-full ${block.isLocked ? 'border-[#333333]' : 'border-[#404040] hover:border-purple-500/30'} flex flex-col rounded-2xl p-3 md:p-4 transition-all overflow-hidden ${isResizing ? 'ring-2 ring-purple-500' : ''}`}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="mb-4 flex flex-col gap-3 flex-shrink-0 md:flex-row md:items-center md:justify-between">
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
          
          <div className="hidden md:flex items-center gap-1.5">
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

          <div className="md:hidden sticky top-0 z-10 flex items-center justify-between gap-2 rounded-2xl border border-[#333333] bg-[#262626]/95 p-2 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggleStats(block.id)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all ${block.showStats === false ? 'text-gray-600 border border-[#404040]' : 'text-purple-400 bg-purple-500/10 border border-purple-500/20'}`}
                title={block.showStats === false ? 'Mostrar desempenho' : 'Ocultar desempenho'}
              >
                {block.showStats === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={() => onToggleLock(block.id)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${block.isLocked ? 'text-purple-400 bg-purple-500/10 border border-purple-500/20' : 'text-gray-400 border border-[#404040]'}`}
                title={block.isLocked ? 'Desbloquear bloco' : 'Bloquear bloco'}
              >
                {block.isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              </button>
            </div>
            <div className="relative">
              <button
                onClick={() => setShowMobileActions(prev => !prev)}
                className="flex h-11 min-w-[52px] items-center justify-center rounded-xl border border-[#404040] bg-[#1a1a1a] text-gray-300 transition-colors hover:text-white"
                title="Mais ações"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
              {showMobileActions && (
                <div className="absolute right-0 top-14 z-20 w-52 rounded-2xl border border-[#404040] bg-[#1f1f1f] p-2 shadow-2xl">
                  {onMoveBlockStep && (
                    <>
                      <button
                        onClick={() => {
                          onMoveBlockStep(block.id, -1);
                          setShowMobileActions(false);
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-200 hover:bg-[#2d2d2d]"
                      >
                        <ArrowUp className="w-4 h-4 text-gray-400" />
                        Subir bloco
                      </button>
                      <button
                        onClick={() => {
                          onMoveBlockStep(block.id, 1);
                          setShowMobileActions(false);
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-200 hover:bg-[#2d2d2d]"
                      >
                        <ArrowDown className="w-4 h-4 text-gray-400" />
                        Descer bloco
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      onToggleGabarito(block.id);
                      setShowMobileActions(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-200 hover:bg-[#2d2d2d]"
                  >
                    <BookOpen className="w-4 h-4 text-purple-400" />
                    {block.showGabarito ? 'Ocultar gabarito' : 'Mostrar gabarito'}
                  </button>
                  <button
                    onClick={() => {
                      onImportGabarito(block.id);
                      setShowMobileActions(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-200 hover:bg-[#2d2d2d]"
                  >
                    <CheckSquare className="w-4 h-4 text-[#84cc16]" />
                    Importar gabarito
                  </button>
                  <button
                    onClick={() => {
                      onEditBlock(block);
                      setShowMobileActions(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-gray-200 hover:bg-[#2d2d2d]"
                  >
                    <Edit2 className="w-4 h-4 text-blue-400" />
                    Editar bloco
                  </button>
                  <button
                    onClick={() => {
                      onDeleteBlock(block.id);
                      setShowMobileActions(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-300 hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir bloco
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 text-[10px] font-bold text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Aula / Assunto">
            <Columns className="w-3 h-3 text-purple-500" /> {block.lesson}
          </span>
          {block.pages && (
            <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Páginas do material">
              <BookOpen className="w-3 h-3 text-blue-400" /> {block.pages}
            </span>
          )}
          <span className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded" title="Total de questões">
            <CheckSquare className="w-3 h-3 text-[#84cc16]" /> {(block.questions || []).length} questões
          </span>
        </div>

        <div className="md:hidden flex-1">
          {mobileQuestion && (
            <div
              className="rounded-2xl border border-white/5 bg-[#1a1a1a] p-4"
              onTouchStart={(event) => {
                touchStartX.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStartX.current === null) return;
                const deltaX = event.changedTouches[0].clientX - touchStartX.current;
                touchStartX.current = null;

                if (Math.abs(deltaX) < 60) return;
                if (deltaX > 0) goToPreviousMobileQuestion();
                if (deltaX < 0) goToNextMobileQuestion();
              }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <button
                  onClick={goToPreviousMobileQuestion}
                  disabled={mobileQuestionIndex === 0}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#404040] text-gray-300 transition-colors hover:text-white disabled:opacity-35"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
                    <span>Questão</span>
                    <button
                      type="button"
                      onDoubleClick={() => toggleQuestionMode(mobileQuestion)}
                      disabled={block.isLocked}
                      className={`rounded-lg px-2 py-1 font-black tracking-normal transition-all ${isQuestionMultipleChoice(mobileQuestion, block) ? 'bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/30' : 'bg-[#2d2d2d] text-gray-300 hover:text-white hover:bg-purple-600/20'} ${block.isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      title="Clique duas vezes para alternar A-E / C-E"
                    >
                      {mobileQuestion.number}
                    </button>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-300">
                    {mobileQuestionIndex + 1} de {block.questions.length}
                  </div>
                </div>
                <button
                  onClick={goToNextMobileQuestion}
                  disabled={mobileQuestionIndex === block.questions.length - 1}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#404040] text-gray-300 transition-colors hover:text-white disabled:opacity-35"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
              <div className="mb-4 flex items-center justify-center">
                <button
                  onDoubleClick={() => toggleQuestionMode(mobileQuestion)}
                  className={`flex min-h-11 min-w-[88px] items-center justify-center rounded-xl px-4 text-sm font-black transition-all ${isQuestionMultipleChoice(mobileQuestion, block) ? 'bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/30' : 'bg-[#2d2d2d] text-gray-300'}`}
                >
                  {isQuestionMultipleChoice(mobileQuestion, block) ? 'Múltipla escolha' : 'Certo / Errado'}
                </button>
              </div>
              {renderAlternatives(mobileQuestion, true)}
              <div className="mt-4">
                {renderQuestionActions(mobileQuestion, true)}
              </div>
              <div className="mt-3">
                {renderObservationEditor(mobileQuestion, true)}
              </div>
              <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 grid grid-cols-3 gap-2 border-t border-white/5 bg-[#161616]/95 p-3 backdrop-blur">
                <button
                  onClick={goToPreviousMobileQuestion}
                  disabled={mobileQuestionIndex === 0}
                  className="min-h-11 rounded-xl border border-[#404040] text-sm font-bold text-gray-300 disabled:opacity-35"
                >
                  Anterior
                </button>
                <button
                  onClick={() => onUpdateQuestion(block.id, mobileQuestion.number, { hasDoubt: !mobileQuestion.hasDoubt })}
                  disabled={block.isLocked}
                  className={`min-h-11 rounded-xl text-sm font-bold ${mobileQuestion.hasDoubt ? 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30' : 'bg-[#262626] text-gray-300'}`}
                >
                  Dúvida
                </button>
                <button
                  onClick={goToNextMobileQuestion}
                  disabled={mobileQuestionIndex === block.questions.length - 1}
                  className="min-h-11 rounded-xl border border-[#404040] text-sm font-bold text-gray-300 disabled:opacity-35"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>

        <div 
          className={`hidden md:grid overflow-y-auto pr-1 flex-1 scrollbar-thin scrollbar-thumb-white/5 scrollbar-track-transparent [--current-cols:var(--cols)] md:[--current-cols:var(--tablet-cols)] xl:[--current-cols:var(--desktop-cols)] ${getLayoutClasses()}`} 
          style={getDynamicStyles()}
        >
          {(block.questions || []).map((q) => (
            <div key={q.number} className="group/q flex flex-col gap-2 p-2 bg-[#1a1a1a] rounded-xl border border-white/5 hover:border-white/10 transition-all">
              <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
                <div className="flex items-center gap-3">
                  <span 
                    onDoubleClick={() => toggleQuestionMode(q)}
                    className={`text-[10px] p-2 font-black rounded-lg text-gray-400 w-6 h-6 flex items-center justify-center cursor-pointer select-none transition-all ${isQuestionMultipleChoice(q, block) ? 'bg-purple-600/30 text-purple-400 ring-1 ring-purple-500/30' : 'bg-[#2d2d2d] hover:text-white hover:bg-purple-600/20'}`}
                    title="Clique duas vezes para alternar A-E / C-E"
                  >
                    {q.number}
                  </span>
                </div>
                <div className="flex-1 min-w-fit">
                  {renderAlternatives(q)}
                </div>
                {renderQuestionActions(q)}
              </div>
              {renderObservationEditor(q)}
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
