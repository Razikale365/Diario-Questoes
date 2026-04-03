import React, { useState, useMemo } from 'react';
import { CheckCircle2, AlertCircle, Copy, Plus } from 'lucide-react';
import { StudyTask } from '../types';
import { formatQuestionList } from '../utils/parser';

interface RevisionAreaProps {
  tasks: StudyTask[];
  onGenerateRevisionTask: (revText: string, discipline: string, autoAssunto: string) => void;
  showToast: (msg: string) => void;
}

export const RevisionArea: React.FC<RevisionAreaProps> = ({
  tasks,
  onGenerateRevisionTask,
  showToast
}) => {
  const [revDiscipline, setRevDiscipline] = useState('');
  const [selectedLessons, setSelectedLessons] = useState<Set<string>>(new Set());

  const uniqueDisciplines = useMemo(() => {
    const d = new Set<string>();
    tasks.filter(t => t.status === 'completed').forEach(t => {
      if (t.discipline) d.add(t.discipline);
    });
    return Array.from(d).sort();
  }, [tasks]);

  const availableLessons = useMemo(() => {
    if (!revDiscipline) return [];
    const lessons = new Set<string>();
    tasks.filter(t => t.discipline === revDiscipline && t.status === 'completed').forEach(t => {
      t.blocks.forEach(b => {
        if (b.lesson) lessons.add(b.lesson);
      });
    });
    return Array.from(lessons).sort();
  }, [tasks, revDiscipline]);

  const generatedRevision = useMemo(() => {
    if (!revDiscipline || selectedLessons.size === 0) return [];

    const filteredTasks = tasks.filter(t => t.discipline === revDiscipline && t.status === 'completed');
    const grouped = new Map<string, { qSet: Set<number>, pSet: Set<string> }>();

    filteredTasks.forEach(task => {
      task.blocks.forEach(block => {
        if (!block.lesson || !selectedLessons.has(block.lesson)) return;

        const key = `${block.lesson}|${block.bank || task.bank}`;
        if (!grouped.has(key)) grouped.set(key, { qSet: new Set(), pSet: new Set() });
        const { qSet, pSet } = grouped.get(key)!;

        block.questions.forEach(q => {
          if (q.isCorrect === false || q.hasDoubt) {
            qSet.add(q.number);
          }
        });

        if (block.pages) pSet.add(block.pages);
      });
    });

    const result: string[] = [];
    result.push('Refaça as questões que você errou e marcou como favoritas (que devem incluir as erradas e que houve dúvida). Logo abaixo estão listados os cadernos de questões para realizar essas revisões:\n');

    grouped.forEach(({ qSet, pSet }, key) => {
      const [lesson, bank] = key.split('|');
      const qArray = Array.from(qSet).sort((a, b) => a - b);
      
      if (qArray.length > 0) {
        const qString = formatQuestionList(qArray);
        const pString = pSet.size > 0 ? ` (páginas ${Array.from(pSet).join(', ')})` : '';
        result.push(`- Na ${lesson} - Resolver as questões ${qString} (total: ${qArray.length} questões)${pString}. ${bank}`);
      }
    });

    return result;
  }, [tasks, revDiscipline, selectedLessons]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedRevision.join('\n'));
    showToast('Texto copiado para a área de transferência!');
  };

  const openRevisionTaskModal = () => {
    const revText = generatedRevision.join('\n');
    const autoAssunto = Array.from(selectedLessons).sort().join(', ');
    onGenerateRevisionTask(revText, revDiscipline, autoAssunto);
  };

  return (
    <div className="bg-[#333333] rounded-lg border border-[#404040] shadow-xl overflow-hidden">
      <div className="bg-[#262626] px-6 py-4 border-b border-[#404040]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-[#84cc16]" /> Gerar Lista de Revisão
        </h2>
      </div>
      <div className="p-6 space-y-6">
        {uniqueDisciplines.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Nenhuma tarefa finalizada encontrada no histórico.</p>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-sm font-bold text-gray-300 mb-2">Selecione a Disciplina</label>
              <select
                value={revDiscipline}
                onChange={(e) => {
                  setRevDiscipline(e.target.value);
                  setSelectedLessons(new Set());
                }}
                className="w-full bg-[#404040] border border-[#525252] rounded px-4 py-2 text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              >
                <option value="">-- Selecione --</option>
                {uniqueDisciplines.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {revDiscipline && availableLessons.length > 0 && (
              <div>
                <label className="block text-sm font-bold text-gray-300 mb-3">Aulas para Revisar</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-[#262626] p-4 rounded border border-[#404040]">
                  {availableLessons.map(lesson => (
                    <label key={lesson} className="flex items-center gap-3 p-2 hover:bg-[#333333] rounded cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedLessons.has(lesson)}
                        onChange={(e) => {
                          const newSet = new Set(selectedLessons);
                          if (e.target.checked) newSet.add(lesson);
                          else newSet.delete(lesson);
                          setSelectedLessons(newSet);
                        }}
                        className="w-4 h-4 text-purple-600 bg-[#404040] border-[#525252] rounded focus:ring-purple-500 focus:ring-2"
                      />
                      <span className="text-sm text-gray-200">{lesson}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {generatedRevision.length > 0 && (
              <div className="mt-8">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-lg text-white">Dicas e Bizus</h3>
                  <div className="flex gap-2">
                   <button
                      onClick={handleCopy}
                      className="text-sm bg-[#404040] hover:bg-[#525252] text-white px-4 py-2 rounded flex items-center gap-2 transition-colors"
                    >
                      <Copy className="w-4 h-4" /> Copiar Texto
                    </button>
                    <button
                      onClick={openRevisionTaskModal}
                      className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded flex items-center gap-2 transition-colors font-bold"
                    >
                      <Plus className="w-4 h-4" /> Gerar Tarefa
                    </button>
                  </div>
                </div>
                <div className="bg-[#262626] border border-[#404040] rounded p-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-300 leading-relaxed">
                    {generatedRevision.join('\n')}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
