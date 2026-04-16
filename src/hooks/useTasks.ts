import { useState, useEffect, useMemo } from 'react';
import { StudyTask, ActivityBlock, Question } from '../types';
import { arrayMove } from '@dnd-kit/sortable';

const now = () => new Date().toISOString();

export const useTasks = () => {
  const [tasks, setTasks] = useState<StudyTask[]>(() => {
    try {
      const saved = localStorage.getItem('ls_tasks_v2');
      return saved ? (JSON.parse(saved) as StudyTask[]) : [];
    } catch {
      console.error('[Diário LS] Failed to load tasks from localStorage');
      return [];
    }
  });

  const [activeTaskId, setActiveTaskId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('ls_active_task_v2') || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ls_tasks_v2', JSON.stringify(tasks));
    } catch (e) {
      console.error('[Diário LS] Failed to save tasks', e);
    }
  }, [tasks]);

  useEffect(() => {
    try {
      if (activeTaskId) {
        localStorage.setItem('ls_active_task_v2', activeTaskId);
      } else {
        localStorage.removeItem('ls_active_task_v2');
      }
    } catch (e) {
      console.error('[Diário LS] Failed to save active task id', e);
    }
  }, [activeTaskId]);

  const activeTask = useMemo(() => tasks.find(t => t.id === activeTaskId), [tasks, activeTaskId]);

  const addTask = (task: StudyTask) => {
    setTasks(prev => [...prev, { ...task, updatedAt: now() }]);
  };

  const updateTask = (taskId: string, updates: Partial<StudyTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, updatedAt: now() } : t));
  };

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    if (activeTaskId === taskId) setActiveTaskId(null);
  };

  const deleteBlock = (taskId: string, blockId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return { ...t, updatedAt: now(), blocks: t.blocks.filter(b => b.id !== blockId) };
    }));
  };

  const updateQuestion = (taskId: string, blockId: string, qNumber: number, updates: Partial<Question>) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          if (block.id !== blockId) return block;
          if (block.isLocked) return block;
          return {
            ...block,
            questions: block.questions.map(q => {
              if (q.number !== qNumber) return q;
              const newQ = { ...q, ...updates };
              if (('answer' in updates || 'correctAnswer' in updates) && newQ.correctAnswer) {
                let userAns = newQ.answer.toUpperCase();
                let correctAns = newQ.correctAnswer.toUpperCase();
                if (userAns === 'CERTO') userAns = 'C';
                if (userAns === 'ERRADO') userAns = 'E';
                if (correctAns === 'CERTO') correctAns = 'C';
                if (correctAns === 'ERRADO') correctAns = 'E';

                if (correctAns === 'ANULADA') {
                  newQ.isCorrect = true;
                } else if (newQ.answer) {
                  newQ.isCorrect = userAns === correctAns;
                } else {
                  newQ.isCorrect = null;
                }
              } else if ('correctAnswer' in updates && !newQ.correctAnswer) {
                newQ.isCorrect = null;
              }
              return newQ;
            })
          };
        })
      };
    }));
  };

  const toggleLock = (taskId: string, blockId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, updatedAt: now(), blocks: t.blocks.map(b => b.id === blockId ? { ...b, isLocked: !b.isLocked } : b)
    } : t));
  };

  const toggleBlockStats = (taskId: string, blockId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, updatedAt: now(), blocks: t.blocks.map(b => b.id === blockId ? { ...b, showStats: b.showStats === false ? true : false } : b)
    } : t));
  };

  const toggleBlockGabarito = (taskId: string, blockId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, updatedAt: now(), blocks: t.blocks.map(b => b.id === blockId ? { ...b, showGabarito: !b.showGabarito } : b)
    } : t));
  };

  const saveBlock = (taskId: string, blockId: string | null, blockData: {
    title: string;
    lesson: string;
    pages: string;
    bank: string;
    qNumbers: number[];
    layout?: { columns: number; rows: number; type: 'grid' | 'columns'; width?: number };
  }) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      let newBlocks = [...t.blocks];
      
      if (blockId) {
        newBlocks = newBlocks.map(b => {
          if (b.id !== blockId) return b;
          const newQuestions = blockData.qNumbers.map(n => {
            const existing = b.questions.find(q => q.number === n);
            return existing || { number: n, answer: '', isCorrect: null, hasDoubt: false };
          });
          return { 
            ...b, 
            title: blockData.title, 
            lesson: blockData.lesson, 
            pages: blockData.pages, 
            bank: blockData.bank, 
            questions: newQuestions,
            layout: blockData.layout || b.layout || { columns: 5, rows: 5, type: 'columns', width: 12 }
          };
        });
      } else {
        const newQuestions = blockData.qNumbers.map(n => ({ number: n, answer: '', isCorrect: null, hasDoubt: false }));
        newBlocks.push({
          id: crypto.randomUUID(),
          title: blockData.title || `Atividade ${newBlocks.length + 1}`,
          lesson: blockData.lesson,
          pages: blockData.pages,
          bank: blockData.bank,
          questions: newQuestions,
          layout: blockData.layout || { columns: 5, rows: 5, type: 'columns', width: 12 }
        });
      }
      return { ...t, updatedAt: now(), blocks: newBlocks };
    }));
  };

  const updateTaskBlocksLayout = (taskId: string, layout: { columns: number, rows: number, type: 'grid' | 'columns', width?: number }) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => ({
          ...block,
          layout: { ...block.layout, ...layout } as any
        }))
      };
    }));
  };

  const updateBlockLayout = (taskId: string, blockId: string, layout: { width?: number, rowSpan?: number }) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          if (block.id !== blockId) return block;
          return {
            ...block,
            layout: { ...block.layout, ...layout } as any
          };
        })
      };
    }));
  };

  const updateSectionBlocksLayout = (taskId: string, sectionTitle: string, layout: { columns?: number, rows?: number, type?: 'grid' | 'columns', width?: number }, newTitle?: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          const isTargetSection = block.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase();
          const isTargetBlock = !block.isSection && block.lesson.trim().toLowerCase() === sectionTitle.trim().toLowerCase();

          if (block.isSection && isTargetSection) {
            return { ...block, title: newTitle || block.title, lesson: newTitle || block.lesson };
          }
          if (isTargetBlock) {
            return { 
              ...block, 
              lesson: newTitle || block.lesson, 
              layout: { ...block.layout, ...layout } as any 
            };
          }
          return block;
        })
      };
    }));
  };

  const addSectionHeader = (taskId: string, title: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const newSection: ActivityBlock = {
        id: crypto.randomUUID(),
        title,
        lesson: title,
        pages: '',
        questions: [],
        isSection: true,
        layout: { columns: 12, rows: 1, type: 'columns', width: 12 }
      };
      return { ...task, updatedAt: now(), blocks: [...task.blocks, newSection] };
    }));
  };

  const toggleSectionLock = (taskId: string, sectionTitle: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const section = task.blocks.find(b => b.isSection && b.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase());
      const newLockedState = !section?.isLocked;

      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          if (block.isSection && block.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase()) {
            return { ...block, isLocked: newLockedState };
          }
          if (!block.isSection && block.lesson.trim().toLowerCase() === sectionTitle.trim().toLowerCase()) {
            return { ...block, isLocked: newLockedState };
          }
          return block;
        })
      };
    }));
  };

  const toggleSectionStats = (taskId: string, sectionTitle: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const section = task.blocks.find(b => b.isSection && b.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase());
      const newStatsState = section?.showStats === false; // Toggle to true if currently false

      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          if (block.isSection && block.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase()) {
            return { ...block, showStats: newStatsState };
          }
          if (!block.isSection && block.lesson.trim().toLowerCase() === sectionTitle.trim().toLowerCase()) {
            return { ...block, showStats: newStatsState };
          }
          return block;
        })
      };
    }));
  };

  const autoSnapBlocks = (taskId: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const blocks = [...task.blocks];
      const sections = blocks.filter(b => b.isSection);
      const activities = blocks.filter(b => !b.isSection);
      
      const newOrder: ActivityBlock[] = [];
      const processedActivityIds = new Set<string>();

      // Place sections and their matching activities
      sections.forEach(section => {
        newOrder.push(section);
        activities.forEach(activity => {
          if (!processedActivityIds.has(activity.id) && 
              (activity.lesson.trim().toLowerCase() === section.title.trim().toLowerCase() ||
               activity.lesson.trim().toLowerCase().includes(section.title.trim().toLowerCase()))) {
            newOrder.push(activity);
            processedActivityIds.add(activity.id);
          }
        });
      });

      // Add remaining activities
      activities.forEach(activity => {
        if (!processedActivityIds.has(activity.id)) {
          newOrder.push(activity);
        }
      });

      return { ...task, updatedAt: now(), blocks: newOrder };
    }));
  };

  const reorderBlocks = (taskId: string, oldIndex: number, newIndex: number) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      const newBlocks = [...task.blocks];
      const [movedBlock] = newBlocks.splice(oldIndex, 1);
      newBlocks.splice(newIndex, 0, movedBlock);
      return { ...task, blocks: newBlocks };
    }));
  };

  const importGabarito = (taskId: string, blockId: string, parsedAnswers: Map<number, string>) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        updatedAt: now(),
        blocks: t.blocks.map(b => {
          if (b.id !== blockId) return b;
          return {
            ...b,
            showGabarito: true,
            questions: b.questions.map(q => {
              const correctAns = parsedAnswers.get(q.number);
              if (correctAns) {
                let isCorrect = q.isCorrect;
                if (correctAns === 'ANULADA') {
                  isCorrect = true; 
                } else if (q.answer) {
                  let userAns = q.answer.toUpperCase();
                  if (userAns === 'CERTO') userAns = 'C';
                  if (userAns === 'ERRADO') userAns = 'E';
                  isCorrect = userAns === correctAns;
                }
                return { ...q, correctAnswer: correctAns, isCorrect };
              }
              return q;
            })
          };
        })
      };
    }));
  };

  const reopenTask = (taskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        updatedAt: now(),
        status: 'in_progress',
        blocks: t.blocks.map(b => ({ ...b, isLocked: false }))
      };
    }));
    setActiveTaskId(taskId);
  };

  const toggleBlockLayout = (taskId: string, blockId: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        blocks: task.blocks.map(block => {
          if (block.id !== blockId) return block;
          const currentType = block.layout?.type || 'columns';
          return {
            ...block,
            layout: {
              ...(block.layout || { columns: 4, rows: 5 }),
              type: currentType === 'columns' ? 'grid' : 'columns'
            }
          };
        })
      };
    }));
  };

  const moveBlock = (taskId: string, activeId: string, overId: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      
      const blocks = [...task.blocks];
      const oldIndex = blocks.findIndex(b => b.id === activeId);
      const newIndex = blocks.findIndex(b => b.id === overId);
      if (oldIndex === -1 || newIndex === -1) return task;

      const activeBlock = blocks[oldIndex];
      const overBlock = blocks[newIndex];

      // CASE 1: Moving a Section Header (Recursive Move)
      if (activeBlock.isSection) {
        const sectionTitle = activeBlock.title.trim().toLowerCase();
        
        // Identify all children blocks that logically belong to this section
        // (matching title) and are NOT the section header itself.
        const childrenIndexes: number[] = [];
        blocks.forEach((b, idx) => {
          if (!b.isSection && b.lesson.trim().toLowerCase() === sectionTitle) {
            childrenIndexes.push(idx);
          }
        });

        // Collect all blocks to be moved (Header + Children)
        const movingBlocks = [activeBlock];
        // Note: Sort children indexes to ensure we remove from largest to smallest to preserve indexing
        const sortedChildrenIndexes = [...childrenIndexes].sort((a, b) => b - a);
        
        const otherChildren: ActivityBlock[] = [];
        sortedChildrenIndexes.forEach(idx => {
          const [child] = blocks.splice(idx, 1);
          otherChildren.push(child);
        });
        
        // Re-find indices after splicing out children
        let adjustedOldIndex = blocks.findIndex(b => b.id === activeId);
        blocks.splice(adjustedOldIndex, 1); // remove the header too
        
        const combinedMove = [activeBlock, ...otherChildren.reverse()];
        
        // Re-find target index
        let adjustedNewIndex = blocks.findIndex(b => b.id === overId);
        if (adjustedNewIndex === -1) adjustedNewIndex = blocks.length; // fallback
        
        // Standard DND behavior: if moving down, insert after. If moving up, insert before?
        // Actually arrayMove style:
        blocks.splice(adjustedNewIndex, 0, ...combinedMove);
        
        return { ...task, blocks };
      }

      // CASE 2: Single Activity Block Move
      // "Fuse" Behavior: If dragging an activity onto another activity block, 
      // automatically create a section header for them.
      if (!activeBlock.isSection && !overBlock.isSection) {
        const sectionTitle = activeBlock.lesson.trim() || overBlock.lesson.trim() || 'Nova Seção';
        const hasSection = blocks.some(b => b.isSection && b.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase());
        
        // If they don't have a shared section yet, create one "on the fly"
        // But ONLY if they aren't already considered part of a section (per user feedback)
        const activeHasLesson = activeBlock.lesson.trim().length > 0;
        const overHasLesson = overBlock.lesson.trim().length > 0;

        if (!hasSection && !activeHasLesson && !overHasLesson) {
          const newSection: ActivityBlock = {
            id: crypto.randomUUID(),
            title: sectionTitle,
            lesson: sectionTitle,
            pages: '',
            questions: [],
            isSection: true,
            layout: { columns: 12, rows: 1, type: 'columns', width: 12 }
          };
          
          const tempBlocks = [...blocks];
          tempBlocks.splice(oldIndex, 1);
          const adjustedNewIndex = tempBlocks.findIndex(b => b.id === overId);
          
          const finalBlocks = [...tempBlocks];
          finalBlocks.splice(adjustedNewIndex, 0, newSection);
          
          // Align both to the new section
          finalBlocks[adjustedNewIndex + 1] = { ...overBlock, lesson: sectionTitle }; 
          finalBlocks.splice(adjustedNewIndex + 1, 0, { ...activeBlock, lesson: sectionTitle });
          
          return { ...task, blocks: finalBlocks };
        }
      }

      // Default single block move
      return {
        ...task,
        blocks: arrayMove(task.blocks, oldIndex, newIndex)
      };
    }));
  };

  const inProgressTasks = useMemo(() => tasks.filter(t => t.status === 'in_progress' || !t.status), [tasks]);

  const pauseTask = () => {
    setActiveTaskId(null);
  };

  return {
    tasks,
    setTasks,
    activeTaskId,
    setActiveTaskId,
    activeTask,
    inProgressTasks,
    pauseTask,
    addTask,
    updateTask,
    deleteTask,
    updateQuestion,
    toggleLock,
    saveBlock,
    importGabarito,
    toggleBlockLayout,
    updateBlockLayout,
    updateTaskBlocksLayout,
    updateSectionBlocksLayout,
    autoSnapBlocks,
    toggleBlockStats,
    toggleSectionLock,
    toggleSectionStats,
    reopenTask,
    moveBlock,
    deleteBlock,
    addSectionHeader,
    toggleBlockGabarito
  };
};
