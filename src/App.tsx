import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, Undo, Plus, Play, Clock, BookOpen, ChevronRight } from 'lucide-react';

import { ActivityBlock, StudyTask, Question } from './types';
import { useTasks } from './hooks/useTasks';
import { Sidebar } from './components/Sidebar';
import { ConfirmModal } from './components/ConfirmModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { ImportArea } from './components/ImportArea';
import { HistoryList } from './components/HistoryList';
import { RevisionArea } from './components/RevisionArea';
import { ActivityBlockCard } from './components/ActivityBlockCard';
import { TaskHeader } from './components/TaskHeader';
import { GabaritoModal } from './components/GabaritoModal';
import { BlockEditModal } from './components/BlockEditModal';
import { SectionEditModal } from './components/SectionEditModal';
import { PasteBackupModal } from './components/PasteBackupModal';
import { AuthModal } from './components/AuthModal';
import { BottomNav } from './components/BottomNav';
import { formatQuestionList, parseQuestionsText, parseLSTask } from './utils/parser';
import { DEFAULT_ACTIVITY_LAYOUT } from './utils/layout';
import { LocalStorageAdapter } from './storage/StorageAdapter';
import { SyncEngine } from './storage/SyncEngine';
import { SyncState, SyncStatus } from './types/sync';
import { useAutoBackup } from './hooks/useAutoBackup';
import { 
  DndContext, 
  DragEndEvent, 
  PointerSensor, 
  KeyboardSensor, 
  useSensor, 
  useSensors,
  closestCenter,
  TouchSensor
} from '@dnd-kit/core';
import { 
  SortableContext, 
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';

function App() {
  const {
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
  } = useTasks();

  // Auto-download backup when page is hidden (PC shutdown, browser close, etc.)
  useAutoBackup(tasks);

  const [syncState, setSyncState] = useState<SyncState>({
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
    pendingChanges: 0,
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const syncEngineRef = useRef<SyncEngine | null>(null);
  const isInitialMount = useRef(true);
  const skipSyncRef = useRef(false);

  useEffect(() => {
    const adapter = new LocalStorageAdapter();
    const engine = new SyncEngine(adapter, (state) => {
      setSyncState(state);
    });
    syncEngineRef.current = engine;
    engine.init();

    const handleSyncPull = (e: Event) => {
      const detail = (e as CustomEvent).detail as StudyTask[];
      if (detail) {
        skipSyncRef.current = true;
        setTasks(detail);

        // If the currently-active task is still in the new data, keep it active.
        // If it disappeared (edge case), clear gracefully so the user sees the list.
        setActiveTaskId(prev => {
          if (!prev) return prev;
          const stillExists = detail.some(t => t.id === prev);
          return stillExists ? prev : null;
        });

        showToast('Dados atualizados da nuvem!');
      }
    };

    window.addEventListener('ls_sync_pull', handleSyncPull);

    return () => {
      engine.destroy();
      window.removeEventListener('ls_sync_pull', handleSyncPull);
    };
  }, []);

  // Trigger auto-sync when tasks change locally
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }

    syncEngineRef.current?.markLocalWrite();
  }, [tasks]);

  const handleSyncNow = useCallback(() => {
    syncEngineRef.current?.syncNow();
  }, []);

  const handleAuthComplete = useCallback(() => {
    setShowAuthModal(false);
    syncEngineRef.current?.init();
    showToast('Login realizado! Sincronizando...');
  }, []);

  const handleAuthError = useCallback((message: string) => {
    showToast(message);
  }, []);

  const handleDisconnect = useCallback(() => {
    syncEngineRef.current?.disconnect();
    showToast('Desconectado da nuvem.');
  }, []);

  const [activeTab, setActiveTab] = useState<'caderno' | 'revisao' | 'historico'>('caderno');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const [sectionModal, setSectionModal] = useState<{
    isOpen: boolean;
    title: string;
  }>({
    isOpen: false,
    title: ''
  });

  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editForm, setEditForm] = useState({
    planejamento: '',
    meta: '',
    tarefa: '',
    assunto: '',
    discipline: '',
    bank: ''
  });

  const [revisionTaskModal, setRevisionTaskModal] = useState<any>({ 
    isOpen: false, 
    planejamento: '',
    meta: '',
    tarefa: '',
    assunto: '',
    discipline: '',
    bank: '',
    blocks: []
  });

  const [blockEditModal, setBlockEditModal] = useState<{
    isOpen: boolean;
    id: string;
    title: string;
    lesson: string;
    pages: string;
    bank: string;
    questionsText: string;
    layout: { columns: number; rows: number; type: 'grid' | 'columns' };
  } | null>(null);
  
  const [gabaritoModal, setGabaritoModal] = useState<string | null>(null);
  const [viewingTaskId, setViewingTaskId] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && activeTaskId) {
      moveBlock(activeTaskId, active.id as string, over.id as string);
    }
  };

  const startEditingTask = () => {
    const task = (tasks.find(t => t.id === viewingTaskId)) || activeTask;
    if (!task) return;
    setEditForm({
      planejamento: task.planejamento || '',
      meta: task.meta || '',
      tarefa: task.tarefa || '',
      assunto: task.assunto || '',
      discipline: task.discipline || '',
      bank: task.bank || ''
    });
    setIsEditingTask(true);
  };

  const saveTaskEdits = () => {
    const targetId = viewingTaskId || activeTaskId;
    if (targetId) {
      updateTask(targetId, editForm);
      setIsEditingTask(false);
      showToast('Tarefa atualizada!');
    }
  };

  const handleDeleteBlock = (blockId: string) => {
    const targetId = viewingTaskId || activeTaskId;
    if (targetId) {
      deleteBlock(targetId, blockId);
      showToast('Bloco excluído.');
    }
  };

  const openEditBlock = (block?: ActivityBlock) => {
    const defaultLayout = DEFAULT_ACTIVITY_LAYOUT;
    if (block) {
      setBlockEditModal({ 
        isOpen: true, 
        id: block.id, 
        title: block.title, 
        lesson: block.lesson, 
        pages: block.pages || '', 
        bank: block.bank || '', 
        questionsText: formatQuestionList(block.questions.map(q => q.number)), 
        layout: block.layout || defaultLayout 
      });
    } else {
      setBlockEditModal({ 
        isOpen: true, id: '', title: '', lesson: '', pages: '', bank: '', questionsText: '', layout: defaultLayout 
      });
    }
  };

  const saveBlockEdit = () => {
    if (!blockEditModal) return;
    const targetId = viewingTaskId || activeTaskId;
    if (!targetId) return;
    
    saveBlock(targetId, blockEditModal.id || null, {
      title: blockEditModal.title,
      lesson: blockEditModal.lesson,
      pages: blockEditModal.pages,
      bank: blockEditModal.bank,
      qNumbers: parseQuestionsText(blockEditModal.questionsText),
      layout: blockEditModal.layout
    });

    setBlockEditModal(null);
    showToast(blockEditModal.id ? 'Bloco atualizado!' : 'Novo bloco criado!');
  };

  const finishTask = () => {
    if (activeTaskId) {
      updateTask(activeTaskId, { status: 'completed' });
      setActiveTaskId(null);
      showToast('Tarefa concluída!');
    }
  };

  const handleEditSection = (title: string) => {
    setSectionModal({ isOpen: true, title });
  };

  const handleSaveSectionLayout = (layout: { width: number; rowSpan: number }, newTitle: string) => {
    if (activeTaskId) {
      updateSectionBlocksLayout(activeTaskId, sectionModal.title, layout, newTitle);
      setSectionModal({ isOpen: false, title: '' });
      showToast('Seção atualizada!');
    }
  };

  const handleRenameSection = (oldTitle: string, newTitle: string) => {
    if (activeTaskId) {
      updateSectionBlocksLayout(activeTaskId, oldTitle, {}, newTitle);
      showToast('Seção renomeada!');
    }
  };

  const exportBackup = () => {
    try {
      const dataStr = JSON.stringify(tasks, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const exportFileDefaultName = `diario-ls-backup-${new Date().toISOString().split('T')[0]}.json`;
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
      showToast('Backup exportado!');
    } catch {
      alert('Erro ao exportar.');
    }
  };

  const importBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setTasks(parsed);
        showToast('Backup importado!');
      } catch {
        alert('Erro ao importar.');
      }
    };
    reader.readAsText(file);
  };

  const mergeBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const incoming = JSON.parse(event.target?.result as string);
        setTasks(prev => [...prev, ...incoming.filter((t1: any) => !prev.some(t2 => t2.id === t1.id))]);
        showToast('Backup mesclado!');
      } catch {
        alert('Erro ao mesclar.');
      }
    };
    reader.readAsText(file);
  };

  const handlePasteImport = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      setTasks(parsed);
      setIsPasteModalOpen(false);
      showToast('Backup restaurado!');
    } catch {
      alert('JSON inválido.');
    }
  };

  const handlePasteMerge = (json: string) => {
    try {
      const incoming = JSON.parse(json);
      setTasks(prev => [...prev, ...incoming.filter((t1: any) => !prev.some(t2 => t2.id === t1.id))]);
      setIsPasteModalOpen(false);
      showToast('Backup mesclado!');
    } catch {
      alert('JSON inválido.');
    }
  };

  const handleConfirmRevisionTask = () => {
    const { isOpen, ...taskData } = revisionTaskModal;
    addTask(taskData);
    setActiveTaskId(taskData.id);
    setActiveTab('caderno');
    setRevisionTaskModal({ ...revisionTaskModal, isOpen: false });
    showToast('Revisão gerada!');
  };

  const viewingTask = useMemo(() => tasks.find(t => t.id === viewingTaskId), [tasks, viewingTaskId]);

  return (
    <div className="flex h-screen bg-[#1a1a1a] text-gray-100 font-sans selection:bg-purple-500/30 overflow-hidden">
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-[#84cc16] text-black px-6 py-3 rounded-2xl font-black shadow-2xl flex items-center gap-3 border-4 border-black/10">
            <CheckCircle2 className="w-5 h-5" />
            <span className="uppercase tracking-tight">{toastMessage}</span>
          </div>
        </div>
      )}

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        setHistoryPage={setHistoryPage}
        exportBackup={exportBackup}
        importBackup={importBackup}
        mergeBackup={mergeBackup}
        onOpenPasteBackup={() => setIsPasteModalOpen(true)}
        inProgressCount={inProgressTasks.length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        syncStatus={syncState.status}
        syncLastSyncAt={syncState.lastSyncAt}
        onSyncNow={handleSyncNow}
        onAuth={() => setShowAuthModal(true)}
        onDisconnect={handleDisconnect}
      />

      <main className="flex-1 overflow-y-auto bg-[#2d2d2d] p-4 md:p-8 transition-all duration-300 pb-24 md:pb-8">
        <div className="max-w-[1600px] mx-auto px-2 md:px-4">
          {activeTab === 'caderno' && (
            <div className="space-y-6">
              {!activeTask ? (
                <div className="space-y-12">
                  {inProgressTasks.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-[#84cc16]">
                        <Clock className="w-5 h-5" />
                        <h2 className="text-xl font-bold text-white uppercase tracking-widest text-[14px]">Tarefas em Andamento</h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {inProgressTasks.map(task => (
                          <button key={task.id} onClick={() => setActiveTaskId(task.id)} className="bg-[#333333] border border-[#404040] hover:border-[#84cc16] p-6 rounded-2xl text-left transition-all group relative overflow-hidden shadow-lg hover:-translate-y-1">
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0"><ChevronRight className="w-6 h-6 text-[#84cc16]" /></div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[10px] uppercase font-black text-purple-400 tracking-[0.2em] bg-purple-500/10 px-2 py-0.5 rounded">{task.planejamento || 'Geral'}</span>
                              {task.meta && <span className="text-[10px] uppercase font-black text-green-400 tracking-[0.2em] bg-green-500/10 px-2 py-0.5 rounded">Meta {task.meta}</span>}
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2 group-hover:text-[#84cc16] transition-colors">{task.tarefa ? `Tarefa ${task.tarefa} — ` : ''}{task.discipline}</h3>
                            <p className="text-sm text-gray-400 line-clamp-2 h-10">{task.assunto}</p>
                            <div className="flex items-center justify-between border-t border-[#404040] pt-4 mt-auto">
                              <div className="flex items-center gap-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                <span className="flex items-center gap-1.5 bg-[#2d2d2d] px-2 py-1 rounded"><BookOpen className="w-3 h-3 text-purple-500" /> {task.blocks.length} blocos</span>
                                <span className="flex items-center gap-1.5 bg-[#2d2d2d] px-2 py-1 rounded"><Clock className="w-3 h-3 text-green-500" /> {new Date(task.date).toLocaleDateString()}</span>
                              </div>
                              <Play className="w-4 h-4 text-gray-600 group-hover:text-[#84cc16]" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <ImportArea onImport={(task) => { addTask(task); setActiveTaskId(task.id); showToast('Importado!'); }} showToast={showToast} />
                </div>
              ) : (
                <div className="space-y-6">
                  <TaskHeader
                    task={activeTask} isEditing={isEditingTask} editForm={editForm} setEditForm={setEditForm}
                    onSave={saveTaskEdits} onCancel={() => setIsEditingTask(false)} onEditStart={startEditingTask} onFinishTask={finishTask}
                    onPause={pauseTask} showStats={showStats} onToggleStats={() => setShowStats(!showStats)}
                    onUpdateAllLayouts={(layout) => updateTaskBlocksLayout(activeTaskId!, layout)}
                  />
                  <div className="flex-1">
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToWindowEdges]}>
                      <div className="grid grid-cols-12 gap-x-8 gap-y-4 pb-20">
                        <SortableContext items={activeTask.blocks.map(b => b.id)} strategy={rectSortingStrategy}>
                          {activeTask.blocks.map((block, index) => {
                            let sectionStats = undefined;
                            if (block.isSection) {
                              const sectionBlocks = activeTask.blocks.filter(b => 
                                !b.isSection && b.lesson.trim().toLowerCase() === block.title.trim().toLowerCase()
                              );
                              const allQs = sectionBlocks.flatMap(b => b.questions);
                              const answered = allQs.filter(q => q.answer).length;
                              const correct = allQs.filter(q => q.isCorrect === true).length;
                              const incorrect = allQs.filter(q => q.isCorrect === false).length;
                              const doubts = allQs.filter(q => q.hasDoubt).length;
                              const doubtsCorrect = allQs.filter(q => q.hasDoubt && q.isCorrect === true).length;
                              const doubtsIncorrect = allQs.filter(q => q.hasDoubt && q.isCorrect === false).length;
                              const total = allQs.length;
                              const accuracy = answered > 0 ? (correct / answered) * 100 : 0;
                              sectionStats = { total, answered, correct, incorrect, doubts, accuracy, doubtsCorrect, doubtsIncorrect };
                            }

                            return (
                              <ActivityBlockCard
                                key={block.id}
                                block={block}
                                index={index}
                                globalShowStats={showStats}
                                sectionStats={sectionStats}
                                onUpdateQuestion={(blockId, qNumber, updates) => updateQuestion(activeTaskId!, blockId, qNumber, updates)}
                                onToggleLock={(blockId) => toggleLock(activeTaskId!, blockId)}
                                onEditBlock={openEditBlock}
                                onDeleteBlock={handleDeleteBlock}
                                onImportGabarito={setGabaritoModal}
                                onToggleLayout={(blockId) => toggleBlockLayout(activeTaskId!, blockId)}
                                onToggleStats={(blockId) => toggleBlockStats(activeTaskId!, blockId)}
                                onToggleSectionLock={(title) => toggleSectionLock(activeTaskId!, title)}
                                onToggleSectionStats={(title) => toggleSectionStats(activeTaskId!, title)}
                                onUpdateLayout={(blockId, layout) => updateBlockLayout(activeTaskId!, blockId, layout)}
                                onEditSection={handleEditSection}
                                onAutoSnap={() => autoSnapBlocks(activeTaskId!)}
                                onRenameSection={handleRenameSection}
                                onToggleGabarito={(blockId) => toggleBlockGabarito(activeTaskId!, blockId)}
                              />
                            );
                          })}
                        </SortableContext>
                      </div>
                    </DndContext>
                  </div>
                  <div className="flex justify-center gap-4 py-8">
                    <button onClick={() => openEditBlock()} className="flex items-center gap-2 px-8 py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl transition-all border border-dashed border-white/10 hover:border-purple-500/50 font-black uppercase tracking-widest text-xs group">
                      <Plus className="w-5 h-5 group-hover:scale-110 transition-transform text-purple-500" /> Adicionar Bloco
                    </button>
                    <button 
                      onClick={() => {
                        const title = prompt('Título da Seção (ex: Aula 01):');
                        if (title && activeTaskId) {
                          addSectionHeader(activeTaskId, title);
                          showToast('Seção criada!');
                        }
                      }} 
                      className="flex items-center gap-2 px-8 py-4 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-2xl transition-all border border-dashed border-purple-500/30 hover:border-purple-500 font-black uppercase tracking-widest text-xs group"
                    >
                      <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" /> Criar Seção
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'revisao' && (
            <RevisionArea 
              tasks={tasks} 
              onGenerateRevisionTask={(revText, discipline, autoAssunto) => {
                const blocks = parseLSTask(revText);
                setRevisionTaskModal({
                  isOpen: true,
                  planejamento: 'Revisão',
                  meta: '',
                  tarefa: '',
                  assunto: autoAssunto,
                  discipline: discipline,
                  bank: '',
                  blocks,
                  id: crypto.randomUUID(),
                  date: new Date().toISOString()
                });
              }} 
              showToast={showToast} 
            />
          )}

          {activeTab === 'historico' && (
            <div className="space-y-6">
              {viewingTask ? (
                <div className="space-y-6">
                  <button onClick={() => setViewingTaskId(null)} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4 font-bold"><Undo className="w-4 h-4" /> Voltar</button>
                  <TaskHeader
                    task={viewingTask} isEditing={isEditingTask} editForm={editForm} setEditForm={setEditForm}
                    onSave={saveTaskEdits} onCancel={() => setIsEditingTask(false)} onEditStart={startEditingTask} showDate={true}
                    showStats={showStats} onToggleStats={() => setShowStats(!showStats)}
                    onReopen={() => { reopenTask(viewingTask.id); setViewingTaskId(null); setActiveTab('caderno'); showToast('Reaberta!'); }}
                  />
                  <div className="grid grid-cols-12 gap-8">
                    {viewingTask.blocks.map((block, index) => (
                      <ActivityBlockCard
                        key={block.id} block={block} index={index}
                        onUpdateQuestion={(bid, qn, upd) => updateQuestion(viewingTaskId!, bid, qn, upd)}
                        onToggleLock={(bid) => toggleLock(viewingTaskId!, bid)}
                        onEditBlock={openEditBlock} onDeleteBlock={handleDeleteBlock} onImportGabarito={setGabaritoModal}
                        onToggleLayout={(bid) => toggleBlockLayout(viewingTaskId!, bid)} globalShowStats={showStats}
                        onToggleStats={(bid) => toggleBlockStats(viewingTaskId!, bid)}
                        onUpdateLayout={(bid, layout) => updateBlockLayout(viewingTaskId!, bid, layout)}
                        onToggleGabarito={(bid) => toggleBlockGabarito(viewingTaskId!, bid)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <HistoryList 
                  tasks={tasks} 
                  historyPage={historyPage}
                  setHistoryPage={setHistoryPage}
                  onOpenTask={setViewingTaskId} 
                  onDeleteTask={setTaskToDelete} 
                />
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {blockEditModal?.isOpen && <BlockEditModal modalState={blockEditModal} onClose={() => setBlockEditModal(null)} onSave={saveBlockEdit} setModalState={setBlockEditModal} />}
      
      <SectionEditModal
        isOpen={sectionModal.isOpen}
        onClose={() => setSectionModal({ ...sectionModal, isOpen: false })}
        onSave={handleSaveSectionLayout}
        sectionTitle={sectionModal.title}
      />

      {gabaritoModal && (
        <GabaritoModal
          isOpen={!!gabaritoModal}
          onClose={() => setGabaritoModal(null)}
          onImport={(answers) => {
            importGabarito(activeTaskId || viewingTaskId!, gabaritoModal, answers);
            setGabaritoModal(null);
            showToast('Gabarito importado!');
          }}
        />
      )}

      {revisionTaskModal.isOpen && (
        <CreateTaskModal
          modalState={revisionTaskModal}
          setModalState={setRevisionTaskModal}
          onConfirm={handleConfirmRevisionTask}
        />
      )}

      <PasteBackupModal
        isOpen={isPasteModalOpen}
        onClose={() => setIsPasteModalOpen(false)}
        onImport={handlePasteImport}
        onMerge={handlePasteMerge}
      />

      <ConfirmModal
        isOpen={!!taskToDelete} onClose={() => setTaskToDelete(null)}
        onConfirm={() => { deleteTask(taskToDelete!); setTaskToDelete(null); showToast('Excluída!'); }}
        title="Excluir" message="Excluir?" confirmText="Excluir" isDestructive={true}
      />

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthComplete={handleAuthComplete}
        onError={handleAuthError}
      />

      <BottomNav 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        syncStatus={syncState.status}
        onSyncNow={handleSyncNow}
        onAuth={() => setShowAuthModal(true)}
        inProgressCount={inProgressTasks.length}
      />
    </div>
  );
}

export default App;
