import { ActivityBlock, StudyTask } from '../types';
import { parseLSTask } from './parser';

export interface ImportLineAnalysis {
  index: number;
  text: string;
  status: 'recognized' | 'ignored';
  reason: string;
}

export interface ImportAnalysis {
  blocks: ActivityBlock[];
  totalQuestions: number;
  recognizedLines: ImportLineAnalysis[];
  ignoredLines: ImportLineAnalysis[];
  idealMinutes?: number;
}

export interface TaskSummary {
  totalQuestions: number;
  answered: number;
  correct: number;
  errors: number;
  doubts: number;
  accuracy: number | null;
  elapsedSeconds: number;
  idealSeconds: number | null;
  timeDeltaSeconds: number | null;
  weakTopics: Array<{
    lesson: string;
    title: string;
    errors: number;
    doubts: number;
    total: number;
    accuracy: number | null;
  }>;
}

export const extractIdealMinutes = (text: string): number | undefined => {
  const timeLabel = '(?:tempo\\s+ideal|estimativa\\s+de\\s+tempo|tempo\\s+estimado)';
  const hourMinute = text.match(new RegExp(`${timeLabel}[^\\d]*(\\d+)\\s*h(?:ora)?s?\\s*(\\d+)?`, 'i'));
  if (hourMinute) {
    return Number(hourMinute[1]) * 60 + Number(hourMinute[2] || 0);
  }

  const minutes = text.match(new RegExp(`${timeLabel}[^\\d]*(\\d+)\\s*(?:min|minuto|minutos)`, 'i'));
  if (minutes) return Number(minutes[1]);

  return undefined;
};

const isRecognizedLine = (line: string): { recognized: boolean; reason: string } => {
  const trimmed = line.trim();
  if (!trimmed) return { recognized: false, reason: 'Linha em branco' };

  const patterns: Array<[RegExp, string]> = [
    [/^Assuntos?:/i, 'Assunto detectado'],
    [/^Atividade\s+\d+/i, 'Atividade detectada'],
    [/^Aula\s+\d+/i, 'Aula detectada'],
    [/estude\s+(?:a\s+)?(?:vers[aã]o\s+simplificada\s+da\s+)?teoria/i, 'Estudo teórico detectado'],
    [/Resolva\s+as\s+quest/i, 'Comando de resolução'],
    [/quest(?:ões|oes|ao|ão).*\d+/i, 'Intervalo de questões'],
    [/p[aá]ginas?\s+\d+/i, 'Páginas detectadas'],
    [/(?:tempo\s+ideal|estimativa\s+de\s+tempo|tempo\s+estimado)/i, 'Tempo detectado'],
    [/sugest[aã]o\s+de\s+descanso/i, 'Descanso detectado'],
    [/vers[aã]o\s+original/i, 'Versão detectada']
  ];

  const match = patterns.find(([pattern]) => pattern.test(trimmed));
  return match ? { recognized: true, reason: match[1] } : { recognized: false, reason: 'Sem padrão LS reconhecido' };
};

export const analyzeImportText = (text: string): ImportAnalysis => {
  const blocks = parseLSTask(text);
  const lines = text.split(/\r?\n/).map((line, index) => {
    const result = isRecognizedLine(line);
    return {
      index: index + 1,
      text: line,
      status: result.recognized ? 'recognized' as const : 'ignored' as const,
      reason: result.reason
    };
  }).filter(line => line.text.trim());

  return {
    blocks,
    totalQuestions: blocks.filter(block => !block.isSection).reduce((sum, block) => sum + block.questions.length, 0),
    recognizedLines: lines.filter(line => line.status === 'recognized'),
    ignoredLines: lines.filter(line => line.status === 'ignored'),
    idealMinutes: extractIdealMinutes(text)
  };
};

export const getTaskElapsedSeconds = (task: StudyTask, now = Date.now()): number => {
  const base = task.elapsedSeconds || 0;
  if (!task.timerStartedAt) return base;
  return base + Math.max(0, Math.floor((now - new Date(task.timerStartedAt).getTime()) / 1000));
};

export const summarizeTask = (task: StudyTask, now = Date.now()): TaskSummary => {
  const activityBlocks = (task.blocks || []).filter(block => !block.isSection);
  const questions = activityBlocks.flatMap(block => block.questions || []);
  const correct = questions.filter(question => question.isCorrect === true).length;
  const errors = questions.filter(question => question.isCorrect === false).length;
  const doubts = questions.filter(question => question.hasDoubt).length;
  const answered = correct + errors;
  const elapsedSeconds = getTaskElapsedSeconds(task, now);
  const idealSeconds = task.idealMinutes ? task.idealMinutes * 60 : null;

  const weakTopics = activityBlocks
    .map(block => {
      const blockQuestions = block.questions || [];
      const blockAnswered = blockQuestions.filter(question => question.isCorrect !== null).length;
      const blockCorrect = blockQuestions.filter(question => question.isCorrect === true).length;
      const blockErrors = blockQuestions.filter(question => question.isCorrect === false).length;
      const blockDoubts = blockQuestions.filter(question => question.hasDoubt).length;
      return {
        lesson: block.lesson || block.title,
        title: block.title,
        errors: blockErrors,
        doubts: blockDoubts,
        total: blockQuestions.length,
        accuracy: blockAnswered > 0 ? Math.round((blockCorrect / blockAnswered) * 100) : null
      };
    })
    .filter(topic => topic.errors > 0 || topic.doubts > 0)
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || (b.errors + b.doubts) - (a.errors + a.doubts))
    .slice(0, 5);

  return {
    totalQuestions: questions.length,
    answered,
    correct,
    errors,
    doubts,
    accuracy: answered > 0 ? Math.round((correct / answered) * 100) : null,
    elapsedSeconds,
    idealSeconds,
    timeDeltaSeconds: idealSeconds === null ? null : elapsedSeconds - idealSeconds,
    weakTopics
  };
};

export const formatDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  return `${minutes}min ${String(remainingSeconds).padStart(2, '0')}s`;
};
