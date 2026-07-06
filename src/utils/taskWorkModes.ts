import { StudyTask } from '../types';

export type TaskWorkTab = 'caderno' | 'questoes' | 'cards' | 'gabarito';

export const taskHasExecutableQuestions = (task?: StudyTask | null) =>
  Boolean(task?.blocks.some((block) => block.questions.some((question) => question.statement && question.alternatives?.length)));

export const getDefaultTaskWorkTab = (task?: StudyTask | null): TaskWorkTab =>
  taskHasExecutableQuestions(task) ? 'questoes' : 'caderno';

export const normalizeTaskWorkTabForTask = (task: StudyTask | null | undefined, tab: TaskWorkTab): TaskWorkTab => {
  if ((tab === 'questoes' || tab === 'cards') && !taskHasExecutableQuestions(task)) {
    return 'caderno';
  }

  return tab;
};
