import React from 'react';
import { Brain, CheckCircle2, Clock, Flag, RotateCcw, Target, XCircle } from 'lucide-react';
import { StudyTask } from '../types';
import { formatDuration, summarizeTask } from '../utils/productInsights';

interface PostTaskSummaryModalProps {
  task: StudyTask | null;
  isOpen: boolean;
  onClose: () => void;
  onGenerateRevision: (task: StudyTask) => void;
}

export const PostTaskSummaryModal: React.FC<PostTaskSummaryModalProps> = ({
  task,
  isOpen,
  onClose,
  onGenerateRevision
}) => {
  if (!isOpen || !task) return null;

  const summary = summarizeTask(task);
  const timeTone = summary.timeDeltaSeconds === null || summary.timeDeltaSeconds <= 0 ? 'text-[#84cc16]' : 'text-red-300';

  return (
    <div className="fixed inset-0 z-[95] flex items-end bg-black/70 md:items-center md:justify-center">
      <div className="max-h-[92vh] w-full overflow-hidden rounded-t-2xl border border-[#404040] bg-[#333333] shadow-2xl md:max-w-3xl md:rounded-xl">
        <div className="flex items-center justify-between border-b border-[#404040] bg-[#262626] px-5 py-4">
          <div>
            <h2 className="text-xl font-black text-white">Resumo pós-tarefa</h2>
            <p className="text-xs text-gray-400">{task.discipline}{task.assunto ? ` · ${task.assunto}` : ''}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-[#404040] hover:text-white">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-xl bg-[#262626] p-4">
              <Target className="mb-2 h-5 w-5 text-purple-400" />
              <div className="text-2xl font-black text-white">{summary.accuracy ?? 0}%</div>
              <div className="text-xs text-gray-500">Aproveitamento</div>
            </div>
            <div className="rounded-xl bg-[#262626] p-4">
              <CheckCircle2 className="mb-2 h-5 w-5 text-[#84cc16]" />
              <div className="text-2xl font-black text-[#84cc16]">{summary.correct}</div>
              <div className="text-xs text-gray-500">Acertos</div>
            </div>
            <div className="rounded-xl bg-[#262626] p-4">
              <XCircle className="mb-2 h-5 w-5 text-red-400" />
              <div className="text-2xl font-black text-red-300">{summary.errors}</div>
              <div className="text-xs text-gray-500">Erros</div>
            </div>
            <div className="rounded-xl bg-[#262626] p-4">
              <Flag className="mb-2 h-5 w-5 text-yellow-400" />
              <div className="text-2xl font-black text-yellow-300">{summary.doubts}</div>
              <div className="text-xs text-gray-500">Dúvidas</div>
            </div>
            <div className="rounded-xl bg-[#262626] p-4">
              <Clock className="mb-2 h-5 w-5 text-blue-300" />
              <div className="text-2xl font-black text-white">{formatDuration(summary.elapsedSeconds)}</div>
              <div className={`text-xs font-bold ${timeTone}`}>
                {summary.idealSeconds ? `${summary.timeDeltaSeconds && summary.timeDeltaSeconds > 0 ? '+' : ''}${formatDuration(Math.abs(summary.timeDeltaSeconds || 0))} vs ideal` : 'Sem ideal'}
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-[#404040] bg-[#262626] p-4">
            <h3 className="mb-3 text-sm font-black uppercase tracking-widest text-gray-400">Tópicos mais fracos</h3>
            {summary.weakTopics.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum tópico crítico registrado nesta tarefa.</p>
            ) : (
              <div className="space-y-2">
                {summary.weakTopics.map(topic => (
                  <div key={`${topic.lesson}-${topic.title}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#1f1f1f] p-3">
                    <div>
                      <div className="font-bold text-white">{topic.lesson}</div>
                      <div className="text-xs text-gray-500">{topic.title}</div>
                    </div>
                    <div className="text-right text-xs font-bold text-gray-300">
                      <div>{topic.accuracy ?? 0}%</div>
                      <div className="text-red-300">{topic.errors} erros · {topic.doubts} dúvidas</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-[#404040] bg-[#262626] p-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="min-h-11 rounded-xl border border-[#525252] px-4 text-sm font-bold text-gray-300 hover:bg-[#404040]">
            Fechar
          </button>
          <button onClick={() => onGenerateRevision(task)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 text-sm font-black uppercase text-white hover:bg-purple-700">
            <Brain className="h-4 w-4" />
            Gerar revisão
          </button>
          <button onClick={onClose} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#84cc16] px-5 text-sm font-black uppercase text-black hover:bg-[#a3e635]">
            <RotateCcw className="h-4 w-4" />
            Voltar ao caderno
          </button>
        </div>
      </div>
    </div>
  );
};
