import type {
  SourceTaskExecutionInput,
  SprintAction,
  SprintDay,
  TaskExecutionResult,
} from '../api/sprint';
import {
  STUDY_OS_DATA_CHANGED,
  parseStudyOsDataChangedDetail,
  type StudyOsResource,
} from '../dataChanged';

type ExecutionEvidence = Omit<SourceTaskExecutionInput, 'outcome' | 'sprintActionId' | 'expectedVersion'>;

export const buildSprintActionExecutionInput = (
  action: SprintAction,
  outcome: SourceTaskExecutionInput['outcome'],
  evidence: ExecutionEvidence,
): SourceTaskExecutionInput => ({
  outcome,
  ...evidence,
  sprintActionId: action.id,
  expectedVersion: action.version,
});

export const mergeSavedSprintAction = (day: SprintDay, saved: TaskExecutionResult): SprintDay => ({
  ...day,
  actions: saved.sprintAction
    ? day.actions.map((item) => item.id === saved.sprintAction?.id ? { ...item, ...saved.sprintAction } : item)
    : day.actions,
});

export const resultRefreshNotice = (refreshed: boolean) => refreshed
  ? 'Resultado salvo e restante do dia recalculado.'
  : 'Resultado salvo; recálculo pendente.';

export const subscribeStudyOsDataChanged = (
  target: EventTarget,
  targetSlug: string,
  resources: readonly StudyOsResource[],
  reload: () => void,
) => {
  const handler = (event: Event) => {
    const detail = parseStudyOsDataChangedDetail((event as CustomEvent<unknown>).detail);
    if (!detail || detail.targetSlug !== targetSlug || !detail.resources.some((resource) => resources.includes(resource))) return;
    reload();
  };
  target.addEventListener(STUDY_OS_DATA_CHANGED, handler);
  return () => target.removeEventListener(STUDY_OS_DATA_CHANGED, handler);
};
