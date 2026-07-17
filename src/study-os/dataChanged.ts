export const STUDY_OS_DATA_CHANGED = 'study-os:data-changed';

export type StudyOsResource = 'source-plan' | 'sprint-day' | 'calendar' | 'evidence' | 'questions';

export interface StudyOsDataChangedDetail {
  targetSlug: string;
  taskId?: number;
  resources: StudyOsResource[];
}

const resources: readonly StudyOsResource[] = ['source-plan', 'sprint-day', 'calendar', 'evidence', 'questions'];

export const parseStudyOsDataChangedDetail = (value: unknown): StudyOsDataChangedDetail | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const detail = value as Record<string, unknown>;
  if (typeof detail.targetSlug !== 'string' || !detail.targetSlug.trim()
    || !Array.isArray(detail.resources)
    || !detail.resources.every((resource): resource is StudyOsResource =>
      typeof resource === 'string' && resources.includes(resource as StudyOsResource))
    || detail.resources.length === 0
    || !(detail.taskId === undefined || (Number.isInteger(detail.taskId) && Number(detail.taskId) > 0))) {
    return null;
  }
  return {
    targetSlug: detail.targetSlug.trim(),
    ...(detail.taskId === undefined ? {} : { taskId: Number(detail.taskId) }),
    resources: [...new Set(detail.resources as StudyOsResource[])],
  };
};

export const announceStudyOsDataChanged = (detail: StudyOsDataChangedDetail) => {
  const parsed = parseStudyOsDataChangedDetail(detail);
  if (!parsed) throw new TypeError('Invalid Study OS data-change detail');
  window.dispatchEvent(new CustomEvent(STUDY_OS_DATA_CHANGED, { detail: parsed }));
};
