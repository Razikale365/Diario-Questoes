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
}

export type LayoutType = 'grid' | 'columns';

export interface LayoutConfig {
  columns: number;
  rows: number;
  type: LayoutType;
  width?: number; // 3, 6, 9, 12 (col-span on a 12-col grid)
  rowSpan?: number; // Vertical span on the grid
}

export type LayoutPatch = Partial<LayoutConfig>;

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
  layout?: LayoutConfig;
}

export interface StudyTask {
  id: string;
  date: string;
  updatedAt?: string; // ISO timestamp of last local mutation — used for per-task conflict resolution
  deletedAt?: string; // ISO timestamp for soft-delete/trash retention
  idealMinutes?: number;
  elapsedSeconds?: number;
  timerStartedAt?: string | null;
  planejamento?: string;
  meta?: string;
  tarefa?: string;
  assunto?: string;
  discipline: string;
  bank: string;
  blocks: ActivityBlock[];
  status: 'in_progress' | 'completed';
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
