import { useState, useEffect, useMemo } from 'react';
import { StudyTask, ActivityBlock, Question, LayoutConfig, LayoutPatch } from '../types';
import { DEFAULT_ACTIVITY_LAYOUT, DEFAULT_SECTION_LAYOUT, mergeLayout, normalizeTaskBlocksLayout } from '../utils/layout';
import { autoSnapTaskBlocks, moveBlockByStep, moveBlocks } from '../utils/taskMutations';

const now = () => new Date().toISOString();
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
    setTasks(prev => {
      const cutoff = Date.now() - TRASH_RETENTION_MS;
      const keptTasks = prev.filter(task => !task.deletedAt || new Date(task.deletedAt).getTime() >= cutoff);
      return keptTasks.length === prev.length ? prev : keptTasks;
    });
  }, []);

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

  const activeTask = useMemo(() => tasks.find(t => t.id === activeTaskId && !t.deletedAt), [tasks, activeTaskId]);

  const addTask = (task: StudyTask) => {
    setTasks(prev => [...prev, { ...normalizeTaskBlocksLayout(task), updatedAt: now() }]);
  };

  const updateTask = (taskId: string, updates: Partial<StudyTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates, updatedAt: now() } : t));
  };

  const startTaskTimer = (taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, timerStartedAt: now(), updatedAt: now() } : t));
  };

  const pauseTaskTimer = (taskId: string) => {
    const pausedAt = Date.now();
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const sessionSeconds = t.timerStartedAt
        ? Math.max(0, Math.floor((pausedAt - new Date(t.timerStartedAt).getTime()) / 1000))
        : 0;
      return {
        ...t,
        elapsedSeconds: (t.elapsedSeconds || 0) + sessionSeconds,
        timerStartedAt: null,
        updatedAt: now()
      };
    }));
  };

  const deleteTask = (taskId: string) => {
    const deletedAt = now();
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, deletedAt, updatedAt: deletedAt } : t));
    if (activeTaskId === taskId) setActiveTaskId(null);
  };

  const restoreTask = (taskId: string) => {
    const restoredAt = now();
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const { deletedAt, ...restoredTask } = t;
      return { ...restoredTask, updatedAt: restoredAt };
    }));
  };

  const permanentlyDeleteTask = (taskId: string) => {
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
    layout?: LayoutConfig;
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
            layout: blockData.layout || b.layout || DEFAULT_ACTIVITY_LAYOUT
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
          layout: blockData.layout || DEFAULT_ACTIVITY_LAYOUT
        });
      }
      return { ...t, updatedAt: now(), blocks: newBlocks };
    }));
  };

  const updateTaskBlocksLayout = (taskId: string, layout: LayoutPatch) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => ({
          ...block,
          layout: mergeLayout(block.layout, layout, block.isSection ? DEFAULT_SECTION_LAYOUT : DEFAULT_ACTIVITY_LAYOUT)
        }))
      };
    }));
  };

  const updateBlockLayout = (taskId: string, blockId: string, layout: LayoutPatch) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return {
        ...task,
        updatedAt: now(),
        blocks: task.blocks.map(block => {
          if (block.id !== blockId) return block;
          return {
            ...block,
            layout: mergeLayout(block.layout, layout, block.isSection ? DEFAULT_SECTION_LAYOUT : DEFAULT_ACTIVITY_LAYOUT)
          };
        })
      };
    }));
  };

  const updateSectionBlocksLayout = (taskId: string, sectionTitle: string, layout: LayoutPatch, newTitle?: string) => {
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
              layout: mergeLayout(block.layout, layout)
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
        layout: DEFAULT_SECTION_LAYOUT
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
      return { ...task, updatedAt: now(), blocks: autoSnapTaskBlocks(task.blocks) };
    }));
  };

  const reorderBlocks = (taskId: string, oldIndex: number, newIndex: number) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return { ...task, updatedAt: now(), blocks: moveBlocks(task.blocks, task.blocks[oldIndex].id, task.blocks[newIndex].id) };
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
              ...(block.layout || DEFAULT_ACTIVITY_LAYOUT),
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
      return { ...task, updatedAt: now(), blocks: moveBlocks(task.blocks, activeId, overId) };
    }));
  };

  const moveBlockStep = (taskId: string, blockId: string, direction: -1 | 1) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      return { ...task, updatedAt: now(), blocks: moveBlockByStep(task.blocks, blockId, direction) };
    }));
  };

  const inProgressTasks = useMemo(() => tasks.filter(t => !t.deletedAt && (t.status === 'in_progress' || !t.status)), [tasks]);

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
    restoreTask,
    permanentlyDeleteTask,
    startTaskTimer,
    pauseTaskTimer,
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
    moveBlockStep,
    deleteBlock,
    addSectionHeader,
    toggleBlockGabarito
  };
};
