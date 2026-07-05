import React, { memo, useRef, forwardRef, useState, useEffect } from 'react';
import { Lock, Unlock, Edit2, Trash2, CheckSquare, Check, X, Flag, Eye, EyeOff, GripVertical, LayoutGrid, Columns, Target, BookOpen, MessageSquare, Star } from 'lucide-react';
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
  displayMode?: 'caderno' | 'questoes' | 'gabarito';
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
    displayMode = 'caderno',
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
  const [editingObs, setEditingObs] = useState<Record<number, boolean>>({});

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

  const getDefaultAlternativeLabels = (question: Question) => {
    const isMultipleChoice = question.isMultipleChoice || (block.bank?.toUpperCase() !== 'CEBRASPE' && block.bank?.toUpperCase() !== 'CESPE');
    return isMultipleChoice ? ['A', 'B', 'C', 'D', 'E'] : ['C', 'E'];
  };

  const toggleDoubtedAlternative = (question: Question, alternative: string) => {
    if (block.isLocked) return;
    const current = question.doubtedAlts || [];
    const next = current.includes(alternative)
      ? current.filter((item: string) => item !== alternative)
      : [...current, alternative];
    onUpdateQuestion(block.id, question.number, { doubtedAlts: next });
  };

  const toggleEliminatedAlternative = (question: Question, alternative: string) => {
    if (block.isLocked) return;
    const current = question.eliminated || [];
    const next = current.includes(alternative)
      ? current.filter((item: string) => item !== alternative)
      : [...current, alternative];
    onUpdateQuestion(block.id, question.number, { eliminated: next });
  };

  const updateCorrectAnswer = (question: Question, answer?: string) => {
    if (block.isLocked) return;
    onUpdateQuestion(block.id, question.number, { correctAnswer: answer || undefined });
  };

  const selectAlternative = (question: Question, alternative: string) => {
    if (block.isLocked) return;
    if (question.answer === alternative) {
      onUpdateQuestion(block.id, question.number, { answer: '' });
      return;
    }

    const newEliminated = (question.eliminated || []).filter((item: string) => item !== alternative);
    onUpdateQuestion(block.id, question.number, {
      answer: alternative,
      eliminated: newEliminated.length > 0 ? newEliminated : undefined
    });
  };

  const renderAlternativeControl = (question: Question, alternative: string, text?: string) => {
    const isEliminated = (question.eliminated || []).includes(alternative);
    const isDoubted = (question.doubtedAlts || []).includes(alternative);
    const isSelected = question.answer === alternative;
    const hasText = Boolean(text);

    return (
      <div key={alternative} className={`flex items-center gap-1 ${hasText ? 'w-full' : ''}`}>
        <button
          type="button"
          onClick={() => selectAlternative(question, alternative)}
          onContextMenu={(event) => {
            event.preventDefault();
            toggleDoubtedAlternative(question, alternative);
          }}
          onDoubleClick={() => toggleEliminatedAlternative(question, alternative)}
          disabled={block.isLocked}
          className={`${hasText ? 'flex min-h-[42px] w-full items-start gap-3 px-3 py-2 text-left' : 'min-w-[28px] h-7'} rounded text-[11px] font-black transition-all relative ${
            isSelected
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
              : isEliminated
                ? 'line-through text-gray-700 bg-red-900/10 cursor-pointer hover:text-gray-500 hover:bg-red-900/20'
                : isDoubted
                  ? 'bg-amber-500/20 text-amber-500 ring-1 ring-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                  : 'text-gray-500 hover:text-white hover:bg-white/5'
          }`}
        >
          {hasText ? (
            <>
              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-black/20 text-[11px]">{alternative}</span>
              <span className="text-xs font-semibold leading-relaxed text-gray-200">{text}</span>
            </>
          ) : (
            alternative
          )}
        </button>
        <button
          type="button"
          onClick={() => toggleDoubtedAlternative(question, alternative)}
          disabled={block.isLocked}
          className={`relative flex h-7 w-6 items-center justify-center rounded transition-all ${
            isDoubted
              ? 'text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/40'
              : 'text-gray-700 hover:text-gray-300 hover:bg-white/5'
          } ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          title={isDoubted ? 'Remover alternativa considerada' : 'Marcar alternativa considerada'}
          aria-label={isDoubted ? `Remover ${alternative} das alternativas consideradas` : `Marcar ${alternative} como alternativa considerada`}
        >
          <Flag className="w-3 h-3" />
        </button>
      </div>
    );
  };

  const renderQuestionActions = (question: Question) => (
    <div className="flex items-center gap-1 ml-auto">
      <button
        onClick={() => setEditingObs(prev => ({ ...prev, [question.number]: !prev[question.number] }))}
        disabled={block.isLocked}
        className={`p-1.5 rounded-lg transition-all ${question.observations || editingObs[question.number] ? 'text-blue-400 bg-blue-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
        title="Adicionar observação"
      >
        <MessageSquare className={`w-4 h-4 ${question.observations ? 'fill-blue-500/20' : ''}`} />
      </button>
      <button
        onClick={() => onUpdateQuestion(block.id, question.number, { favorite: !question.favorite })}
        disabled={block.isLocked}
        className={`p-1.5 rounded-lg transition-all ${question.favorite ? 'text-yellow-400 bg-yellow-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
        title="Favoritar"
      >
        <Star className={`w-4 h-4 ${question.favorite ? 'fill-yellow-400' : ''}`} />
      </button>
      <button onClick={() => onUpdateQuestion(block.id, question.number, { hasDoubt: !question.hasDoubt })} disabled={block.isLocked}
        className={`p-1.5 rounded-lg transition-all ${question.hasDoubt ? 'text-orange-500 bg-orange-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}
        title="Marcar dúvida"
      >
        <Flag className={`w-4 h-4 ${question.hasDoubt ? 'fill-orange-500' : ''}`} />
      </button>
      <div className="w-[1px] h-4 bg-white/5 mx-1" />
      <button onClick={() => onUpdateQuestion(block.id, question.number, { isCorrect: true })} disabled={block.isLocked}
        className={`p-1.5 rounded-lg transition-all ${question.isCorrect === true ? 'text-[#84cc16] bg-[#84cc16]/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}><Check className="w-4 h-4" /></button>
      <button onClick={() => onUpdateQuestion(block.id, question.number, { isCorrect: false })} disabled={block.isLocked}
        className={`p-1.5 rounded-lg transition-all ${question.isCorrect === false ? 'text-red-500 bg-red-500/10' : 'text-gray-700 hover:text-white hover:bg-white/5'}`}><X className="w-4 h-4" /></button>

      {block.showGabarito && (
        <div className="ml-2 pl-3 border-l border-white/5 flex flex-col items-center min-w-[36px]">
          <span className="text-[8px] uppercase font-black text-gray-600 mb-0.5">GAB</span>
          <span
            onDoubleClick={() => {
              if (block.isLocked) return;
              const options = getDefaultAlternativeLabels(question);
              const current = question.correctAnswer?.toUpperCase() || '';
              const nextIdx = (options.indexOf(current) + 1) % options.length;
              onUpdateQuestion(block.id, question.number, { correctAnswer: options[nextIdx] });
            }}
            className={`text-[10px] font-black px-1.5 rounded cursor-pointer select-none transition-all ${question.correctAnswer ? 'text-purple-400 hover:bg-purple-500/10' : 'text-gray-700 bg-white/5 hover:text-white hover:bg-white/10'}`}
          >
            {question.correctAnswer || '?'}
          </span>
        </div>
      )}
    </div>
  );

  const renderObservationEditor = (question: Question) => (
    (editingObs[question.number] || question.observations) && (
      <div className="px-1 py-1">
        <textarea
          value={question.observations || ''}
          onChange={(event) => onUpdateQuestion(block.id, question.number, { observations: event.target.value })}
          disabled={block.isLocked}
          readOnly={block.isLocked}
          placeholder="Dúvidas, alternativas possíveis..."
          className={`w-full bg-[#0d0d0d] border border-white/5 rounded-lg p-2 text-[11px] text-gray-300 outline-none focus:border-blue-500/50 transition-all resize-none min-h-[40px] scrollbar-none ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          rows={1}
          onInput={(event) => {
            const target = event.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = target.scrollHeight + 'px';
          }}
        />
      </div>
    )
  );

  const availableQuestions = (block.questions || []).filter((question) => question.statement && question.alternatives?.length);
  const renderedQuestions = displayMode === 'questoes' ? availableQuestions : (block.questions || []);

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
            <CheckSquare className="w-3 h-3 text-[#84cc16]" /> {displayMode === 'questoes' ? availableQuestions.length : (block.questions || []).length} questões
          </span>
        </div>

        {displayMode === 'questoes' && availableQuestions.length === 0 && (
          <div className="flex-1 min-h-[120px] flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#1a1a1a] px-4 text-center">
            <p className="text-sm font-bold text-gray-500">Nenhuma questão completa disponível neste bloco.</p>
          </div>
        )}

        {!(displayMode === 'questoes' && availableQuestions.length === 0) && (
        <div 
          className={`overflow-y-auto pr-1 flex-1 scrollbar-thin scrollbar-thumb-white/5 scrollbar-track-transparent [--current-cols:var(--cols)] md:[--current-cols:var(--tablet-cols)] xl:[--current-cols:var(--desktop-cols)] ${getLayoutClasses()}`} 
          style={getDynamicStyles()}
        >
          {renderedQuestions.map((q) => {
            const isObjectiveQuestion = displayMode === 'questoes' && Boolean(q.statement && q.alternatives?.length);
            const displayNumber = q.sourceQuestionNumber ?? q.number;

            if (displayMode === 'gabarito') {
              const answerOptions = q.alternatives?.map((alternative) => alternative.label) || getDefaultAlternativeLabels(q);

              return (
                <div key={q.localId || q.number} className="group/q flex flex-col gap-3 p-3 bg-[#1a1a1a] rounded-xl border border-white/5 hover:border-white/10 transition-all">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-[10px] p-2 font-black rounded-lg text-gray-400 w-8 h-8 flex items-center justify-center bg-[#2d2d2d]">
                        {displayNumber}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-widest text-gray-500">
                          {q.sourceName || block.title}
                        </p>
                        <p className="text-xs text-gray-400">
                          Resposta marcada: <span className="font-black text-white">{q.answer || '-'}</span>
                          {q.isCorrect !== null && (
                            <span className={`ml-2 font-black ${q.isCorrect ? 'text-[#84cc16]' : 'text-red-400'}`}>
                              {q.isCorrect ? 'certa' : 'errada'}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {answerOptions.map((alternative) => (
                        <button
                          key={alternative}
                          type="button"
                          onClick={() => updateCorrectAnswer(q, alternative)}
                          disabled={block.isLocked}
                          className={`h-8 min-w-8 rounded px-2 text-xs font-black transition-all ${
                            q.correctAnswer === alternative
                              ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                              : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                          } ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {alternative}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => updateCorrectAnswer(q, 'ANULADA')}
                        disabled={block.isLocked}
                        className={`h-8 rounded px-3 text-[10px] font-black uppercase transition-all ${
                          q.correctAnswer === 'ANULADA'
                            ? 'bg-[#84cc16] text-black'
                            : 'bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white'
                        } ${block.isLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        Anulada
                      </button>
                      <button
                        type="button"
                        onClick={() => updateCorrectAnswer(q)}
                        disabled={block.isLocked || !q.correctAnswer}
                        className="h-8 rounded px-3 text-[10px] font-black uppercase bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  {q.statement && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">{q.statement}</p>
                  )}
                </div>
              );
            }

            if (isObjectiveQuestion && q.alternatives) {
              return (
                <div key={q.localId || q.number} className="group/q flex flex-col gap-4 p-4 bg-[#1a1a1a] rounded-xl border border-white/5 hover:border-white/10 transition-all">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`text-[10px] p-2 font-black rounded-lg w-8 h-8 flex items-center justify-center select-none transition-all ${
                        q.isCorrect === true
                          ? 'bg-[#84cc16]/15 text-[#84cc16] ring-1 ring-[#84cc16]/30'
                          : q.isCorrect === false
                            ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                            : 'bg-[#2d2d2d] text-gray-400'
                      }`}>
                        {displayNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          {q.sourceName && (
                            <span className="max-w-[220px] truncate rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-purple-300">
                              {q.sourceName}
                            </span>
                          )}
                          {q.year && (
                            <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-black text-gray-400">
                              {q.year}
                            </span>
                          )}
                          {block.showGabarito && q.correctAnswer && (
                            <span className="rounded bg-[#84cc16]/10 px-2 py-0.5 text-[10px] font-black text-[#84cc16]">
                              GAB {q.correctAnswer}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold leading-relaxed text-gray-100">{q.statement}</p>
                      </div>
                    </div>
                    {renderQuestionActions(q)}
                  </div>

                  <div className="grid gap-2">
                    {q.alternatives.map((alternative) => renderAlternativeControl(q, alternative.label, alternative.text))}
                  </div>

                  {renderObservationEditor(q)}
                </div>
              );
            }

            return (
              <div key={q.number} className="group/q flex flex-col gap-2 p-2 bg-[#1a1a1a] rounded-xl border border-white/5 hover:border-white/10 transition-all">
                <div className="flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
                  <div className="flex items-center gap-3">
                    <span
                      onDoubleClick={() => onUpdateQuestion(block.id, q.number, { isMultipleChoice: !q.isMultipleChoice })}
                      className={`text-[10px] p-2 font-black rounded-lg text-gray-400 w-6 h-6 flex items-center justify-center cursor-pointer select-none transition-all ${q.isMultipleChoice ? 'bg-purple-600/30 text-purple-400 ring-1 ring-purple-500/30' : 'bg-[#2d2d2d] hover:text-white hover:bg-purple-600/20'}`}
                    >
                      {q.number}
                    </span>
                  </div>

                  <div className="flex-1 flex items-center justify-center min-w-fit">
                    <div className="flex items-center gap-1 px-2 py-1 bg-[#1a1a1a] rounded-lg border border-white/5 overflow-x-auto no-scrollbar">
                      {getDefaultAlternativeLabels(q).map((alternative) => renderAlternativeControl(q, alternative))}
                    </div>
                  </div>

                  {renderQuestionActions(q)}
                </div>

                {renderObservationEditor(q)}
              </div>
            );
          })}
        </div>
        )}

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
