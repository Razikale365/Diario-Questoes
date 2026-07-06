import React from 'react';
import { ClipboardCheck, FileQuestion, Grid3X3, Layers } from 'lucide-react';

import { StudyTask } from '../types';
import { TaskWorkTab, taskHasExecutableQuestions } from '../utils/taskWorkModes';

interface TaskWorkModeTabsProps {
  task: StudyTask;
  activeTab: TaskWorkTab;
  onChange: (tab: TaskWorkTab) => void;
}

export const TaskWorkModeTabs: React.FC<TaskWorkModeTabsProps> = ({
  task,
  activeTab,
  onChange,
}) => {
  const hasExecutableQuestions = taskHasExecutableQuestions(task);
  const disabledQuestionTitle = 'Nenhuma questão completa importada nesta tarefa';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/5 bg-[#262626] p-2">
      <button
        type="button"
        onClick={() => onChange('caderno')}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
          activeTab === 'caderno'
            ? 'bg-[#84cc16] text-black'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Grid3X3 className="w-4 h-4" /> Caderno
      </button>
      <button
        type="button"
        onClick={() => hasExecutableQuestions && onChange('questoes')}
        disabled={!hasExecutableQuestions}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
          activeTab === 'questoes'
            ? 'bg-purple-600 text-white'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400`}
        title={hasExecutableQuestions ? 'Executar questões completas disponíveis' : disabledQuestionTitle}
      >
        <FileQuestion className="w-4 h-4" /> Questões
      </button>
      <button
        type="button"
        onClick={() => hasExecutableQuestions && onChange('cards')}
        disabled={!hasExecutableQuestions}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
          activeTab === 'cards'
            ? 'bg-purple-600 text-white'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400`}
        title={hasExecutableQuestions ? 'Executar questões em cards' : disabledQuestionTitle}
      >
        <Layers className="w-4 h-4" /> Cards
      </button>
      <button
        type="button"
        onClick={() => onChange('gabarito')}
        className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
          activeTab === 'gabarito'
            ? 'bg-purple-600 text-white'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <ClipboardCheck className="w-4 h-4" /> Gabarito
      </button>
    </div>
  );
};
