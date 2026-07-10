export type QuestionSourceKind = 'estrategia' | 'tec' | 'professor' | 'official' | 'other';

export interface QuestionAlternative {
  label: string;
  text: string;
}

export interface QuestionAttempt {
  answer: string;
  isCorrect: boolean | null;
  attemptedAt: string;
}

export interface QuestionBankItem {
  id: string;
  fingerprint: string;
  sourceQuestionNumber?: number;
  statement: string;
  alternatives: QuestionAlternative[];
  correctAnswer?: string;
  isMultipleChoice?: boolean;
  sourceKind: QuestionSourceKind;
  sourceName: string;
  sourceFileName?: string;
  year?: number;
  exam?: string;
  institution?: string;
  targetSlug?: string;
  discipline: string;
  lesson?: string;
  taskTitle?: string;
  bank: string;
  tags: string[];
  favorite: boolean;
  hasDoubt: boolean;
  observations?: string;
  attempts: QuestionAttempt[];
  importedAt: string;
  updatedAt: string;
}

export interface Question {
  number: number;
  answer: string;
  isCorrect: boolean | null;
  hasDoubt: boolean;
  correctAnswer?: string;
  isMultipleChoice?: boolean;
  eliminated?: string[];
  observations?: string;
  doubtedAlts?: string[];
  localId?: string;
  sourceQuestionNumber?: number;
  statement?: string;
  alternatives?: QuestionAlternative[];
  sourceKind?: QuestionSourceKind;
  sourceName?: string;
  year?: number;
  exam?: string;
  institution?: string;
  favorite?: boolean;
  attempts?: QuestionAttempt[];
}

export interface ActivityBlock {
  id: string;
  title: string;
  lesson: string;
  pages: string;
  bank?: string;
  isLocked?: boolean;
  isSection?: boolean; // New: If true, this is a Section Header
  questions: Question[];
  showStats?: boolean;
  showGabarito?: boolean;
  layout?: {
    columns: number;
    rows: number;
    type: 'grid' | 'columns';
    width?: number; // 3, 6, 9, 12 (col-span on a 12-col grid)
    rowSpan?: number; // New: Vertical span on the grid
  };
}

export interface StudyTask {
  id: string;
  date: string;
  updatedAt?: string; // ISO timestamp of last local mutation — used for per-task conflict resolution
  planejamento?: string;
  meta?: string;
  tarefa?: string;
  assunto?: string;
  discipline: string;
  bank: string;
  blocks: ActivityBlock[];
  status: 'in_progress' | 'completed';
}

export type PlannerTaskStatus = 'pending' | 'completed' | 'started' | 'ignored' | 'archived';
export type PlannerTaskSource = 'ls-meta-text' | 'ls-meta-pdf' | 'manual' | 'generated';
export type PlannerMetaHistoryOrigin = 'ls' | 'generated';
export type PlannerTaskSourceKind = 'ls' | 'trilha_estrategica' | 'generated_planner' | 'manual';
export type PlannerTaskBlockKind = 'theory' | 'questions' | 'review';

export interface PlannerTaskScoreBreakdown {
  weakness: number;
  incidence: number;
  tier: number;
  coverageNeed: number;
  reviewDebt: number;
  lsAlignment: number;
  targetFit: number;
  overlapValue: number;
  deadlinePressure: number;
  bancaFit: number;
  balancePenalty: number;
  lowTrustPenalty: number;
  finalScore: number;
}

export interface PlannerTask {
  id: string;
  number: number;
  metaNumber?: number;
  planejamento?: string;
  discipline: string;
  format: string;
  description: string;
  details?: string;
  tips?: string;
  spentMinutes: number;
  estimatedMinutes: number;
  performance: number | null;
  status: PlannerTaskStatus;
  relevance: number;
  scheduledDate?: string;
  startTime?: string;
  durationMinutes: number;
  source: PlannerTaskSource;
  plannerSourceKind?: PlannerTaskSourceKind;
  targetSlug?: string;
  originTaskId?: string;
  plannedBlockKind?: PlannerTaskBlockKind;
  plannedQuestions?: number;
  materialHint?: string;
  sourceReason?: string[];
  scoreBreakdown?: PlannerTaskScoreBreakdown;
  displacedReason?: string;
  linkedStudyTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlannerMetaSummary {
  id: string;
  title: string;
  planejamento?: string;
  metaNumber?: number;
  totalTasks: number;
  totalDisciplines: number;
  completedPercent: number;
  completedTasks: number;
  pendingTasks: number;
  ignoredTasks: number;
  startedTasks: number;
  startedAt?: string;
  nextMetaAt?: string;
  importedAt: string;
}

export interface PlannerMetaHistoryEntry {
  id: string;
  meta: PlannerMetaSummary;
  tasks: PlannerTask[];
  archivedAt: string;
  origin?: PlannerMetaHistoryOrigin;
  relatedMetaId?: string;
}

export interface RevisionTaskModalState {
  isOpen: boolean;
  planejamento: string;
  meta: string;
  tarefa: string;
  discipline: string;
  assunto: string;
  bank: string;
  blocks: ActivityBlock[];
}
