import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  AlertTriangle,
  Ban,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock as ClockIcon,
  ClipboardList,
  Database as DatabaseIcon,
  FileUp,
  GripVertical,
  History,
  Home,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Play,
  RotateCcw,
  Sparkles,
  Table2,
  Target,
  Timer,
} from 'lucide-react';

import { PlannerMetaHistoryEntry, PlannerMetaHistoryOrigin, PlannerMetaSummary, PlannerTask, QuestionBankItem, StudyTask } from '../types';
import {
  applyPlannerTaskResult,
  autoSchedulePlannerTasks,
  buildPlannerTaskChatPrompt,
  buildMonthGrid,
  buildWeekDays,
  formatMinutes,
  getPlannerTodayCommandCenter,
  mergePlannerTasks,
  parseLsMetaText,
  type PlannerTaskResultInput,
  toIsoDate,
} from '../utils/planner';
import { extractPdfText } from '../utils/pdfQuestionImport';
import {
  generateNextMetaDraft,
  materializeDraftTasks,
  plannerDraftTaskKey,
  PlannerDraft,
  PlannerDraftTask,
  summarizeDraftTasks,
} from '../utils/plannerGenerator';
import { buildPlannerInsights, PlannerDisciplineInsight, PlannerInsights } from '../utils/plannerInsights';
import {
  isStudyTaskCompatibleWithPlannerTask,
  loadStoredQuestionBank,
  matchQuestionBankItemsToPlannerTask,
  mergeQuestionBankItems,
  persistQuestionBank,
  QUESTION_BANK_UPDATED_EVENT,
  questionBankItemToQuestion,
} from '../utils/questionBank';
import { createPlannerTaskModalStyle } from '../utils/modalSizing';
import { parseStudyImportPackage, parseWeekScheduleImport, WeekScheduleImport } from '../utils/studyImportPackage';
import {
  buildTargetDecisionRows,
  buildStudyDayPlan,
  buildStudyRefreshPlan,
  buildStudyWeekPlan,
  DEFAULT_STUDY_TARGET_PROFILES,
  formatStudyCoverageTable,
  formatStudySourceTable,
  formatStudyTargetProfileTable,
  inferStudySourceSignalsFromText,
  materializeStudyBlocksAsPlannerTasks,
  materializeStudyWeekAsPlannerTasks,
  parseStudyCoverageTable,
  parseStudySourceTable,
  parseStudyTargetProfileTable,
  seedCoverageForTarget,
  seedSourceSignalsForTarget,
  DailyStudyBlock,
  ExamTargetProfile,
  StudyDayPlan,
  StudyPlanPhase,
  StudyRefreshPlan,
  StudyScoreboardRow,
  StudySourceKind,
  StudySourceItem,
  StudyWeekPlan,
  TargetDecisionRow,
  TopicFeedback,
} from '../utils/studyPlannerCore';

type PlannerView = 'month' | 'week';
type PlannerSection = 'today' | 'meta' | 'calendar' | 'insights' | 'generator' | 'history' | 'maps' | 'list' | 'discipline' | 'pending' | 'ignored' | 'archived';
type DraftTaskItem = { key: string; task: PlannerDraftTask };
type DraftTaskEdit = Partial<Pick<PlannerDraftTask, 'description' | 'durationMinutes' | 'relevance'>>;

interface PlannerAreaProps {
  studyTasks: StudyTask[];
  onOpenStudyTask: (taskId: string) => void;
  onCreateStudyTask: (task: StudyTask) => void;
  showToast: (message: string) => void;
}

const TASKS_KEY = 'ls_planner_tasks_v1';
const META_KEY = 'ls_planner_meta_v1';
const HISTORY_KEY = 'ls_planner_meta_history_v1';
const STUDY_OS_TARGET_KEY = 'study_os_target_v1';
const STUDY_OS_PHASE_KEY = 'study_os_phase_v1';
const STUDY_OS_COVERAGE_KEY = 'study_os_coverage_table_v1';
const STUDY_OS_TARGET_PROFILES_KEY = 'study_os_target_profiles_v1';
const STUDY_OS_SOURCE_SIGNALS_KEY = 'study_os_source_signals_v1';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HOUR_SLOTS = Array.from({ length: 18 }, (_, index) => `${String(index + 6).padStart(2, '0')}:00`);

const SECTION_NAV: Array<{ id: PlannerSection; label: string; icon: React.ElementType }> = [
  { id: 'today', label: 'Hoje', icon: Home },
  { id: 'meta', label: 'Meta Atual', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'generator', label: 'Gerador', icon: Sparkles },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'maps', label: 'Mapas', icon: MapIcon },
  { id: 'list', label: 'Lista', icon: Table2 },
  { id: 'discipline', label: 'Por Disciplina', icon: Layers },
  { id: 'pending', label: 'Pendentes', icon: Target },
  { id: 'ignored', label: 'Ignoradas', icon: Ban },
  { id: 'archived', label: 'Arquivadas', icon: Archive },
];

const loadStoredTasks = () => {
  try {
    const stored = localStorage.getItem(TASKS_KEY);
    return stored ? (JSON.parse(stored) as PlannerTask[]) : [];
  } catch {
    return [];
  }
};

const loadStoredMeta = () => {
  try {
    const stored = localStorage.getItem(META_KEY);
    return stored ? (JSON.parse(stored) as PlannerMetaSummary) : null;
  } catch {
    return null;
  }
};

const loadStoredHistory = () => {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? (JSON.parse(stored) as PlannerMetaHistoryEntry[]) : [];
  } catch {
    return [];
  }
};

const defaultStudyOsTarget = (profiles = DEFAULT_STUDY_TARGET_PROFILES) =>
  profiles.find((target) => target.active)?.slug || profiles[0]?.slug || 'bacen_economia_financas';

const loadStoredStudyOsTargetProfiles = () => {
  try {
    const stored = localStorage.getItem(STUDY_OS_TARGET_PROFILES_KEY);
    const parsed = stored ? parseStudyTargetProfileTable(stored) : [];
    return parsed.length > 0 ? parsed : DEFAULT_STUDY_TARGET_PROFILES;
  } catch {
    return DEFAULT_STUDY_TARGET_PROFILES;
  }
};

const loadStoredStudyOsTarget = () => {
  try {
    const profiles = loadStoredStudyOsTargetProfiles();
    const stored = localStorage.getItem(STUDY_OS_TARGET_KEY);
    return profiles.some((target) => target.slug === stored) ? stored! : defaultStudyOsTarget(profiles);
  } catch {
    return defaultStudyOsTarget();
  }
};

const loadStoredStudyOsPhase = (): StudyPlanPhase => {
  try {
    const stored = localStorage.getItem(STUDY_OS_PHASE_KEY);
    return stored === 'pos_edital' ? 'pos_edital' : 'pre_edital';
  } catch {
    return 'pre_edital';
  }
};

const loadStoredStudyOsCoverage = () => {
  try {
    const stored = localStorage.getItem(STUDY_OS_COVERAGE_KEY);
    return stored || formatStudyCoverageTable(seedCoverageForTarget(loadStoredStudyOsTarget()));
  } catch {
    return formatStudyCoverageTable(seedCoverageForTarget(defaultStudyOsTarget()));
  }
};

const loadStoredStudyOsSourceSignals = () => {
  try {
    const stored = localStorage.getItem(STUDY_OS_SOURCE_SIGNALS_KEY);
    return stored || formatStudySourceTable(seedSourceSignalsForTarget(loadStoredStudyOsTarget()));
  } catch {
    return formatStudySourceTable(seedSourceSignalsForTarget(defaultStudyOsTarget()));
  }
};

const statusLabel: Record<PlannerTask['status'], string> = {
  pending: 'Pendente',
  completed: 'Concluída',
  started: 'Iniciada',
  ignored: 'Ignorada',
  archived: 'Arquivada',
};

const statusClass: Record<PlannerTask['status'], string> = {
  pending: 'border-purple-500/20 bg-purple-500/10 text-purple-200',
  completed: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
  started: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  ignored: 'border-gray-500/20 bg-gray-500/10 text-gray-400',
  archived: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300',
};

const plannedBlockKindLabel: Record<string, string> = {
  theory: 'Teoria',
  questions: 'Questões',
  review: 'Revisão',
};

const historyOriginLabel: Record<PlannerMetaHistoryOrigin, string> = {
  ls: 'LS',
  generated: 'Gerada',
};

const historyOriginClass: Record<PlannerMetaHistoryOrigin, string> = {
  ls: 'border-purple-500/20 bg-purple-500/10 text-purple-200',
  generated: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
};

const shiftMonth = (date: Date, delta: number) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
const shiftWeek = (date: Date, delta: number) => {
  const next = new Date(date);
  next.setDate(date.getDate() + delta * 7);
  return next;
};
const shiftDate = (date: Date, delta: number) => {
  const next = new Date(date);
  next.setDate(date.getDate() + delta);
  return next;
};

const groupTasksByDate = (tasks: PlannerTask[]) => {
  return tasks.reduce<Record<string, PlannerTask[]>>((acc, task) => {
    if (!task.scheduledDate) return acc;
    acc[task.scheduledDate] ||= [];
    acc[task.scheduledDate].push(task);
    return acc;
  }, {});
};

const taskMatchesFilter = (task: PlannerTask, discipline: string, hideDone: boolean) => {
  if (task.status === 'archived') return false;
  if (discipline && task.discipline !== discipline) return false;
  if (hideDone && task.status === 'completed') return false;
  return true;
};

const upsertHistoryEntry = (history: PlannerMetaHistoryEntry[], entry: PlannerMetaHistoryEntry) => {
  const withoutCurrent = history.filter((item) => item.id !== entry.id);
  return [entry, ...withoutCurrent].sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt));
};

const inferHistoryOrigin = (tasks: PlannerTask[]): PlannerMetaHistoryOrigin =>
  tasks.length > 0 && tasks.every((task) => task.source === 'generated') ? 'generated' : 'ls';

const buildHistoryEntry = (
  meta: PlannerMetaSummary,
  tasks: PlannerTask[],
  options: { origin?: PlannerMetaHistoryOrigin; relatedMetaId?: string } = {},
): PlannerMetaHistoryEntry => ({
  id: meta.id,
  meta,
  tasks: tasks.map((task) => ({ ...task })),
  archivedAt: new Date().toISOString(),
  origin: options.origin || inferHistoryOrigin(tasks),
  relatedMetaId: options.relatedMetaId,
});

const getHistoryOrigin = (entry: PlannerMetaHistoryEntry): PlannerMetaHistoryOrigin => entry.origin || 'ls';

const sumTaskMinutes = (tasks: PlannerTask[]) => tasks.reduce((sum, task) => sum + task.durationMinutes, 0);

const countTaskDisciplines = (tasks: PlannerTask[]) => new Set(tasks.map((task) => task.discipline)).size;

const averageRelevance = (tasks: PlannerTask[]) =>
  Math.round(tasks.reduce((sum, task) => sum + task.relevance, 0) / Math.max(1, tasks.length));

const formatSignedNumber = (value: number) => `${value > 0 ? '+' : ''}${value}`;

const formatSignedMinutes = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${formatMinutes(Math.abs(value))}`;

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatShortDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const buildStudyTaskFromPlanner = (plannerTask: PlannerTask, bankItems: QuestionBankItem[] = []): StudyTask => {
  const matchedQuestions = bankItems.map(questionBankItemToQuestion);
  const bank = bankItems[0]?.bank || 'Outra';
  const sourceNames = Array.from(new Set(bankItems.map((item) => item.sourceName))).slice(0, 2);
  const title = `Tarefa ${plannerTask.number} - ${plannerTask.discipline}`;

  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    planejamento: plannerTask.planejamento || 'Planner',
    meta: plannerTask.metaNumber ? String(plannerTask.metaNumber) : '',
    tarefa: String(plannerTask.number),
    assunto: plannerTask.description,
    discipline: plannerTask.discipline,
    bank,
    blocks: [
      {
        id: crypto.randomUUID(),
        title,
        lesson: sourceNames.length > 0 ? `${plannerTask.description} · ${sourceNames.join(', ')}` : plannerTask.description,
        pages: matchedQuestions.length > 0 ? `${matchedQuestions.length} questões do banco` : '',
        bank,
        questions: matchedQuestions,
        showStats: matchedQuestions.length > 0,
        showGabarito: false,
        layout: {
          columns: 1,
          rows: Math.min(Math.max(matchedQuestions.length || 1, 1), 8),
          type: 'grid',
          width: 12,
          rowSpan: matchedQuestions.length > 0 ? 4 : undefined,
        },
      },
    ],
    status: 'in_progress',
  };
};

const buildStudyOsSourceItems = (tasks: PlannerTask[], targetSlug: string): StudySourceItem[] => {
  const sourceTargetSlug = targetSlug === 'sefaz_ce' ? 'sefaz_ce' : 'legacy';
  return tasks
    .filter((task) => task.status !== 'archived')
    .map((task) => ({
      id: task.id,
      sourceKind: task.source.startsWith('ls') ? 'ls' : 'manual',
      targetSlug: task.source.startsWith('ls') ? sourceTargetSlug : 'shared',
      discipline: task.discipline,
      topic: task.description,
      taskText: [task.format, task.details, task.tips].filter(Boolean).join('\n'),
      priorityHint: task.relevance,
      sourceTrust: task.source.startsWith('ls') ? 8 : 5,
      sourceOrder: task.number,
    }));
};

const buildStudyOsFeedbackRows = (items: QuestionBankItem[]): TopicFeedback[] => {
  const byTopic = new Map<string, TopicFeedback>();

  items.forEach((item) => {
    const topic = item.lesson || item.taskTitle || item.tags[0] || item.sourceName;
    if (!item.discipline || !topic) return;
    const wrong = item.attempts.filter((attempt) => attempt.isCorrect === false).length;
    const doubts = item.hasDoubt ? 1 : 0;
    const favorites = item.favorite ? 1 : 0;
    if (wrong === 0 && doubts === 0 && favorites === 0) return;

    const key = `${item.discipline}::${topic}`;
    const current = byTopic.get(key) || {
      discipline: item.discipline,
      topic,
      weaknessScore: 0,
      attempts: 0,
      wrong: 0,
      doubts: 0,
      favorites: 0,
    };

    const nextWrong = (current.wrong || 0) + wrong;
    const nextDoubts = (current.doubts || 0) + doubts;
    const nextFavorites = (current.favorites || 0) + favorites;
    byTopic.set(key, {
      ...current,
      attempts: (current.attempts || 0) + item.attempts.length,
      wrong: nextWrong,
      doubts: nextDoubts,
      favorites: nextFavorites,
      weaknessScore: Math.min(10, nextWrong * 2 + nextDoubts * 2 + nextFavorites),
      lastSeenAt: item.updatedAt,
    });
  });

  return Array.from(byTopic.values());
};

export const PlannerArea: React.FC<PlannerAreaProps> = ({
  studyTasks,
  onOpenStudyTask,
  onCreateStudyTask,
  showToast,
}) => {
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>(loadStoredTasks);
  const [metaSummary, setMetaSummary] = useState<PlannerMetaSummary | null>(loadStoredMeta);
  const [metaHistory, setMetaHistory] = useState<PlannerMetaHistoryEntry[]>(loadStoredHistory);
  const [importText, setImportText] = useState('');
  const [activeSection, setActiveSection] = useState<PlannerSection>('today');
  const [view, setView] = useState<PlannerView>('month');
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [weekDate, setWeekDate] = useState(() => new Date());
  const [disciplineFilter, setDisciplineFilter] = useState('');
  const [hideDone, setHideDone] = useState(true);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [maxTasksPerDay, setMaxTasksPerDay] = useState(4);
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(4);
  const [draftWeeklyHours, setDraftWeeklyHours] = useState(18);
  const [draftMaxTasks, setDraftMaxTasks] = useState(18);
  const [draftTaskEdits, setDraftTaskEdits] = useState<Record<string, DraftTaskEdit>>({});
  const [removedDraftKeys, setRemovedDraftKeys] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('08:00');
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [questionBankItems, setQuestionBankItems] = useState<QuestionBankItem[]>(loadStoredQuestionBank);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [studyOsTargetProfiles, setStudyOsTargetProfiles] = useState<ExamTargetProfile[]>(loadStoredStudyOsTargetProfiles);
  const [studyOsTargetProfileDraft, setStudyOsTargetProfileDraft] = useState(() =>
    formatStudyTargetProfileTable(loadStoredStudyOsTargetProfiles()),
  );
  const [studyOsTarget, setStudyOsTarget] = useState(loadStoredStudyOsTarget);
  const [studyOsPhase, setStudyOsPhase] = useState<StudyPlanPhase>(loadStoredStudyOsPhase);
  const [studyOsCoverageDraft, setStudyOsCoverageDraft] = useState(loadStoredStudyOsCoverage);
  const [studyOsSourceDraft, setStudyOsSourceDraft] = useState(loadStoredStudyOsSourceSignals);
  const [studyOsRawSourceText, setStudyOsRawSourceText] = useState('');
  const [studyOsRawSourceKind, setStudyOsRawSourceKind] = useState<StudySourceKind | 'auto'>('auto');
  const [studyOsPlan, setStudyOsPlan] = useState<StudyDayPlan | null>(null);
  const [studyOsWeekPlan, setStudyOsWeekPlan] = useState<StudyWeekPlan | null>(null);
  const [studyOsRefreshPlan, setStudyOsRefreshPlan] = useState<StudyRefreshPlan | null>(null);

  useEffect(() => {
    localStorage.setItem(TASKS_KEY, JSON.stringify(plannerTasks));
  }, [plannerTasks]);

  useEffect(() => {
    if (metaSummary) {
      localStorage.setItem(META_KEY, JSON.stringify(metaSummary));
    } else {
      localStorage.removeItem(META_KEY);
    }
  }, [metaSummary]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(metaHistory));
  }, [metaHistory]);

  useEffect(() => {
    localStorage.setItem(STUDY_OS_TARGET_KEY, studyOsTarget);
  }, [studyOsTarget]);

  useEffect(() => {
    localStorage.setItem(STUDY_OS_PHASE_KEY, studyOsPhase);
  }, [studyOsPhase]);

  useEffect(() => {
    localStorage.setItem(STUDY_OS_COVERAGE_KEY, studyOsCoverageDraft);
  }, [studyOsCoverageDraft]);

  useEffect(() => {
    localStorage.setItem(STUDY_OS_SOURCE_SIGNALS_KEY, studyOsSourceDraft);
  }, [studyOsSourceDraft]);

  useEffect(() => {
    localStorage.setItem(STUDY_OS_TARGET_PROFILES_KEY, formatStudyTargetProfileTable(studyOsTargetProfiles));
  }, [studyOsTargetProfiles]);

  useEffect(() => {
    if (metaSummary && plannerTasks.length > 0 && metaHistory.length === 0) {
      setMetaHistory([buildHistoryEntry(metaSummary, plannerTasks)]);
    }
  }, [metaSummary, plannerTasks, metaHistory.length]);

  useEffect(() => {
    if (activeSection === 'maps') {
      setQuestionBankItems(loadStoredQuestionBank());
    }
  }, [activeSection]);

  useEffect(() => {
    const refreshQuestionBank = () => {
      setQuestionBankItems(loadStoredQuestionBank());
    };

    window.addEventListener(QUESTION_BANK_UPDATED_EVENT, refreshQuestionBank);
    return () => window.removeEventListener(QUESTION_BANK_UPDATED_EVENT, refreshQuestionBank);
  }, []);

  useEffect(() => {
    if (selectedTaskId && !plannerTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [plannerTasks, selectedTaskId]);

  const activePlannerTasks = useMemo(
    () => plannerTasks.filter((task) => task.status !== 'archived'),
    [plannerTasks]
  );
  const todayCommandCenter = useMemo(
    () => getPlannerTodayCommandCenter(activePlannerTasks),
    [activePlannerTasks],
  );
  const selectedTask = useMemo(
    () => plannerTasks.find((task) => task.id === selectedTaskId) || null,
    [plannerTasks, selectedTaskId]
  );

  const filteredTasks = useMemo(
    () => activePlannerTasks.filter((task) => taskMatchesFilter(task, disciplineFilter, hideDone)),
    [activePlannerTasks, disciplineFilter, hideDone]
  );

  const disciplines = useMemo(
    () => Array.from(new Set(activePlannerTasks.map((task) => task.discipline))).sort(),
    [activePlannerTasks]
  );

  const unscheduledTasks = useMemo(
    () =>
      filteredTasks
        .filter((task) => !task.scheduledDate && (task.status === 'pending' || task.status === 'started'))
        .sort((a, b) => b.relevance - a.relevance || a.number - b.number),
    [filteredTasks]
  );

  const groupedByDate = useMemo(() => groupTasksByDate(filteredTasks), [filteredTasks]);
  const monthDays = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const weekDays = useMemo(() => buildWeekDays(weekDate), [weekDate]);
  const weekStartLabel = useMemo(() => {
    const [year, month, day] = weekDays[0].date.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }, [weekDays]);

  const stats = useMemo(() => {
    const total = activePlannerTasks.length;
    const completed = activePlannerTasks.filter((task) => task.status === 'completed').length;
    const scheduled = activePlannerTasks.filter((task) => task.scheduledDate).length;
    const pending = activePlannerTasks.filter((task) => task.status === 'pending').length;
    const archived = plannerTasks.filter((task) => task.status === 'archived').length;
    const totalMinutes = activePlannerTasks.reduce((sum, task) => sum + task.durationMinutes, 0);
    const scheduledMinutes = activePlannerTasks.filter((task) => task.scheduledDate).reduce((sum, task) => sum + task.durationMinutes, 0);
    return { total, completed, scheduled, pending, archived, totalMinutes, scheduledMinutes };
  }, [activePlannerTasks, plannerTasks]);

  const tasksByDiscipline = useMemo(() => {
    return disciplines.map((discipline) => {
      const tasks = activePlannerTasks
        .filter((task) => task.discipline === discipline)
        .sort((a, b) => a.number - b.number);
      return {
        discipline,
        tasks,
        total: tasks.length,
        pending: tasks.filter((task) => task.status === 'pending').length,
        completed: tasks.filter((task) => task.status === 'completed').length,
        relevance: Math.round(tasks.reduce((sum, task) => sum + task.relevance, 0) / Math.max(1, tasks.length)),
        minutes: tasks.reduce((sum, task) => sum + task.durationMinutes, 0),
      };
    });
  }, [disciplines, activePlannerTasks]);

  const visibleListTasks = useMemo(() => {
    if (activeSection === 'pending') {
      return activePlannerTasks.filter((task) => task.status === 'pending' || task.status === 'started').sort((a, b) => a.number - b.number);
    }
    if (activeSection === 'ignored') {
      return activePlannerTasks.filter((task) => task.status === 'ignored').sort((a, b) => a.number - b.number);
    }
    if (activeSection === 'archived') {
      return plannerTasks.filter((task) => task.status === 'archived').sort((a, b) => a.number - b.number);
    }
    return [...activePlannerTasks].sort((a, b) => a.number - b.number);
  }, [activeSection, activePlannerTasks, plannerTasks]);

  const plannerInsights = useMemo(
    () => buildPlannerInsights(activePlannerTasks, metaHistory, metaSummary?.id),
    [activePlannerTasks, metaHistory, metaSummary?.id]
  );

  const baseNextMetaDraft = useMemo(
    () => generateNextMetaDraft(activePlannerTasks, metaHistory, {
      weeklyHours: draftWeeklyHours,
      maxTasks: draftMaxTasks,
      currentMetaId: metaSummary?.id,
    }),
    [activePlannerTasks, metaHistory, draftWeeklyHours, draftMaxTasks, metaSummary?.id]
  );

  const baseDraftSignature = useMemo(
    () => baseNextMetaDraft.tasks.map((task) => plannerDraftTaskKey(task)).join('|'),
    [baseNextMetaDraft.tasks]
  );

  useEffect(() => {
    setDraftTaskEdits({});
    setRemovedDraftKeys([]);
  }, [baseDraftSignature]);

  const draftItems = useMemo<DraftTaskItem[]>(() => {
    return baseNextMetaDraft.tasks
      .map((task) => {
        const key = plannerDraftTaskKey(task);
        const edit = draftTaskEdits[key] || {};
        return {
          key,
          task: {
            ...task,
            ...edit,
            description: edit.description ?? task.description,
            durationMinutes: edit.durationMinutes ?? task.durationMinutes,
            relevance: edit.relevance ?? task.relevance,
          },
        };
      })
      .filter((item) => !removedDraftKeys.includes(item.key));
  }, [baseNextMetaDraft.tasks, draftTaskEdits, removedDraftKeys]);

  const nextMetaDraft = useMemo(
    () => summarizeDraftTasks(draftItems.map((item) => item.task), baseNextMetaDraft.warnings),
    [draftItems, baseNextMetaDraft.warnings]
  );

  const hasDraftCustomizations = Object.keys(draftTaskEdits).length > 0 || removedDraftKeys.length > 0;
  const studyOsActiveTarget = useMemo(
    () => studyOsTargetProfiles.find((target) => target.slug === studyOsTarget),
    [studyOsTarget, studyOsTargetProfiles]
  );
  const studyOsWeekStartDate = weekDays[1]?.date || toIsoDate(new Date());
  const studyOsManualSourceItems = useMemo(
    () => parseStudySourceTable(studyOsSourceDraft),
    [studyOsSourceDraft],
  );
  const studyOsCombinedSourceItems = useMemo(
    () => [...buildStudyOsSourceItems(activePlannerTasks, studyOsTarget), ...studyOsManualSourceItems],
    [activePlannerTasks, studyOsManualSourceItems, studyOsTarget],
  );
  const studyOsTargetDecisionRows = useMemo(
    () =>
      buildTargetDecisionRows({
        targetProfiles: studyOsTargetProfiles,
        coverageRows: parseStudyCoverageTable(studyOsCoverageDraft),
        feedbackRows: buildStudyOsFeedbackRows(questionBankItems),
        sourceItems: studyOsCombinedSourceItems,
        activeTargetSlug: studyOsTarget,
      }),
    [questionBankItems, studyOsCombinedSourceItems, studyOsCoverageDraft, studyOsTarget, studyOsTargetProfiles],
  );

  const importMetaText = (text: string, source: 'ls-meta-text' | 'ls-meta-pdf') => {
    const weekSchedule = parseWeekScheduleImport(text);
    if (weekSchedule) {
      setImportText('');
      applyWeekSchedule(weekSchedule);
      return;
    }

    const studyPackage = parseStudyImportPackage(text);
    if (studyPackage) {
      const nextTasks = metaSummary?.id === studyPackage.meta.id
        ? mergePlannerTasks(plannerTasks, studyPackage.tasks)
        : studyPackage.tasks;
      const mergedBank = mergeQuestionBankItems(loadStoredQuestionBank(), studyPackage.questionBankItems);

      setPlannerTasks(nextTasks);
      setMetaSummary(studyPackage.meta);
      setMetaHistory((current) => upsertHistoryEntry(current, buildHistoryEntry(studyPackage.meta, nextTasks)));
      persistQuestionBank(mergedBank.items);
      setQuestionBankItems(mergedBank.items);
      setImportText('');
      showToast(`${nextTasks.length} tarefas; ${mergedBank.added} questões novas; ${mergedBank.duplicates} já existiam.`);
      return;
    }

    const parsed = parseLsMetaText(text, source);
    if (parsed.tasks.length === 0) {
      showToast('Nenhuma tarefa da Meta Atual foi identificada.');
      return;
    }

    setPlannerTasks((current) => (
      metaSummary?.id === parsed.meta.id ? mergePlannerTasks(current, parsed.tasks) : parsed.tasks
    ));
    setMetaSummary(parsed.meta);
    setMetaHistory((current) => upsertHistoryEntry(current, buildHistoryEntry(parsed.meta, parsed.tasks)));
    setImportText('');
    showToast(`${parsed.tasks.length} tarefas importadas para o planner.`);
  };

  const applyWeekSchedule = (weekSchedule: WeekScheduleImport) => {
    const scheduleByNumber = new Map(weekSchedule.entries.map((entry) => [entry.number, entry]));
    const nextTasks = plannerTasks.map((task) => {
      const entry = scheduleByNumber.get(task.number);
      const matchesMeta = !weekSchedule.metaNumber || task.metaNumber === weekSchedule.metaNumber;
      if (!entry || !matchesMeta) return task;

      return {
        ...task,
        scheduledDate: entry.date,
        startTime: entry.startTime,
        updatedAt: new Date().toISOString(),
      };
    });
    const applied = nextTasks.filter((task, index) =>
      task.scheduledDate !== plannerTasks[index]?.scheduledDate ||
      task.startTime !== plannerTasks[index]?.startTime
    ).length;

    setPlannerTasks(nextTasks);
    if (metaSummary) {
      setMetaHistory((current) => upsertHistoryEntry(current, buildHistoryEntry(metaSummary, nextTasks)));
    }
    if (weekSchedule.startDate) {
      const scheduleDate = new Date(`${weekSchedule.startDate}T00:00:00`);
      setMonthDate(scheduleDate);
      setWeekDate(scheduleDate);
    }
    setView('week');
    setActiveSection('calendar');
    showToast(`${applied} tarefa(s) agendada(s) na semana.`);
  };

  const restoreHistoryEntry = (entry: PlannerMetaHistoryEntry) => {
    setMetaSummary(entry.meta);
    setPlannerTasks(entry.tasks);
    setActiveSection('meta');
    showToast(`${entry.meta.title} restaurada.`);
  };

  const handlePdfImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReadingPdf(true);
    try {
      const extracted = await extractPdfText(file);
      importMetaText(extracted.text, 'ls-meta-pdf');
    } catch (error) {
      console.error('[Diário LS] Planner PDF import failed', error);
      showToast('Erro ao ler PDF da meta.');
    } finally {
      setIsReadingPdf(false);
      event.target.value = '';
    }
  };

  const updatePlannerTask = (taskId: string, updates: Partial<PlannerTask>) => {
    setPlannerTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, ...updates, updatedAt: new Date().toISOString() } : task
      )
    );
  };

  const applyTaskResult = (taskId: string, result: PlannerTaskResultInput) => {
    const resultLabel: Record<PlannerTaskResultInput['outcome'], string> = {
      started: 'Tarefa iniciada.',
      completed: 'Resultado registrado.',
      failed: 'Falha registrada para refresh.',
      skipped: 'Tarefa ignorada.',
    };
    const now = new Date().toISOString();
    setPlannerTasks((current) =>
      current.map((task) => (task.id === taskId ? applyPlannerTaskResult(task, result, now) : task))
    );
    showToast(resultLabel[result.outcome]);
  };

  const copyPlannerTaskChatPrompt = async (task: PlannerTask) => {
    const targetSlug = task.targetSlug || task.details?.match(/^\s*Target\s*:\s*(.+)$/im)?.[1]?.trim();
    const targetProfile = targetSlug
      ? studyOsTargetProfiles.find((profile) => profile.slug === targetSlug)
      : studyOsActiveTarget;
    const prompt = buildPlannerTaskChatPrompt(task, {
      targetName: targetProfile?.name,
      organizer: targetProfile?.organizer,
      phase: targetProfile?.phase || studyOsPhase,
    });

    try {
      await navigator.clipboard.writeText(prompt);
      showToast('Prompt do ChatGPT copiado.');
    } catch (error) {
      console.error('[Diário LS] Planner prompt copy failed', error);
      showToast('Não consegui copiar o prompt.');
    }
  };

  const scheduleTask = (taskId: string, date: string, time?: string) => {
    updatePlannerTask(taskId, {
      scheduledDate: date,
      startTime: time,
    });
  };

  const clearSchedule = (taskId: string) => {
    updatePlannerTask(taskId, {
      scheduledDate: undefined,
      startTime: undefined,
    });
  };

  const archivePlannerTask = (taskId: string) => {
    updatePlannerTask(taskId, {
      status: 'archived',
      scheduledDate: undefined,
      startTime: undefined,
    });
  };

  const restorePlannerTask = (taskId: string) => {
    updatePlannerTask(taskId, {
      status: 'pending',
    });
  };

  const autoOrganize = () => {
    setPlannerTasks((current) =>
      autoSchedulePlannerTasks(current, {
        maxTasksPerDay,
        maxMinutesPerDay: maxHoursPerDay * 60,
        startTime,
        availableWeekdays: [1, 2, 3, 4, 5, 6],
        monthDate,
        startDate: new Date(),
      })
    );
    setActiveSection('calendar');
    showToast('Planner auto-organizado.');
  };

  const createOrOpenStudyTask = (task: PlannerTask) => {
    const linkedTask = task.linkedStudyTaskId
      ? studyTasks.find((studyTask) => studyTask.id === task.linkedStudyTaskId)
      : null;

    if (linkedTask && isStudyTaskCompatibleWithPlannerTask(task, linkedTask)) {
      onOpenStudyTask(linkedTask.id);
      return;
    }

    const matches = matchQuestionBankItemsToPlannerTask(task, loadStoredQuestionBank());
    const studyTask = buildStudyTaskFromPlanner(task, matches);
    onCreateStudyTask(studyTask);
    updatePlannerTask(task.id, { linkedStudyTaskId: studyTask.id });
    if (matches.length > 0) {
      showToast(`${matches.length} questão(ões) do banco vinculadas à tarefa.`);
    }
  };

  const updateDraftTask = (key: string, updates: DraftTaskEdit) => {
    setDraftTaskEdits((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        ...updates,
      },
    }));
  };

  const removeDraftTask = (key: string) => {
    setRemovedDraftKeys((current) => current.includes(key) ? current : [...current, key]);
  };

  const resetDraftCustomizations = () => {
    setDraftTaskEdits({});
    setRemovedDraftKeys([]);
    showToast('Rascunho restaurado.');
  };

  const applyGeneratedDraft = () => {
    if (nextMetaDraft.tasks.length === 0) {
      showToast('Sem sugestões para enviar ao planner.');
      return;
    }

    const generated = materializeDraftTasks(nextMetaDraft.tasks, {
      planejamento: 'Planner Gerado',
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
    });
    const now = new Date().toISOString();
    const metaNumber = metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined;
    const generatedMeta: PlannerMetaSummary = {
      id: `generated_meta_${Date.now()}`,
      title: metaNumber ? `Rascunho Meta (#${metaNumber})` : 'Rascunho da Próxima Meta',
      planejamento: 'Planner Gerado',
      metaNumber,
      totalTasks: generated.length,
      totalDisciplines: new Set(generated.map((task) => task.discipline)).size,
      completedPercent: 0,
      completedTasks: 0,
      pendingTasks: generated.length,
      ignoredTasks: 0,
      startedTasks: 0,
      importedAt: now,
    };

    setPlannerTasks(generated);
    setMetaSummary(generatedMeta);
    setMetaHistory((current) => {
      const withCurrentMeta = metaSummary && plannerTasks.length > 0
        ? upsertHistoryEntry(current, buildHistoryEntry(metaSummary, plannerTasks))
        : current;

      return upsertHistoryEntry(
        withCurrentMeta,
        buildHistoryEntry(generatedMeta, generated, { origin: 'generated', relatedMetaId: metaSummary?.id }),
      );
    });
    setActiveSection('calendar');
    showToast(`${generated.length} sugestões viraram a meta gerada.`);
  };

  const selectStudyOsTarget = (targetSlug: string) => {
    const target = studyOsTargetProfiles.find((item) => item.slug === targetSlug);
    setStudyOsTarget(targetSlug);
    setStudyOsPhase(target?.phase || 'pre_edital');
    setStudyOsCoverageDraft(formatStudyCoverageTable(seedCoverageForTarget(targetSlug)));
    setStudyOsSourceDraft(formatStudySourceTable(seedSourceSignalsForTarget(targetSlug)));
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
  };

  const saveStudyOsTargetProfiles = () => {
    const parsed = parseStudyTargetProfileTable(studyOsTargetProfileDraft);
    if (parsed.length === 0) {
      showToast('Nenhum perfil de target válido.');
      return;
    }

    const nextTarget = parsed.find((target) => target.slug === studyOsTarget) || parsed.find((target) => target.active) || parsed[0];
    setStudyOsTargetProfiles(parsed);
    setStudyOsTargetProfileDraft(formatStudyTargetProfileTable(parsed));
    setStudyOsTarget(nextTarget.slug);
    setStudyOsPhase(nextTarget.phase);
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast(`${parsed.length} perfil(is) Study OS salvo(s).`);
  };

  const resetStudyOsTargetProfiles = () => {
    const formatted = formatStudyTargetProfileTable(DEFAULT_STUDY_TARGET_PROFILES);
    const nextTarget = defaultStudyOsTarget(DEFAULT_STUDY_TARGET_PROFILES);
    setStudyOsTargetProfiles(DEFAULT_STUDY_TARGET_PROFILES);
    setStudyOsTargetProfileDraft(formatted);
    setStudyOsTarget(nextTarget);
    setStudyOsPhase(DEFAULT_STUDY_TARGET_PROFILES.find((target) => target.slug === nextTarget)?.phase || 'pre_edital');
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast('Perfis base restaurados.');
  };

  const seedStudyOsCoverage = (targetSlug = studyOsTarget) => {
    setStudyOsCoverageDraft(formatStudyCoverageTable(seedCoverageForTarget(targetSlug)));
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast('Cobertura base carregada.');
  };

  const seedStudyOsSources = (targetSlug = studyOsTarget) => {
    setStudyOsSourceDraft(formatStudySourceTable(seedSourceSignalsForTarget(targetSlug)));
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast('Fontes base carregadas.');
  };

  const appendInferredStudyOsSources = () => {
    const inferred = inferStudySourceSignalsFromText(studyOsRawSourceText, {
      targetSlug: studyOsTarget,
      sourceKind: studyOsRawSourceKind === 'auto' ? undefined : studyOsRawSourceKind,
    });
    if (inferred.length === 0) {
      showToast('Não encontrei linhas de fonte reconhecíveis.');
      return;
    }

    const current = parseStudySourceTable(studyOsSourceDraft);
    setStudyOsSourceDraft(formatStudySourceTable([...current, ...inferred]));
    setStudyOsRawSourceText('');
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast(`${inferred.length} fonte(s) normalizada(s).`);
  };

  const generateStudyOsPlan = () => {
    const coverageRows = parseStudyCoverageTable(studyOsCoverageDraft);
    if (coverageRows.length === 0) {
      showToast('Nenhuma cobertura válida para o Study OS.');
      return;
    }

    const plan = buildStudyDayPlan({
      targetSlug: studyOsTarget,
      phase: studyOsPhase,
      coverageRows,
      feedbackRows: buildStudyOsFeedbackRows(loadStoredQuestionBank()),
      sourceItems: studyOsCombinedSourceItems,
      targetProfiles: studyOsTargetProfiles,
    });
    setStudyOsPlan(plan);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(null);
    showToast(`${plan.blocks.length} bloco(s) gerado(s) para hoje.`);
  };

  const generateStudyOsWeekPlan = () => {
    const coverageRows = parseStudyCoverageTable(studyOsCoverageDraft);
    if (coverageRows.length === 0) {
      showToast('Nenhuma cobertura válida para o Study OS.');
      return;
    }

    const plan = buildStudyWeekPlan({
      targetSlug: studyOsTarget,
      phase: studyOsPhase,
      startDate: studyOsWeekStartDate,
      days: 5,
      coverageRows,
      feedbackRows: buildStudyOsFeedbackRows(loadStoredQuestionBank()),
      sourceItems: studyOsCombinedSourceItems,
      targetProfiles: studyOsTargetProfiles,
    });
    setStudyOsPlan(null);
    setStudyOsWeekPlan(plan);
    setStudyOsRefreshPlan(null);
    showToast(`${plan.days.reduce((total, day) => total + day.blocks.length, 0)} bloco(s) gerado(s) para a semana.`);
  };

  const generateStudyOsRefreshPlan = () => {
    const coverageRows = parseStudyCoverageTable(studyOsCoverageDraft);
    const refreshDate = toIsoDate(shiftDate(new Date(), 1));
    const plan = buildStudyRefreshPlan({
      targetSlug: studyOsTarget,
      phase: studyOsPhase,
      refreshDate,
      coverageRows,
      feedbackRows: buildStudyOsFeedbackRows(loadStoredQuestionBank()),
      sourceItems: studyOsCombinedSourceItems,
      targetProfiles: studyOsTargetProfiles,
      previousTasks: activePlannerTasks,
    });
    setStudyOsPlan(null);
    setStudyOsWeekPlan(null);
    setStudyOsRefreshPlan(plan);
    showToast(`${plan.blocks.length} bloco(s) recalculado(s) para amanhã.`);
  };

  const applyStudyOsPlan = () => {
    if (!studyOsPlan || studyOsPlan.blocks.length === 0) {
      showToast('Gere os blocos do Study OS antes de aplicar.');
      return;
    }

    const today = toIsoDate(new Date());
    const generated = materializeStudyBlocksAsPlannerTasks(studyOsPlan.blocks, {
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
      scheduledDate: today,
    });
    const now = new Date().toISOString();
    const generatedMeta: PlannerMetaSummary = {
      id: `study_os_meta_${Date.now()}`,
      title: `Hoje - ${studyOsActiveTarget?.name || studyOsTarget}`,
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
      totalTasks: generated.length,
      totalDisciplines: new Set(generated.map((task) => task.discipline)).size,
      completedPercent: 0,
      completedTasks: 0,
      pendingTasks: generated.length,
      ignoredTasks: 0,
      startedTasks: 0,
      importedAt: now,
    };

    setPlannerTasks(generated);
    setMetaSummary(generatedMeta);
    setMetaHistory((current) => {
      const withCurrentMeta = metaSummary && plannerTasks.length > 0
        ? upsertHistoryEntry(current, buildHistoryEntry(metaSummary, plannerTasks))
        : current;
      return upsertHistoryEntry(
        withCurrentMeta,
        buildHistoryEntry(generatedMeta, generated, { origin: 'generated', relatedMetaId: metaSummary?.id }),
      );
    });
    setMonthDate(new Date());
    setWeekDate(new Date());
    setView('week');
    setActiveSection('calendar');
    showToast(`${generated.length} bloco(s) Study OS viraram tarefas de hoje.`);
  };

  const applyStudyOsRefreshPlan = () => {
    if (!studyOsRefreshPlan || studyOsRefreshPlan.blocks.length === 0) {
      showToast('Gere o refresh do Study OS antes de aplicar.');
      return;
    }

    const generated = materializeStudyBlocksAsPlannerTasks(studyOsRefreshPlan.blocks, {
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
      scheduledDate: studyOsRefreshPlan.date,
    });
    const now = new Date().toISOString();
    const generatedMeta: PlannerMetaSummary = {
      id: `study_os_refresh_${Date.now()}`,
      title: `Refresh - ${studyOsActiveTarget?.name || studyOsTarget}`,
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
      totalTasks: generated.length,
      totalDisciplines: new Set(generated.map((task) => task.discipline)).size,
      completedPercent: 0,
      completedTasks: 0,
      pendingTasks: generated.length,
      ignoredTasks: 0,
      startedTasks: 0,
      importedAt: now,
    };

    setPlannerTasks(generated);
    setMetaSummary(generatedMeta);
    setMetaHistory((current) => {
      const withCurrentMeta = metaSummary && plannerTasks.length > 0
        ? upsertHistoryEntry(current, buildHistoryEntry(metaSummary, plannerTasks))
        : current;
      return upsertHistoryEntry(
        withCurrentMeta,
        buildHistoryEntry(generatedMeta, generated, { origin: 'generated', relatedMetaId: metaSummary?.id }),
      );
    });
    setMonthDate(new Date(`${studyOsRefreshPlan.date}T00:00:00`));
    setWeekDate(new Date(`${studyOsRefreshPlan.date}T00:00:00`));
    setView('week');
    setActiveSection('calendar');
    showToast(`${generated.length} bloco(s) Study OS viraram o refresh de amanhã.`);
  };

  const applyStudyOsWeekPlan = () => {
    if (!studyOsWeekPlan || studyOsWeekPlan.days.length === 0) {
      showToast('Gere a semana do Study OS antes de aplicar.');
      return;
    }

    const generated = materializeStudyWeekAsPlannerTasks(studyOsWeekPlan, {
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
    });
    const now = new Date().toISOString();
    const generatedMeta: PlannerMetaSummary = {
      id: `study_os_week_${Date.now()}`,
      title: `Semana - ${studyOsActiveTarget?.name || studyOsTarget}`,
      planejamento: `Study OS - ${studyOsActiveTarget?.name || studyOsTarget}`,
      metaNumber: metaSummary?.metaNumber ? metaSummary.metaNumber + 1 : undefined,
      totalTasks: generated.length,
      totalDisciplines: new Set(generated.map((task) => task.discipline)).size,
      completedPercent: 0,
      completedTasks: 0,
      pendingTasks: generated.length,
      ignoredTasks: 0,
      startedTasks: 0,
      importedAt: now,
    };

    setPlannerTasks(generated);
    setMetaSummary(generatedMeta);
    setMetaHistory((current) => {
      const withCurrentMeta = metaSummary && plannerTasks.length > 0
        ? upsertHistoryEntry(current, buildHistoryEntry(metaSummary, plannerTasks))
        : current;
      return upsertHistoryEntry(
        withCurrentMeta,
        buildHistoryEntry(generatedMeta, generated, { origin: 'generated', relatedMetaId: metaSummary?.id }),
      );
    });
    setMonthDate(new Date(`${studyOsWeekPlan.startDate}T00:00:00`));
    setWeekDate(new Date(`${studyOsWeekPlan.startDate}T00:00:00`));
    setView('week');
    setActiveSection('calendar');
    showToast(`${generated.length} bloco(s) Study OS viraram a semana atual.`);
  };

  const onDropTask = (date: string, time?: string) => {
    if (!draggingTaskId) return;
    scheduleTask(draggingTaskId, date, time);
    setDraggingTaskId(null);
  };

  const renderTaskCard = (task: PlannerTask, compact = false) => (
    <div
      key={task.id}
      role="button"
      tabIndex={0}
      draggable
      onClick={() => setSelectedTaskId(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelectedTaskId(task.id);
        }
      }}
      onDragStart={() => setDraggingTaskId(task.id)}
      onDragEnd={() => setDraggingTaskId(null)}
      className={`group rounded-lg border p-2 text-left shadow-sm transition-all hover:border-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/60 ${
        draggingTaskId === task.id ? 'cursor-grabbing' : 'cursor-pointer'
      } ${statusClass[task.status]} ${
        compact ? 'space-y-1' : 'space-y-2'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-white/60">
            {task.number} - {task.discipline}
          </p>
          <p className={`${compact ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2'} font-bold text-white`}>
            {task.description}
          </p>
        </div>
        <GripVertical className="w-4 h-4 flex-shrink-0 text-white/30" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-widest">
        <span className="rounded bg-black/20 px-2 py-0.5 text-white/70">Rel {task.relevance}</span>
        <span className="rounded bg-black/20 px-2 py-0.5 text-white/70">{formatMinutes(task.durationMinutes)}</span>
        {task.startTime && <span className="rounded bg-black/20 px-2 py-0.5 text-white/70">{task.startTime}</span>}
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
          <span className="text-[10px] font-bold text-white/50">{statusLabel[task.status]}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                createOrOpenStudyTask(task);
              }}
              className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-white hover:bg-white/20"
            >
              Executar
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                archivePlannerTask(task.id);
              }}
              className="rounded bg-yellow-400/10 px-2 py-1 text-[10px] font-black uppercase text-yellow-300 hover:bg-yellow-400/20"
            >
              Arquivar
            </button>
            {task.scheduledDate && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  clearSchedule(task.id);
                }}
                className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20"
              >
                Soltar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const renderMonthTaskItem = (task: PlannerTask) => (
    <button
      key={task.id}
      type="button"
      draggable
      onClick={() => setSelectedTaskId(task.id)}
      onDragStart={() => setDraggingTaskId(task.id)}
      onDragEnd={() => setDraggingTaskId(null)}
      className={`w-full rounded border px-2 py-1.5 text-left text-[11px] shadow-sm transition hover:border-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500/60 ${statusClass[task.status]}`}
      title={`${task.number} - ${task.discipline}: ${task.description}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-black text-white">
          {task.startTime ? `${task.startTime} · ` : ''}{task.number} - {task.discipline}
        </span>
        <span className="shrink-0 rounded bg-black/20 px-1.5 py-0.5 text-[9px] font-black text-white/70">
          {formatMinutes(task.durationMinutes)}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 font-bold leading-snug text-white/85">{task.description}</p>
    </button>
  );

  const renderTodayTaskCard = (task: PlannerTask, isNext = false) => (
    <div
      key={task.id}
      role="button"
      tabIndex={0}
      onClick={() => setSelectedTaskId(task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelectedTaskId(task.id);
        }
      }}
      className={`rounded-lg border p-4 text-left transition hover:border-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/60 ${statusClass[task.status]} ${
        isNext ? 'ring-2 ring-[#84cc16]/50' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest">
            {isNext && <span className="rounded bg-[#84cc16] px-2 py-1 text-black">Próxima</span>}
            <span className="rounded bg-black/25 px-2 py-1 text-white/70">{task.startTime || 'Sem horário'}</span>
            <span className="rounded bg-black/25 px-2 py-1 text-white/70">{statusLabel[task.status]}</span>
            <span className="rounded bg-black/25 px-2 py-1 text-white/70">{formatMinutes(task.durationMinutes)}</span>
            {task.targetSlug && <span className="rounded bg-black/25 px-2 py-1 text-white/70">{task.targetSlug}</span>}
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-white/55">{task.number} - {task.discipline}</p>
          <h3 className="mt-1 text-lg font-black leading-tight text-white">{task.description}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/60">
            <span className="rounded bg-black/20 px-2 py-1">Rel {task.relevance}</span>
            <span className="rounded bg-black/20 px-2 py-1">{task.plannedBlockKind ? plannedBlockKindLabel[task.plannedBlockKind] : task.format}</span>
            {task.plannedQuestions && <span className="rounded bg-black/20 px-2 py-1">{task.plannedQuestions} questões</span>}
            {task.scoreBreakdown && <span className="rounded bg-black/20 px-2 py-1">Score {task.scoreBreakdown.finalScore}</span>}
            <span className="rounded bg-black/20 px-2 py-1">{task.performance === null ? 'Sem desempenho' : `${task.performance}%`}</span>
          </div>
          {task.sourceReason && task.sourceReason.length > 0 && (
            <p className="mt-3 line-clamp-2 text-xs font-bold leading-relaxed text-white/65">
              {task.sourceReason.slice(0, 2).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              createOrOpenStudyTask(task);
            }}
            className="rounded bg-[#84cc16] px-3 py-2 text-[10px] font-black uppercase text-black transition hover:bg-[#65a30d]"
          >
            Executar
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void copyPlannerTaskChatPrompt(task);
            }}
            className="rounded border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-[10px] font-black uppercase text-purple-100 transition hover:bg-purple-500/20"
          >
            Prompt IA
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-purple-400">Metas de Estudo</p>
          <h1 className="text-3xl font-black text-white">Planner</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Meta atual, backlog e calendário no mesmo fluxo: importe a meta, distribua no mês e refine a semana por horário.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={autoOrganize}
            disabled={plannerTasks.length === 0}
            className="flex items-center gap-2 rounded bg-[#84cc16] px-4 py-3 text-sm font-black text-black shadow-lg shadow-black/20 transition hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles className="w-4 h-4" /> Auto-organizar
          </button>
          <button
            type="button"
            onClick={() => {
              setPlannerTasks([]);
              setMetaSummary(null);
              showToast('Planner limpo.');
            }}
            className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10"
          >
            <RotateCcw className="w-4 h-4" /> Limpar
          </button>
        </div>
      </header>

      <section className="rounded-lg border border-[#404040] bg-[#262626] p-2">
        <div className="flex gap-2 overflow-x-auto">
          {SECTION_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex min-w-max items-center gap-2 rounded px-3 py-2 text-xs font-black uppercase tracking-widest transition ${
                  activeSection === item.id
                    ? 'bg-purple-600 text-white shadow-lg shadow-black/20'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {activeSection === 'today' && (
        <section className="space-y-4">
          <div className="rounded-lg border border-[#404040] bg-[#262626] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-[#84cc16]">Painel de Hoje</p>
                <h2 className="mt-1 text-2xl font-black text-white">{formatPlannerDate(todayCommandCenter.date)}</h2>
                <p className="mt-1 text-sm font-bold text-gray-400">
                  {studyOsActiveTarget?.name || studyOsTarget} · {studyOsPhase === 'pos_edital' ? 'Pós-edital' : 'Pré-edital'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection('generator')}
                  className="flex items-center gap-2 rounded border border-purple-400/30 bg-purple-500/10 px-4 py-2 text-xs font-black uppercase text-purple-100 transition hover:bg-purple-500/20"
                >
                  <Sparkles className="h-4 w-4" /> Study OS
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('calendar')}
                  className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase text-gray-100 transition hover:bg-white/10"
                >
                  <CalendarDays className="h-4 w-4" /> Calendário
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric icon={ClipboardList} label="Blocos" value={`${todayCommandCenter.visibleTasks}/${Math.max(4, todayCommandCenter.totalTasks)}`} />
              <Metric icon={Target} label="Abertos" value={`${todayCommandCenter.openTasks}`} />
              <Metric icon={CheckCircle2} label="Concluídos" value={`${todayCommandCenter.completedTasks}`} />
              <Metric icon={Timer} label="Tempo" value={formatMinutes(todayCommandCenter.totalMinutes)} />
            </div>

            {todayCommandCenter.nextTask && (
              <div className="mt-5 rounded-lg border border-[#84cc16]/25 bg-[#84cc16]/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#bef264]">Próximo bloco</p>
                    <p className="mt-1 truncate text-lg font-black text-white">
                      {todayCommandCenter.nextTask.startTime ? `${todayCommandCenter.nextTask.startTime} · ` : ''}
                      {todayCommandCenter.nextTask.discipline} - {todayCommandCenter.nextTask.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTaskId(todayCommandCenter.nextTask?.id || null)}
                    className="rounded bg-[#84cc16] px-4 py-2 text-xs font-black uppercase text-black transition hover:bg-[#65a30d]"
                  >
                    Abrir
                  </button>
                </div>
              </div>
            )}
          </div>

          {todayCommandCenter.tasks.length > 0 ? (
            <div className="grid gap-3">
              {todayCommandCenter.tasks.map((task) => renderTodayTaskCard(task, task.id === todayCommandCenter.nextTask?.id))}
              {todayCommandCenter.overflowCount > 0 && (
                <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 px-4 py-3 text-sm font-black text-yellow-200">
                  +{todayCommandCenter.overflowCount} bloco(s) além da cota normal de hoje.
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 bg-[#1a1a1a] p-8 text-center">
              <CalendarDays className="mx-auto mb-3 h-8 w-8 text-gray-500" />
              <p className="text-lg font-black text-white">Sem blocos hoje</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection('generator')}
                  className="rounded bg-purple-600 px-4 py-2 text-xs font-black uppercase text-white transition hover:bg-purple-500"
                >
                  Gerar Study OS
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSection('calendar')}
                  className="rounded border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase text-gray-100 transition hover:bg-white/10"
                >
                  Calendário
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeSection === 'meta' && (
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="rounded-lg border border-[#404040] bg-[#262626] p-5 xl:col-span-3">
          <div className="mb-4 flex items-center gap-2">
            <LayoutDashboard className="h-5 w-5 text-[#84cc16]" />
            <h2 className="text-lg font-black text-white">Meta Atual</h2>
          </div>
          {metaSummary ? (
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-purple-400">
                  {metaSummary.planejamento || 'Planejamento'}
                </p>
                <h3 className="text-2xl font-black text-white">{metaSummary.title}</h3>
                <p className="text-xs font-bold text-gray-500">
                  Iniciada: {metaSummary.startedAt || '-'} · Próxima: {metaSummary.nextMetaAt || '-'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
                <Metric icon={ClipboardList} label="Tarefas" value={`${metaSummary.totalTasks || stats.total}`} />
                <Metric icon={CheckCircle2} label="Concluídas" value={`${metaSummary.completedTasks || stats.completed}`} />
                <Metric icon={Target} label="Pendentes" value={`${metaSummary.pendingTasks || stats.pending}`} />
                <Metric icon={Timer} label="Planejado" value={formatMinutes(stats.scheduledMinutes)} />
                <Metric icon={Archive} label="Arquivadas" value={`${stats.archived}`} />
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/30">
                <div
                  className="h-full rounded-full bg-[#84cc16]"
                  style={{ width: `${Math.min(100, metaSummary.completedPercent || (stats.total ? (stats.completed / stats.total) * 100 : 0))}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="rounded border border-dashed border-white/10 bg-[#1a1a1a] p-5 text-sm text-gray-400">
              Importe o texto ou PDF da Meta Atual da LS para preencher o resumo e o backlog.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[#404040] bg-[#262626] p-5 xl:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <FileUp className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-black text-white">Importar Meta</h2>
          </div>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Cole aqui a tabela da Meta Atual ou texto extraído da LS..."
            className="h-32 w-full resize-none rounded border border-[#525252] bg-[#404040] p-3 text-sm text-white outline-none transition focus:border-purple-500"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-gray-200 transition hover:bg-white/10">
              {isReadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              PDF
              <input type="file" accept="application/pdf,.pdf" onChange={handlePdfImport} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => importMetaText(importText, 'ls-meta-text')}
              disabled={!importText.trim()}
              className="flex items-center gap-2 rounded bg-purple-600 px-4 py-2 text-xs font-black uppercase text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Importar Texto
            </button>
          </div>
        </div>
      </section>
      )}

      {activeSection === 'calendar' && (
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
            <div className="mb-4 flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-[#84cc16]" />
              <h2 className="text-base font-black text-white">Backlog</h2>
              <span className="ml-auto rounded bg-black/30 px-2 py-1 text-[10px] font-black text-gray-400">{unscheduledTasks.length}</span>
            </div>
            <div className="grid gap-3">
              <select
                value={disciplineFilter}
                onChange={(event) => setDisciplineFilter(event.target.value)}
                className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
              >
                <option value="">Todas as disciplinas</option>
                {disciplines.map((discipline) => (
                  <option key={discipline} value={discipline}>{discipline}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs font-bold text-gray-400">
                <input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />
                Ocultar concluídas
              </label>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <NumberField label="Tarefas/dia" value={maxTasksPerDay} onChange={setMaxTasksPerDay} />
                <NumberField label="Horas/dia" value={maxHoursPerDay} onChange={setMaxHoursPerDay} />
              </div>
              <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
                Início padrão
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className="rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                />
              </label>
            </div>
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingTaskId) clearSchedule(draggingTaskId);
              setDraggingTaskId(null);
            }}
            className="max-h-[640px] space-y-3 overflow-y-auto rounded-lg border border-dashed border-white/10 bg-[#1a1a1a] p-3"
          >
            {unscheduledTasks.length > 0 ? (
              unscheduledTasks.map((task) => renderTaskCard(task))
            ) : (
              <p className="p-4 text-center text-sm font-bold text-gray-500">Sem tarefas soltas.</p>
            )}
          </div>
        </aside>

        <main className="rounded-lg border border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 rounded-xl bg-[#1a1a1a] p-1">
              <button
                type="button"
                onClick={() => setView('month')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black uppercase tracking-widest transition ${
                  view === 'month' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <CalendarDays className="h-4 w-4" /> Mês
              </button>
              <button
                type="button"
                onClick={() => setView('week')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-black uppercase tracking-widest transition ${
                  view === 'week' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <CalendarRange className="h-4 w-4" /> Semana
              </button>
            </div>
            {view === 'month' ? (
              <CalendarNav
                label={monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                onPrev={() => setMonthDate((current) => shiftMonth(current, -1))}
                onNext={() => setMonthDate((current) => shiftMonth(current, 1))}
              />
            ) : (
              <CalendarNav
                label={`Semana de ${weekStartLabel}`}
                onPrev={() => setWeekDate((current) => shiftWeek(current, -1))}
                onNext={() => setWeekDate((current) => shiftWeek(current, 1))}
              />
            )}
          </div>

          {view === 'month' ? (
            <div className="grid grid-cols-7 gap-2">
              {WEEKDAYS.map((day) => (
                <div key={day} className="px-2 py-1 text-center text-[10px] font-black uppercase tracking-widest text-gray-500">{day}</div>
              ))}
              {monthDays.map((day) => {
                const tasksForDay = groupedByDate[day.date] || [];
                return (
                  <div
                    key={day.date}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onDropTask(day.date)}
                    className={`min-h-[190px] rounded-lg border p-2 transition ${
                      day.isCurrentMonth ? 'border-white/10 bg-[#1a1a1a]' : 'border-white/5 bg-[#1a1a1a]/40 opacity-50'
                    } ${day.isToday ? 'ring-2 ring-[#84cc16]/50' : ''}`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`text-xs font-black ${day.isCurrentMonth ? 'text-white' : 'text-gray-600'}`}>{day.dayNumber}</span>
                      {tasksForDay.length > 0 && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-black text-gray-400">
                          {formatMinutes(tasksForDay.reduce((sum, task) => sum + task.durationMinutes, 0))}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {tasksForDay
                        .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.number - b.number)
                        .map((task) => renderMonthTaskItem(task))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[72px_repeat(7,minmax(120px,1fr))] gap-1">
                  <div />
                  {weekDays.map((day) => (
                    <div key={day.date} className="rounded bg-[#1a1a1a] px-3 py-2 text-center">
                      <p className="text-[10px] font-black uppercase tracking-widest text-purple-400">{day.label}</p>
                      <p className="text-lg font-black text-white">{day.dayNumber}</p>
                    </div>
                  ))}
                  {HOUR_SLOTS.map((slot) => (
                    <React.Fragment key={slot}>
                      <div className="sticky left-0 z-10 flex h-24 items-start justify-end bg-[#262626] pr-2 pt-2 text-[11px] font-black text-gray-500">
                        {slot}
                      </div>
                      {weekDays.map((day) => {
                        const tasksForSlot = (groupedByDate[day.date] || []).filter((task) => (task.startTime || '').startsWith(slot.slice(0, 2)));
                        return (
                          <div
                            key={`${day.date}-${slot}`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => onDropTask(day.date, slot)}
                            className="min-h-24 rounded border border-white/5 bg-[#1a1a1a] p-2 transition hover:border-purple-500/40"
                          >
                            <div className="space-y-2">
                              {tasksForSlot.map((task) => renderTaskCard(task, true))}
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </section>
      )}

      {selectedTask && (
        <PlannerTaskDetailModal
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onExecute={() => createOrOpenStudyTask(selectedTask)}
          onCopyChatPrompt={() => copyPlannerTaskChatPrompt(selectedTask)}
          onApplyResult={(result) => applyTaskResult(selectedTask.id, result)}
          onClearSchedule={() => clearSchedule(selectedTask.id)}
          onArchive={() => {
            archivePlannerTask(selectedTask.id);
            setSelectedTaskId(null);
          }}
        />
      )}

      {activeSection === 'insights' && (
        <PlannerInsightsPanel insights={plannerInsights} />
      )}

      {activeSection === 'generator' && (
        <div className="space-y-5">
          <StudyOSPlannerPanel
            targetProfiles={studyOsTargetProfiles}
            activeTarget={studyOsActiveTarget}
            targetSlug={studyOsTarget}
            phase={studyOsPhase}
            coverageDraft={studyOsCoverageDraft}
            targetProfileDraft={studyOsTargetProfileDraft}
            sourceDraft={studyOsSourceDraft}
            rawSourceText={studyOsRawSourceText}
            rawSourceKind={studyOsRawSourceKind}
            sourceItemCount={studyOsManualSourceItems.length}
            targetDecisionRows={studyOsTargetDecisionRows}
            plan={studyOsPlan}
            weekPlan={studyOsWeekPlan}
            refreshPlan={studyOsRefreshPlan}
            weekStartDate={studyOsWeekStartDate}
            onTargetChange={selectStudyOsTarget}
            onPhaseChange={(phase) => {
              setStudyOsPhase(phase);
              setStudyOsPlan(null);
              setStudyOsWeekPlan(null);
              setStudyOsRefreshPlan(null);
            }}
            onCoverageDraftChange={(value) => {
              setStudyOsCoverageDraft(value);
              setStudyOsPlan(null);
              setStudyOsWeekPlan(null);
              setStudyOsRefreshPlan(null);
            }}
            onTargetProfileDraftChange={setStudyOsTargetProfileDraft}
            onSourceDraftChange={(value) => {
              setStudyOsSourceDraft(value);
              setStudyOsPlan(null);
              setStudyOsWeekPlan(null);
              setStudyOsRefreshPlan(null);
            }}
            onRawSourceTextChange={setStudyOsRawSourceText}
            onRawSourceKindChange={setStudyOsRawSourceKind}
            onAppendInferredSources={appendInferredStudyOsSources}
            onSaveTargetProfiles={saveStudyOsTargetProfiles}
            onResetTargetProfiles={resetStudyOsTargetProfiles}
            onSeedCoverage={seedStudyOsCoverage}
            onSeedSources={seedStudyOsSources}
            onGenerate={generateStudyOsPlan}
            onApply={applyStudyOsPlan}
            onGenerateWeek={generateStudyOsWeekPlan}
            onApplyWeek={applyStudyOsWeekPlan}
            onGenerateRefresh={generateStudyOsRefreshPlan}
            onApplyRefresh={applyStudyOsRefreshPlan}
          />
          <PlannerGeneratorPanel
            draft={nextMetaDraft}
            draftItems={draftItems}
            weeklyHours={draftWeeklyHours}
            maxTasks={draftMaxTasks}
            onWeeklyHoursChange={setDraftWeeklyHours}
            onMaxTasksChange={setDraftMaxTasks}
            onUpdateTask={updateDraftTask}
            onRemoveTask={removeDraftTask}
            onResetDraft={resetDraftCustomizations}
            hasCustomDraft={hasDraftCustomizations}
            onApply={applyGeneratedDraft}
          />
        </div>
      )}

      {activeSection === 'history' && (
        <MetaHistoryPanel
          history={metaHistory}
          currentMetaId={metaSummary?.id}
          onRestore={restoreHistoryEntry}
        />
      )}

      {activeSection === 'maps' && (
        <PlannerMapsPanel
          tasks={activePlannerTasks}
          history={metaHistory}
          questionBankItems={questionBankItems}
        />
      )}

      {activeSection === 'list' && (
        <TaskTable
          title="Lista de Tarefas"
          icon={Table2}
          tasks={visibleListTasks}
          onExecute={createOrOpenStudyTask}
          onClearSchedule={clearSchedule}
          onArchive={archivePlannerTask}
          onRestore={restorePlannerTask}
        />
      )}

      {activeSection === 'discipline' && (
        <section className="space-y-4">
          {tasksByDiscipline.length > 0 ? (
            tasksByDiscipline.map((group) => (
              <div key={group.discipline} className="rounded-lg border border-[#404040] bg-[#262626] p-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Layers className="h-5 w-5 text-[#84cc16]" />
                  <h2 className="text-lg font-black text-white">{group.discipline}</h2>
                  <span className="rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {group.total} tarefas
                  </span>
                  <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-300">
                    Rel média {group.relevance}
                  </span>
                  <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                    {formatMinutes(group.minutes)}
                  </span>
                </div>
                <TaskRows
                  tasks={group.tasks}
                  onExecute={createOrOpenStudyTask}
                  onClearSchedule={clearSchedule}
                  onArchive={archivePlannerTask}
                  onRestore={restorePlannerTask}
                />
              </div>
            ))
          ) : (
            <EmptyPanel icon={Layers} title="Nenhuma disciplina importada" />
          )}
        </section>
      )}

      {activeSection === 'pending' && (
        <TaskTable
          title="Tarefas Pendentes"
          icon={Target}
          tasks={visibleListTasks}
          onExecute={createOrOpenStudyTask}
          onClearSchedule={clearSchedule}
          onArchive={archivePlannerTask}
          onRestore={restorePlannerTask}
        />
      )}

      {activeSection === 'ignored' && (
        <TaskTable
          title="Tarefas Ignoradas"
          icon={Ban}
          tasks={visibleListTasks}
          onExecute={createOrOpenStudyTask}
          onClearSchedule={clearSchedule}
          onArchive={archivePlannerTask}
          onRestore={restorePlannerTask}
        />
      )}

      {activeSection === 'archived' && (
        <TaskTable
          title="Tarefas Arquivadas"
          icon={Archive}
          tasks={visibleListTasks}
          onExecute={createOrOpenStudyTask}
          onClearSchedule={clearSchedule}
          onArchive={archivePlannerTask}
          onRestore={restorePlannerTask}
        />
      )}
    </div>
  );
};

const Metric: React.FC<{ icon: React.ElementType; label: string; value: string }> = ({ icon: Icon, label, value }) => (
  <div className="rounded border border-white/5 bg-[#1a1a1a] p-3">
    <Icon className="mb-2 h-4 w-4 text-purple-400" />
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
    <p className="text-xl font-black text-white">{value}</p>
  </div>
);

const NumberField: React.FC<{ label: string; value: number; onChange: (value: number) => void }> = ({ label, value, onChange }) => (
  <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
    {label}
    <input
      type="number"
      min={1}
      value={value}
      onChange={(event) => onChange(Math.max(1, Number(event.target.value) || 1))}
      className="min-w-0 rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
    />
  </label>
);

const clampInputValue = (value: number, min: number, max: number) => {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Math.round(safeValue)));
};

const ResultNumberField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, onChange }) => (
  <label className="grid min-w-0 gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
    {label}
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(clampInputValue(Number(event.target.value), min, max))}
      className="min-w-0 rounded border border-[#525252] bg-[#404040] px-3 py-2 text-sm font-black text-white outline-none focus:border-purple-500"
    />
  </label>
);

const CalendarNav: React.FC<{ label: string; onPrev: () => void; onNext: () => void }> = ({ label, onPrev, onNext }) => (
  <div className="flex items-center gap-2">
    <button type="button" onClick={onPrev} title="Anterior" className="rounded bg-white/5 px-3 py-2 text-sm font-black text-white hover:bg-white/10">
      <ChevronLeft className="h-4 w-4" />
    </button>
    <span className="min-w-48 text-center text-sm font-black uppercase tracking-widest text-white">{label}</span>
    <button type="button" onClick={onNext} title="Próximo" className="rounded bg-white/5 px-3 py-2 text-sm font-black text-white hover:bg-white/10">
      <ChevronRight className="h-4 w-4" />
    </button>
  </div>
);

const formatPlannerDate = (value: string | undefined) => {
  if (!value) return '-';
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

const PlannerTaskDetailModal: React.FC<{
  task: PlannerTask;
  onClose: () => void;
  onExecute: () => void;
  onCopyChatPrompt: () => void;
  onApplyResult: (result: PlannerTaskResultInput) => void;
  onClearSchedule: () => void;
  onArchive: () => void;
}> = ({ task, onClose, onExecute, onCopyChatPrompt, onApplyResult, onClearSchedule, onArchive }) => {
  const [draftPerformance, setDraftPerformance] = useState(task.performance ?? 70);
  const [draftMinutes, setDraftMinutes] = useState(task.spentMinutes || task.durationMinutes || 60);

  useEffect(() => {
    setDraftPerformance(task.performance ?? 70);
    setDraftMinutes(task.spentMinutes || task.durationMinutes || 60);
  }, [task.id, task.performance, task.spentMinutes, task.durationMinutes]);

  const submitResult = (outcome: PlannerTaskResultInput['outcome']) => {
    if (outcome === 'started') {
      onApplyResult({ outcome });
      return;
    }
    if (outcome === 'skipped') {
      onApplyResult({ outcome, spentMinutes: draftMinutes });
      return;
    }
    onApplyResult({ outcome, performance: draftPerformance, spentMinutes: draftMinutes });
  };
  const visibleDetails = task.plannerSourceKind === 'generated_planner'
    ? task.details
      ?.split('\n')
      .filter((line) => !/^\s*(Target|Fonte|Score)\s*:/i.test(line))
      .join('\n')
      .trim()
    : task.details;

  return (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div
      className="flex flex-col rounded-2xl border border-[#525252] bg-[#262626] shadow-2xl"
      style={createPlannerTaskModalStyle()}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.25em] text-purple-400">
            Tarefa {task.number} - {task.discipline}
          </p>
          <h2 className="mt-1 text-xl font-black leading-tight text-white md:text-2xl">{task.description}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/10 bg-white/5 px-3 py-2 text-xs font-black uppercase text-gray-200 transition hover:bg-white/10"
        >
          Fechar
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_340px]">
          <section className="min-h-0 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric icon={CalendarDays} label="Data" value={formatPlannerDate(task.scheduledDate)} />
              <Metric icon={Timer} label="Horário" value={task.startTime || '-'} />
              <Metric icon={ClockIcon} label="Duração" value={formatMinutes(task.durationMinutes)} />
              <Metric icon={Target} label="Rel." value={`${task.relevance}`} />
            </div>

            <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Descrição</p>
              <p className="whitespace-pre-wrap text-sm font-bold leading-relaxed text-white">{task.description}</p>
            </div>

            {task.plannerSourceKind === 'generated_planner' && (
              <div className="rounded-xl border border-[#84cc16]/20 bg-[#84cc16]/5 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="mr-auto text-[10px] font-black uppercase tracking-widest text-[#bef264]">Por que entrou no plano</p>
                  {task.targetSlug && <span className="rounded bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white/70">{task.targetSlug}</span>}
                  {task.plannedBlockKind && <span className="rounded bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white/70">{plannedBlockKindLabel[task.plannedBlockKind]}</span>}
                  {task.plannedQuestions && <span className="rounded bg-black/25 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white/70">{task.plannedQuestions} questões</span>}
                  {task.scoreBreakdown && <span className="rounded bg-[#84cc16]/15 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#bef264]">Score {task.scoreBreakdown.finalScore}</span>}
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Fonte</p>
                    <p className="mt-1 text-sm font-bold text-white">{task.materialHint || 'Study OS'}</p>
                    {task.sourceReason && task.sourceReason.length > 0 && (
                      <ul className="mt-3 space-y-1 text-sm font-semibold leading-relaxed text-gray-200">
                        {task.sourceReason.slice(0, 4).map((reason) => (
                          <li key={reason}>- {reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {task.scoreBreakdown && (
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
                      <span className="rounded bg-black/20 px-2 py-1">Fraq. {task.scoreBreakdown.weakness}</span>
                      <span className="rounded bg-black/20 px-2 py-1">Inc. {task.scoreBreakdown.incidence}</span>
                      <span className="rounded bg-black/20 px-2 py-1">Peso {task.scoreBreakdown.tier}</span>
                      <span className="rounded bg-black/20 px-2 py-1">Cob. {task.scoreBreakdown.coverageNeed}</span>
                      <span className="rounded bg-black/20 px-2 py-1">Rev. {task.scoreBreakdown.reviewDebt}</span>
                      <span className="rounded bg-black/20 px-2 py-1">Banca {task.scoreBreakdown.bancaFit}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {visibleDetails && (
              <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Atividades e instruções</p>
                <p className="max-h-[28vh] overflow-y-auto whitespace-pre-wrap pr-2 text-sm font-semibold leading-relaxed text-gray-200 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {visibleDetails}
                </p>
              </div>
            )}

            {task.tips && (
              <div className="rounded-xl border border-purple-400/20 bg-purple-500/5 p-4">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-purple-200">Dicas e Bizus</p>
                <p className="max-h-[28vh] overflow-y-auto whitespace-pre-wrap pr-2 text-sm font-semibold leading-relaxed text-gray-100 scrollbar-thin scrollbar-thumb-purple-400/20 scrollbar-track-transparent">
                  {task.tips}
                </p>
              </div>
            )}
          </section>

          <aside className="space-y-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Resumo</p>
            <div className="grid gap-3 text-sm text-gray-300">
              <p><span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Status</span>{statusLabel[task.status]}</p>
              <p><span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Formato</span>{task.format || '-'}</p>
              <p><span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Planejamento</span>{task.planejamento || '-'}</p>
              <p><span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Meta</span>{task.metaNumber || '-'}</p>
              <p><span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Desempenho</span>{task.performance === null ? '-' : `${task.performance}%`}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#262626] p-3">
              <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-gray-500">Resultado</p>
              <div className="grid grid-cols-2 gap-2">
                <ResultNumberField
                  label="Desemp. %"
                  value={draftPerformance}
                  min={0}
                  max={100}
                  onChange={setDraftPerformance}
                />
                <ResultNumberField
                  label="Minutos"
                  value={draftMinutes}
                  min={0}
                  max={240}
                  onChange={setDraftMinutes}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => submitResult('started')}
                  className="flex items-center justify-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-[10px] font-black uppercase text-blue-200 transition hover:bg-blue-500/20"
                >
                  <Play className="h-3.5 w-3.5" /> Iniciar
                </button>
                <button
                  type="button"
                  onClick={() => submitResult('completed')}
                  className="flex items-center justify-center gap-2 rounded border border-[#84cc16]/30 bg-[#84cc16]/15 px-3 py-2 text-[10px] font-black uppercase text-[#bef264] transition hover:bg-[#84cc16]/25"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Concluir
                </button>
                <button
                  type="button"
                  onClick={() => submitResult('failed')}
                  className="flex items-center justify-center gap-2 rounded border border-orange-400/20 bg-orange-500/10 px-3 py-2 text-[10px] font-black uppercase text-orange-200 transition hover:bg-orange-500/20"
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Falhei
                </button>
                <button
                  type="button"
                  onClick={() => submitResult('skipped')}
                  className="flex items-center justify-center gap-2 rounded border border-red-400/20 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-200 transition hover:bg-red-500/20"
                >
                  <Ban className="h-3.5 w-3.5" /> Pular
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 rounded-b-2xl border-t border-white/10 bg-[#1a1a1a] p-5">
        {task.scheduledDate && (
          <button
            type="button"
            onClick={onClearSchedule}
            className="rounded border border-red-400/20 bg-red-500/10 px-4 py-2 text-xs font-black uppercase text-red-300 transition hover:bg-red-500/20"
          >
            Soltar
          </button>
          )}
        <button
          type="button"
          onClick={onArchive}
          className="rounded border border-yellow-400/20 bg-yellow-400/10 px-4 py-2 text-xs font-black uppercase text-yellow-300 transition hover:bg-yellow-400/20"
        >
          Arquivar
        </button>
        <button
          type="button"
          onClick={onCopyChatPrompt}
          className="flex items-center gap-2 rounded border border-purple-400/30 bg-purple-500/10 px-4 py-2 text-xs font-black uppercase text-purple-200 transition hover:bg-purple-500/20"
        >
          <Sparkles className="h-4 w-4" /> Prompt IA
        </button>
        <button
          type="button"
          onClick={onExecute}
          className="rounded bg-[#84cc16] px-4 py-2 text-xs font-black uppercase text-black transition hover:bg-[#65a30d]"
        >
          Executar
        </button>
      </div>
    </div>
  </div>
  );
};

const TaskTable: React.FC<{
  title: string;
  icon: React.ElementType;
  tasks: PlannerTask[];
  onExecute: (task: PlannerTask) => void;
  onClearSchedule: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onRestore: (taskId: string) => void;
}> = ({ title, icon: Icon, tasks, onExecute, onClearSchedule, onArchive, onRestore }) => (
  <section className="rounded-lg border border-[#404040] bg-[#262626] p-4">
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-5 w-5 text-[#84cc16]" />
      <h2 className="text-lg font-black text-white">{title}</h2>
      <span className="ml-auto rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
        {tasks.length}
      </span>
    </div>
    {tasks.length > 0 ? (
      <TaskRows
        tasks={tasks}
        onExecute={onExecute}
        onClearSchedule={onClearSchedule}
        onArchive={onArchive}
        onRestore={onRestore}
      />
    ) : (
      <EmptyPanel icon={Icon} title="Nenhuma tarefa nesta visão" />
    )}
  </section>
);

const TaskRows: React.FC<{
  tasks: PlannerTask[];
  onExecute: (task: PlannerTask) => void;
  onClearSchedule: (taskId: string) => void;
  onArchive: (taskId: string) => void;
  onRestore: (taskId: string) => void;
}> = ({ tasks, onExecute, onClearSchedule, onArchive, onRestore }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[880px] border-collapse text-left">
      <thead>
        <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
          <th className="px-3 py-3">Nº</th>
          <th className="px-3 py-3">Disciplina</th>
          <th className="px-3 py-3">Formato</th>
          <th className="px-3 py-3">Descrição</th>
          <th className="px-3 py-3">Tempo</th>
          <th className="px-3 py-3">Desemp.</th>
          <th className="px-3 py-3">Status</th>
          <th className="px-3 py-3">Rel.</th>
          <th className="px-3 py-3">Agenda</th>
          <th className="px-3 py-3 text-right">Ação</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id} className="border-b border-white/5 text-sm text-gray-300 transition hover:bg-white/[0.03]">
            <td className="px-3 py-3 font-black text-white">{task.number}</td>
            <td className="px-3 py-3 font-bold text-white">{task.discipline}</td>
            <td className="px-3 py-3 text-gray-400">{task.format}</td>
            <td className="max-w-sm px-3 py-3 text-gray-300">
              <span className="line-clamp-2">{task.description}</span>
            </td>
            <td className="px-3 py-3 font-bold text-gray-300">{formatMinutes(task.durationMinutes)}</td>
            <td className="px-3 py-3 font-bold text-gray-300">{task.performance ?? 0}%</td>
            <td className="px-3 py-3">
              <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass[task.status]}`}>
                {statusLabel[task.status]}
              </span>
            </td>
            <td className="px-3 py-3 font-black text-purple-300">{task.relevance}</td>
            <td className="px-3 py-3 text-xs font-bold text-gray-400">
              {task.scheduledDate ? `${task.scheduledDate}${task.startTime ? ` ${task.startTime}` : ''}` : '-'}
            </td>
            <td className="px-3 py-3">
              <div className="flex justify-end gap-2">
                {task.scheduledDate && task.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() => onClearSchedule(task.id)}
                    className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20"
                  >
                    Soltar
                  </button>
                )}
                {task.status === 'archived' ? (
                  <button
                    type="button"
                    onClick={() => onRestore(task.id)}
                    className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase text-[#84cc16] hover:bg-[#84cc16]/20"
                  >
                    Restaurar
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onArchive(task.id)}
                      className="rounded bg-yellow-400/10 px-2 py-1 text-[10px] font-black uppercase text-yellow-300 hover:bg-yellow-400/20"
                    >
                      Arquivar
                    </button>
                    <button
                      type="button"
                      onClick={() => onExecute(task)}
                      className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-white hover:bg-white/20"
                    >
                      Executar
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EmptyPanel: React.FC<{ icon: React.ElementType; title: string }> = ({ icon: Icon, title }) => (
  <div className="rounded border border-dashed border-white/10 bg-[#1a1a1a] p-8 text-center">
    <Icon className="mx-auto mb-3 h-6 w-6 text-gray-600" />
    <p className="text-sm font-bold text-gray-500">{title}</p>
  </div>
);

type MapRisk = 'high' | 'medium' | 'low';

const mapRiskLabel: Record<MapRisk, string> = {
  high: 'Crítico',
  medium: 'Atenção',
  low: 'Coberto',
};

const mapRiskClass: Record<MapRisk, string> = {
  high: 'border-red-400/20 bg-red-400/10 text-red-300',
  medium: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300',
  low: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
};

const PlannerMapsPanel: React.FC<{
  tasks: PlannerTask[];
  history: PlannerMetaHistoryEntry[];
  questionBankItems: QuestionBankItem[];
}> = ({ tasks, history, questionBankItems }) => {
  const rows = useMemo(() => {
    const disciplineNames = Array.from(new Set([
      ...tasks.map((task) => task.discipline),
      ...questionBankItems.map((item) => item.discipline),
      ...history.flatMap((entry) => entry.tasks.map((task) => task.discipline)),
    ])).sort();

    return disciplineNames.map((discipline) => {
      const taskItems = tasks.filter((task) => task.discipline === discipline);
      const bankItems = questionBankItems.filter((item) => item.discipline === discipline);
      const pending = taskItems.filter((task) => task.status === 'pending' || task.status === 'started').length;
      const highRelevancePending = taskItems.filter((task) =>
        (task.status === 'pending' || task.status === 'started') && task.relevance >= 9
      ).length;
      const scheduled = taskItems.filter((task) => task.scheduledDate).length;
      const minutes = taskItems.reduce((sum, task) => sum + task.durationMinutes, 0);
      const avgRelevance = averageRelevance(taskItems);
      const historyAppearances = history.filter((entry) =>
        entry.tasks.some((task) => task.discipline === discipline)
      ).length;
      const scheduleCoverage = taskItems.length ? scheduled / taskItems.length : 0;
      const coverageScore = Math.min(100, Math.round(
        (taskItems.length > 0 ? 25 : 0) +
        (scheduleCoverage * 25) +
        (bankItems.length > 0 ? 30 : 0) +
        (highRelevancePending === 0 ? 20 : 8)
      ));
      const risk: MapRisk = highRelevancePending > 0 && bankItems.length === 0
        ? 'high'
        : pending > 0 || bankItems.length === 0
          ? 'medium'
          : 'low';
      const recommendation = risk === 'high'
        ? 'Importar PDF de questões antes de executar.'
        : risk === 'medium'
          ? 'Executar pendências e completar banco se houver PDF.'
          : 'Pronta para execução/revisão.';

      return {
        discipline,
        tasks: taskItems.length,
        pending,
        highRelevancePending,
        scheduled,
        minutes,
        averageRelevance: avgRelevance,
        bankQuestions: bankItems.length,
        historyAppearances,
        coverageScore,
        risk,
        recommendation,
      };
    }).sort((a, b) => {
      const riskRank: Record<MapRisk, number> = { high: 0, medium: 1, low: 2 };
      return riskRank[a.risk] - riskRank[b.risk] || b.highRelevancePending - a.highRelevancePending || b.pending - a.pending;
    });
  }, [tasks, history, questionBankItems]);

  const highRisk = rows.filter((row) => row.risk === 'high').length;
  const missingQuestions = rows.filter((row) => row.tasks > 0 && row.bankQuestions === 0).length;
  const totalBankQuestions = questionBankItems.length;
  const coveredDisciplines = rows.filter((row) => row.risk === 'low').length;

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Metric icon={MapIcon} label="Disciplinas" value={`${rows.length}`} />
        <Metric icon={AlertTriangle} label="Críticas" value={`${highRisk}`} />
        <Metric icon={DatabaseIcon} label="Sem Banco" value={`${missingQuestions}`} />
        <Metric icon={CheckCircle2} label="Cobertas" value={`${coveredDisciplines}`} />
      </div>

      <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <MapIcon className="h-5 w-5 text-[#84cc16]" />
          <h2 className="text-lg font-black text-white">Mapas de Cobertura</h2>
          <span className="ml-auto rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
            {totalBankQuestions} questões no banco
          </span>
        </div>

        {rows.length > 0 ? (
          <div className="grid gap-3">
            {rows.map((row) => (
              <article key={row.discipline} className="rounded border border-white/5 bg-[#1a1a1a] p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-black text-white">{row.discipline}</h3>
                  <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${mapRiskClass[row.risk]}`}>
                    {mapRiskLabel[row.risk]}
                  </span>
                  <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-200">
                    Rel {row.averageRelevance || '-'}
                  </span>
                </div>

                <div className="mb-3 h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className={`h-full rounded-full ${row.risk === 'high' ? 'bg-red-400' : row.risk === 'medium' ? 'bg-yellow-400' : 'bg-[#84cc16]'}`}
                    style={{ width: `${row.coverageScore}%` }}
                  />
                </div>

                <div className="grid gap-2 text-[11px] font-black uppercase tracking-widest text-gray-400 sm:grid-cols-2 lg:grid-cols-6">
                  <span className="rounded bg-white/5 px-2 py-1">{row.tasks} tarefa(s)</span>
                  <span className="rounded bg-white/5 px-2 py-1">{row.pending} pendente(s)</span>
                  <span className="rounded bg-white/5 px-2 py-1">{row.highRelevancePending} rel alta</span>
                  <span className="rounded bg-white/5 px-2 py-1">{row.scheduled} agendada(s)</span>
                  <span className="rounded bg-white/5 px-2 py-1">{formatMinutes(row.minutes)}</span>
                  <span className="rounded bg-white/5 px-2 py-1">{row.bankQuestions} questão(ões)</span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500">
                  <span>{row.historyAppearances} aparição(ões) no histórico</span>
                  <span className="text-gray-700">·</span>
                  <span>{row.recommendation}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyPanel icon={MapIcon} title="Importe metas ou questões para gerar mapas" />
        )}
      </div>
    </section>
  );
};

const MetaHistoryPanel: React.FC<{
  history: PlannerMetaHistoryEntry[];
  currentMetaId?: string;
  onRestore: (entry: PlannerMetaHistoryEntry) => void;
}> = ({ history, currentMetaId, onRestore }) => {
  const latest = history[0];
  const previous = history[1];
  const latestGenerated = history.find((entry) => getHistoryOrigin(entry) === 'generated');
  const relatedOriginal = latestGenerated
    ? (latestGenerated.relatedMetaId ? history.find((entry) => entry.id === latestGenerated.relatedMetaId) : undefined)
      || history.find((entry) => getHistoryOrigin(entry) === 'ls')
    : undefined;
  const comparison = latestGenerated && relatedOriginal ? {
    generatedTasks: latestGenerated.meta.totalTasks || latestGenerated.tasks.length,
    originalTasks: relatedOriginal.meta.totalTasks || relatedOriginal.tasks.length,
    generatedMinutes: sumTaskMinutes(latestGenerated.tasks),
    originalMinutes: sumTaskMinutes(relatedOriginal.tasks),
    generatedDisciplines: latestGenerated.meta.totalDisciplines || countTaskDisciplines(latestGenerated.tasks),
    originalDisciplines: relatedOriginal.meta.totalDisciplines || countTaskDisciplines(relatedOriginal.tasks),
    generatedRelevance: averageRelevance(latestGenerated.tasks),
    originalRelevance: averageRelevance(relatedOriginal.tasks),
    generatedTitle: latestGenerated.meta.title,
    originalTitle: relatedOriginal.meta.title,
  } : null;

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
        <div className="mb-4 flex items-center gap-2">
          <History className="h-5 w-5 text-[#84cc16]" />
          <h2 className="text-lg font-black text-white">Histórico de Metas</h2>
          <span className="ml-auto rounded bg-black/30 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
            {history.length}
          </span>
        </div>

        {comparison && (
          <div className="mb-4 rounded-lg border border-[#84cc16]/20 bg-[#84cc16]/5 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#84cc16]" />
              <h3 className="text-sm font-black uppercase tracking-widest text-white">LS x Meta Gerada</h3>
              <span className="rounded bg-purple-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-purple-200">
                LS: {comparison.originalTitle}
              </span>
              <span className="rounded bg-[#84cc16]/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                Gerada: {comparison.generatedTitle}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <ComparisonMetric
                label="Tarefas"
                value={`${comparison.generatedTasks}`}
                baseline={`${comparison.originalTasks}`}
                delta={formatSignedNumber(comparison.generatedTasks - comparison.originalTasks)}
              />
              <ComparisonMetric
                label="Carga"
                value={formatMinutes(comparison.generatedMinutes)}
                baseline={formatMinutes(comparison.originalMinutes)}
                delta={formatSignedMinutes(comparison.generatedMinutes - comparison.originalMinutes)}
              />
              <ComparisonMetric
                label="Disciplinas"
                value={`${comparison.generatedDisciplines}`}
                baseline={`${comparison.originalDisciplines}`}
                delta={formatSignedNumber(comparison.generatedDisciplines - comparison.originalDisciplines)}
              />
              <ComparisonMetric
                label="Relevância média"
                value={`${comparison.generatedRelevance}`}
                baseline={`${comparison.originalRelevance}`}
                delta={formatSignedNumber(comparison.generatedRelevance - comparison.originalRelevance)}
              />
            </div>
          </div>
        )}

        {latest && previous && (
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <DeltaMetric label="Tarefas" value={latest.meta.totalTasks} previous={previous.meta.totalTasks} />
            <DeltaMetric label="Pendentes" value={latest.meta.pendingTasks} previous={previous.meta.pendingTasks} invertGood />
            <DeltaMetric label="Concluídas" value={latest.meta.completedTasks} previous={previous.meta.completedTasks} />
            <DeltaMetric label="Relevância média" value={averageRelevance(latest.tasks)} previous={averageRelevance(previous.tasks)} />
          </div>
        )}

        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
                  <th className="px-3 py-3">Meta</th>
                  <th className="px-3 py-3">Origem</th>
                  <th className="px-3 py-3">Planejamento</th>
                  <th className="px-3 py-3">Início</th>
                  <th className="px-3 py-3">Próxima</th>
                  <th className="px-3 py-3">Tarefas</th>
                  <th className="px-3 py-3">Disc.</th>
                  <th className="px-3 py-3">Concl.</th>
                  <th className="px-3 py-3">Pend.</th>
                  <th className="px-3 py-3">Ign.</th>
                  <th className="px-3 py-3">Rel.</th>
                  <th className="px-3 py-3">Importada</th>
                  <th className="px-3 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => {
                  const origin = getHistoryOrigin(entry);

                  return (
                    <tr key={entry.id} className="border-b border-white/5 text-sm text-gray-300 transition hover:bg-white/[0.03]">
                      <td className="px-3 py-3">
                        <div className="font-black text-white">{entry.meta.title}</div>
                        {entry.id === currentMetaId && (
                          <span className="mt-1 inline-block rounded bg-[#84cc16]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[#84cc16]">
                            Atual
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${historyOriginClass[origin]}`}>
                          {historyOriginLabel[origin]}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-bold text-purple-300">{entry.meta.planejamento || '-'}</td>
                      <td className="px-3 py-3">{entry.meta.startedAt || '-'}</td>
                      <td className="px-3 py-3">{entry.meta.nextMetaAt || '-'}</td>
                      <td className="px-3 py-3 font-black text-white">{entry.meta.totalTasks || entry.tasks.length}</td>
                      <td className="px-3 py-3">{entry.meta.totalDisciplines || countTaskDisciplines(entry.tasks)}</td>
                      <td className="px-3 py-3 text-[#84cc16]">{entry.meta.completedTasks}</td>
                      <td className="px-3 py-3 text-purple-300">{entry.meta.pendingTasks}</td>
                      <td className="px-3 py-3 text-gray-400">{entry.meta.ignoredTasks}</td>
                      <td className="px-3 py-3 font-black text-purple-300">{averageRelevance(entry.tasks)}</td>
                      <td className="px-3 py-3 text-xs text-gray-500">{formatDateTime(entry.archivedAt)}</td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onRestore(entry)}
                          className="rounded bg-white/10 px-2 py-1 text-[10px] font-black uppercase text-white hover:bg-white/20"
                        >
                          Restaurar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel icon={History} title="Nenhuma meta importada no histórico" />
        )}
      </div>
    </section>
  );
};

const DeltaMetric: React.FC<{ label: string; value: number; previous: number; invertGood?: boolean }> = ({
  label,
  value,
  previous,
  invertGood = false,
}) => {
  const delta = value - previous;
  const isGood = invertGood ? delta <= 0 : delta >= 0;
  const color = delta === 0 ? 'text-gray-400' : isGood ? 'text-[#84cc16]' : 'text-red-300';
  const sign = delta > 0 ? '+' : '';

  return (
    <div className="rounded border border-white/5 bg-[#1a1a1a] p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className="text-xl font-black text-white">{value}</p>
      <p className={`text-[11px] font-black uppercase tracking-widest ${color}`}>
        {sign}{delta} vs anterior
      </p>
    </div>
  );
};

const ComparisonMetric: React.FC<{ label: string; value: string; baseline: string; delta: string }> = ({
  label,
  value,
  baseline,
  delta,
}) => (
  <div className="rounded border border-white/5 bg-[#1a1a1a] p-3">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
    <p className="text-xl font-black text-white">{value}</p>
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-widest">
      <span className="text-gray-500">LS {baseline}</span>
      <span className="text-[#84cc16]">{delta}</span>
    </div>
  </div>
);

const loadStateLabel: Record<PlannerDisciplineInsight['loadState'], string> = {
  overloaded: 'Sobrecarga',
  balanced: 'Equilibrada',
  underloaded: 'Subcarga',
  neglected: 'Sumiu',
  new: 'Nova',
};

const trendLabel: Record<PlannerDisciplineInsight['trend'], string> = {
  up: 'Subiu',
  down: 'Caiu',
  steady: 'Estável',
  new: 'Nova',
};

const loadStateClass: Record<PlannerDisciplineInsight['loadState'], string> = {
  overloaded: 'border-red-400/20 bg-red-400/10 text-red-300',
  balanced: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
  underloaded: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300',
  neglected: 'border-gray-500/20 bg-gray-500/10 text-gray-400',
  new: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
};

const PlannerInsightsPanel: React.FC<{ insights: PlannerInsights }> = ({ insights }) => (
  <section className="space-y-4">
    <div className="grid gap-3 md:grid-cols-5">
      <Metric icon={Timer} label="Carga Atual" value={formatMinutes(insights.totalMinutes)} />
      <Metric icon={Target} label="Pend. Rel Alta" value={`${insights.highRelevancePending}`} />
      <Metric icon={AlertTriangle} label="Sobrecargas" value={`${insights.overloadedCount}`} />
      <Metric icon={Ban} label="Sumiram" value={`${insights.neglectedCount}`} />
      <Metric icon={History} label="Repetidas" value={`${insights.repeatedDisciplines}`} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
        <div className="mb-4 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-[#84cc16]" />
          <h2 className="text-lg font-black text-white">Ajustes Sugeridos</h2>
        </div>
        {insights.recommendations.length > 0 ? (
          <div className="space-y-3">
            {insights.recommendations.map((recommendation) => (
              <div key={recommendation} className="rounded border border-white/5 bg-[#1a1a1a] p-3">
                <p className="text-sm font-bold leading-relaxed text-gray-200">{recommendation}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel icon={Lightbulb} title="Sem ajustes críticos nesta meta" />
        )}
      </div>

      <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-purple-400" />
          <h2 className="text-lg font-black text-white">Padrão Semanal por Disciplina</h2>
        </div>
        {insights.disciplineInsights.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
                  <th className="px-3 py-3">Disciplina</th>
                  <th className="px-3 py-3">Atual</th>
                  <th className="px-3 py-3">Carga</th>
                  <th className="px-3 py-3">Hist.</th>
                  <th className="px-3 py-3">Média LS</th>
                  <th className="px-3 py-3">Rel.</th>
                  <th className="px-3 py-3">Pend. Alta</th>
                  <th className="px-3 py-3">Tend.</th>
                  <th className="px-3 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {insights.disciplineInsights.map((item) => (
                  <tr key={item.discipline} className="border-b border-white/5 text-sm text-gray-300 transition hover:bg-white/[0.03]">
                    <td className="px-3 py-3 font-bold text-white">{item.discipline}</td>
                    <td className="px-3 py-3 font-black text-white">{item.currentTasks}</td>
                    <td className="px-3 py-3">{formatMinutes(item.currentMinutes)}</td>
                    <td className="px-3 py-3">{item.historyAppearances} metas</td>
                    <td className="px-3 py-3">
                      {item.historicalAverageTasks} tarefa(s) · {formatMinutes(item.historicalAverageMinutes)}
                    </td>
                    <td className="px-3 py-3 font-black text-purple-300">{item.averageRelevance || '-'}</td>
                    <td className="px-3 py-3 font-black text-white">{item.highRelevancePending}</td>
                    <td className="px-3 py-3">{trendLabel[item.trend]}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${loadStateClass[item.loadState]}`}>
                        {loadStateLabel[item.loadState]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel icon={BarChart3} title="Importe ao menos uma meta para gerar insights" />
        )}
      </div>
    </div>
  </section>
);

const draftReasonLabel: Record<PlannerDraftTask['reason'], string> = {
  'carry-pending': 'Carregar pendência',
  rebalance: 'Rebalancear',
  retake: 'Retomar',
  maintenance: 'Manutenção',
};

const draftReasonClass: Record<PlannerDraftTask['reason'], string> = {
  'carry-pending': 'border-purple-400/20 bg-purple-400/10 text-purple-300',
  rebalance: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-300',
  retake: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
  maintenance: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
};

const studyBlockKindLabel: Record<DailyStudyBlock['kind'], string> = {
  theory: 'Teoria',
  questions: 'Questões',
  review: 'Revisão',
};

const studyBlockKindClass: Record<DailyStudyBlock['kind'], string> = {
  theory: 'border-blue-400/20 bg-blue-400/10 text-blue-200',
  questions: 'border-[#84cc16]/20 bg-[#84cc16]/10 text-[#84cc16]',
  review: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-200',
};

const StudyOSPlannerPanel: React.FC<{
  targetProfiles: ExamTargetProfile[];
  activeTarget?: ExamTargetProfile;
  targetSlug: string;
  phase: StudyPlanPhase;
  coverageDraft: string;
  targetProfileDraft: string;
  sourceDraft: string;
  rawSourceText: string;
  rawSourceKind: StudySourceKind | 'auto';
  sourceItemCount: number;
  targetDecisionRows: TargetDecisionRow[];
  plan: StudyDayPlan | null;
  weekPlan: StudyWeekPlan | null;
  refreshPlan: StudyRefreshPlan | null;
  weekStartDate: string;
  onTargetChange: (targetSlug: string) => void;
  onPhaseChange: (phase: StudyPlanPhase) => void;
  onCoverageDraftChange: (value: string) => void;
  onTargetProfileDraftChange: (value: string) => void;
  onSourceDraftChange: (value: string) => void;
  onRawSourceTextChange: (value: string) => void;
  onRawSourceKindChange: (value: StudySourceKind | 'auto') => void;
  onAppendInferredSources: () => void;
  onSaveTargetProfiles: () => void;
  onResetTargetProfiles: () => void;
  onSeedCoverage: (targetSlug?: string) => void;
  onSeedSources: (targetSlug?: string) => void;
  onGenerate: () => void;
  onApply: () => void;
  onGenerateWeek: () => void;
  onApplyWeek: () => void;
  onGenerateRefresh: () => void;
  onApplyRefresh: () => void;
}> = ({
  targetProfiles,
  activeTarget,
  targetSlug,
  phase,
  coverageDraft,
  targetProfileDraft,
  sourceDraft,
  rawSourceText,
  rawSourceKind,
  sourceItemCount,
  targetDecisionRows,
  plan,
  weekPlan,
  refreshPlan,
  weekStartDate,
  onTargetChange,
  onPhaseChange,
  onCoverageDraftChange,
  onTargetProfileDraftChange,
  onSourceDraftChange,
  onRawSourceTextChange,
  onRawSourceKindChange,
  onAppendInferredSources,
  onSaveTargetProfiles,
  onResetTargetProfiles,
  onSeedCoverage,
  onSeedSources,
  onGenerate,
  onApply,
  onGenerateWeek,
  onApplyWeek,
  onGenerateRefresh,
  onApplyRefresh,
}) => {
  const activeDayBlocks = refreshPlan?.blocks || plan?.blocks || [];
  const activeWarnings = refreshPlan?.warnings || plan?.warnings || [];
  const visibleScoreboard = (refreshPlan?.scoreboard || plan?.scoreboard || weekPlan?.scoreboard || []).slice(0, 12);
  const coverageRows = useMemo(() => parseStudyCoverageTable(coverageDraft), [coverageDraft]);
  const weekBlockCount = weekPlan?.days.reduce((total, day) => total + day.blocks.length, 0) || 0;
  const weekEndDate = weekPlan?.days[weekPlan.days.length - 1]?.date;

  return (
    <section className="rounded-lg border border-[#84cc16]/20 bg-[#18210f] p-4 shadow-lg shadow-black/20">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-[#84cc16]" />
            <h2 className="text-lg font-black text-white">Study OS Planner</h2>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
            <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-gray-300">{activeTarget?.organizer || 'Banca'}</span>
            <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-gray-300">{activeTarget?.vagasNotes || 'Sem vagas fixas'}</span>
            <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[#84cc16]">CB {activeTarget?.costBenefit || '-'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="rounded bg-[#84cc16] px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition hover:bg-[#65a30d]"
          >
            Gerar 4 blocos
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!plan || plan.blocks.length === 0}
            className="rounded border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar hoje
          </button>
          <button
            type="button"
            onClick={onGenerateWeek}
            className="rounded border border-[#84cc16]/30 bg-[#84cc16]/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-[#bef264] transition hover:bg-[#84cc16]/20"
          >
            Gerar semana
          </button>
          <button
            type="button"
            onClick={onApplyWeek}
            disabled={!weekPlan || weekBlockCount === 0}
            className="rounded border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-purple-100 transition hover:bg-purple-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar semana
          </button>
          <button
            type="button"
            onClick={onGenerateRefresh}
            className="rounded border border-yellow-400/30 bg-yellow-400/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-yellow-100 transition hover:bg-yellow-400/20"
          >
            Refresh amanhã
          </button>
          <button
            type="button"
            onClick={onApplyRefresh}
            disabled={!refreshPlan || refreshPlan.blocks.length === 0}
            className="rounded border border-white/10 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Aplicar refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
          <label className="grid gap-1 text-[10px] font-black uppercase tracking-widest text-gray-500">
            Target
            <select
              value={targetSlug}
              onChange={(event) => onTargetChange(event.target.value)}
              className="rounded border border-[#525252] bg-[#262626] px-3 py-2 text-sm font-bold text-white outline-none focus:border-[#84cc16]"
            >
              {targetProfiles.map((target) => (
                <option key={target.slug} value={target.slug}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onPhaseChange('pre_edital')}
              className={`rounded px-3 py-2 text-xs font-black uppercase tracking-widest transition ${
                phase === 'pre_edital' ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Pré
            </button>
            <button
              type="button"
              onClick={() => onPhaseChange('pos_edital')}
              className={`rounded px-3 py-2 text-xs font-black uppercase tracking-widest transition ${
                phase === 'pos_edital' ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'
              }`}
            >
              Pós
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric icon={ClipboardList} label="Cobertura" value={`${coverageRows.length}`} />
            <Metric icon={DatabaseIcon} label="Fontes" value={`${sourceItemCount}`} />
            <Metric icon={ListChecks} label="Score" value={`${(refreshPlan?.scoreboard || plan?.scoreboard || weekPlan?.scoreboard || []).length}`} />
            <Metric icon={Target} label="Targets" value={`${targetProfiles.length}`} />
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Semana alvo</p>
            <p className="mt-1 text-sm font-black text-white">{formatShortDate(weekStartDate)} a {weekEndDate ? formatShortDate(weekEndDate) : 'sex.'}</p>
            <p className="mt-2 text-xs font-bold text-gray-400">{weekBlockCount || 20} blocos planejáveis quando houver cobertura suficiente.</p>
          </div>

          <div className="grid gap-2">
            {targetProfiles.map((target) => (
              <button
                key={target.slug}
                type="button"
                onClick={() => {
                  onTargetChange(target.slug);
                  onSeedCoverage(target.slug);
                }}
                className="rounded border border-white/10 bg-white/5 px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-gray-300 transition hover:border-[#84cc16]/40 hover:bg-[#84cc16]/10 hover:text-white"
              >
                Seed {target.name}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Perfis</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onSaveTargetProfiles}
                  className="rounded bg-[#84cc16] px-2 py-1 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-[#65a30d]"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={onResetTargetProfiles}
                  className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-300 transition hover:bg-white/10"
                >
                  Reset
                </button>
              </div>
            </div>
            <textarea
              value={targetProfileDraft}
              onChange={(event) => onTargetProfileDraftChange(event.target.value)}
              className="min-h-[150px] w-full resize-y rounded border border-white/10 bg-[#111] p-2 font-mono text-[10px] leading-4 text-gray-100 outline-none focus:border-[#84cc16]"
              spellCheck={false}
            />
          </div>
        </aside>

        <main className="grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(560px,1.05fr)]">
          <div className="space-y-4">
            <TargetDecisionTable rows={targetDecisionRows} activeSlug={targetSlug} onSelect={onTargetChange} />

            <textarea
              value={coverageDraft}
              onChange={(event) => onCoverageDraftChange(event.target.value)}
              className="min-h-[220px] w-full resize-y rounded-lg border border-white/10 bg-[#111] p-3 font-mono text-xs leading-5 text-gray-100 outline-none focus:border-[#84cc16]"
              spellCheck={false}
            />

            <div className="rounded-lg border border-white/10 bg-black/15 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-[#84cc16]">Fontes concorrentes</p>
                  <p className="mt-1 text-[11px] font-bold text-gray-500">Trilha, aulas, TEC, Andréty ou manual entram como sinais do score.</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSeedSources(targetSlug)}
                  className="rounded border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-300 transition hover:bg-white/10"
                >
                  Seed fontes
                </button>
              </div>

              <div className="mb-3 grid gap-2 rounded border border-white/10 bg-[#151515] p-2">
                <div className="flex flex-wrap gap-2">
                  <select
                    value={rawSourceKind}
                    onChange={(event) => onRawSourceKindChange(event.target.value as StudySourceKind | 'auto')}
                    className="rounded border border-[#525252] bg-[#262626] px-2 py-1.5 text-[11px] font-bold text-white outline-none focus:border-[#84cc16]"
                  >
                    <option value="auto">Auto</option>
                    <option value="tec_incidence">TEC</option>
                    <option value="estrategia_aulas">Aulas</option>
                    <option value="trilha_estrategica">Trilha</option>
                    <option value="guia_andrety">Andrety</option>
                    <option value="manual">Manual</option>
                  </select>
                  <button
                    type="button"
                    onClick={onAppendInferredSources}
                    disabled={!rawSourceText.trim()}
                    className="rounded bg-[#84cc16] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Normalizar texto
                  </button>
                </div>
                <textarea
                  value={rawSourceText}
                  onChange={(event) => onRawSourceTextChange(event.target.value)}
                  className="min-h-[96px] w-full resize-y rounded border border-white/10 bg-[#0f0f0f] p-2 font-mono text-[11px] leading-4 text-gray-100 outline-none focus:border-[#84cc16]"
                  spellCheck={false}
                  placeholder="TEC: Economia - Macroeconomia - incidencia 9 - peso 2"
                />
              </div>
              <textarea
                value={sourceDraft}
                onChange={(event) => onSourceDraftChange(event.target.value)}
                className="min-h-[170px] w-full resize-y rounded border border-white/10 bg-[#111] p-3 font-mono text-xs leading-5 text-gray-100 outline-none focus:border-[#84cc16]"
                spellCheck={false}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {activeDayBlocks.length ? (
                activeDayBlocks.map((block, index) => (
                  <div key={block.id} className="rounded-lg border border-white/10 bg-black/15 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${studyBlockKindClass[block.kind]}`}>
                        {index + 1} · {studyBlockKindLabel[block.kind]}
                      </span>
                      <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black text-gray-300">{block.finalScore}</span>
                    </div>
                    <p className="text-sm font-black text-white">{block.discipline}</p>
                    <p className="mt-1 text-sm font-bold text-gray-300">{block.topic}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                      <span className="rounded bg-white/5 px-2 py-1 text-gray-300">{formatMinutes(block.durationMinutes)}</span>
                      {block.plannedQuestions && <span className="rounded bg-white/5 px-2 py-1 text-gray-300">{block.plannedQuestions} questões</span>}
                    </div>
                  </div>
                ))
              ) : (
                <EmptyPanel icon={Target} title="Sem blocos gerados" />
              )}
            </div>

            {refreshPlan ? (
              <div className="rounded-lg border border-yellow-400/20 bg-yellow-400/10 p-3 text-xs font-bold text-yellow-100">
                Refresh para {formatShortDate(refreshPlan.date)} baseado em {refreshPlan.refreshedFromTaskIds.length} dívida(s) de execução.
              </div>
            ) : null}

            {weekPlan ? (
              <div className="grid gap-2 rounded-lg border border-white/10 bg-black/15 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase tracking-widest text-[#84cc16]">Shell semanal Study OS</p>
                  <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-black text-gray-300">{weekBlockCount} blocos</span>
                </div>
                <div className="grid gap-2 lg:grid-cols-5">
                  {weekPlan.days.map((day) => (
                    <div key={day.date} className="rounded border border-white/10 bg-[#111] p-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-purple-300">{formatShortDate(day.date)}</p>
                      <div className="mt-2 space-y-1.5">
                        {day.blocks.map((block, index) => (
                          <div key={block.id} className="rounded bg-white/5 px-2 py-1.5">
                            <p className="truncate text-[10px] font-black uppercase tracking-widest text-gray-500">{index + 1} · {studyBlockKindLabel[block.kind]}</p>
                            <p className="truncate text-xs font-bold text-white">{block.discipline}</p>
                            <p className="truncate text-[11px] font-bold text-gray-400">{block.topic}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {activeWarnings.length ? (
              <div className="space-y-2">
                {activeWarnings.map((warning) => (
                  <div key={warning} className="rounded border border-yellow-400/20 bg-yellow-400/10 p-3 text-xs font-bold text-yellow-100">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
            {weekPlan?.warnings.length ? (
              <div className="space-y-2">
                {weekPlan.warnings.map((warning) => (
                  <div key={warning} className="rounded border border-yellow-400/20 bg-yellow-400/10 p-3 text-xs font-bold text-yellow-100">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/15">
            {visibleScoreboard.length > 0 ? (
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <th className="px-3 py-3">Bloco</th>
                    <th className="px-3 py-3">Disciplina</th>
                    <th className="px-3 py-3">Tema</th>
                    <th className="px-3 py-3">W</th>
                    <th className="px-3 py-3">Inc</th>
                    <th className="px-3 py-3">Tier</th>
                    <th className="px-3 py-3">Cob</th>
                    <th className="px-3 py-3">Rev</th>
                    <th className="px-3 py-3">LS</th>
                    <th className="px-3 py-3">Fit</th>
                    <th className="px-3 py-3">Pen</th>
                    <th className="px-3 py-3">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleScoreboard.map((row) => (
                    <StudyScoreRow key={row.candidateKey} row={row} />
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyPanel icon={BarChart3} title="Sem score calculado" />
            )}
          </div>
        </main>
      </div>
    </section>
  );
};

const TargetDecisionTable: React.FC<{
  rows: TargetDecisionRow[];
  activeSlug: string;
  onSelect: (targetSlug: string) => void;
}> = ({ rows, activeSlug, onSelect }) => (
  <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/15">
    {rows.length > 0 ? (
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
            <th className="px-3 py-3">Target</th>
            <th className="px-3 py-3">Score</th>
            <th className="px-3 py-3">Vagas</th>
            <th className="px-3 py-3">Cob.</th>
            <th className="px-3 py-3">LS</th>
            <th className="px-3 py-3">Curso</th>
            <th className="px-3 py-3">Banca</th>
            <th className="px-3 py-3">Sinal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.targetSlug}
              className={`border-b border-white/5 text-xs transition ${
                row.targetSlug === activeSlug ? 'bg-[#84cc16]/10 text-white' : 'text-gray-300 hover:bg-white/[0.03]'
              }`}
            >
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelect(row.targetSlug)}
                  className="text-left font-black text-white transition hover:text-[#bef264]"
                >
                  {row.name}
                </button>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">{row.organizer} · {row.phase === 'pos_edital' ? 'Pós' : 'Pré'}</p>
              </td>
              <td className="px-3 py-2">
                <span className="rounded bg-[#84cc16]/10 px-2 py-1 font-black text-[#84cc16]">{row.recommendationScore}</span>
              </td>
              <td className="max-w-[160px] truncate px-3 py-2">{row.vagasNotes || '-'}</td>
              <td className="px-3 py-2 font-black text-white">{row.coverageRows}</td>
              <td className="px-3 py-2">{row.lsAvailability}</td>
              <td className="px-3 py-2">{row.courseAvailability}</td>
              <td className="px-3 py-2">{row.bancaFit}</td>
              <td className="max-w-[220px] truncate px-3 py-2">{row.reasons[0] || row.recommendationLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <EmptyPanel icon={Target} title="Sem targets válidos" />
    )}
  </div>
);

const StudyScoreRow: React.FC<{ row: StudyScoreboardRow }> = ({ row }) => (
  <tr className={`border-b border-white/5 text-xs transition ${row.chosen ? 'bg-[#84cc16]/10 text-white' : 'text-gray-300 hover:bg-white/[0.03]'}`}>
    <td className="px-3 py-2">
      <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${studyBlockKindClass[row.kind]}`}>
        {studyBlockKindLabel[row.kind]}
      </span>
    </td>
    <td className="px-3 py-2 font-bold text-white">{row.discipline}</td>
    <td className="max-w-[220px] truncate px-3 py-2">{row.topic}</td>
    <td className="px-3 py-2">{row.weakness}</td>
    <td className="px-3 py-2">{row.incidence}</td>
    <td className="px-3 py-2">{row.tier}</td>
    <td className="px-3 py-2">{row.coverageNeed}</td>
    <td className="px-3 py-2">{row.reviewDebt}</td>
    <td className="px-3 py-2">{row.lsAlignment}</td>
    <td className="px-3 py-2">{row.targetFit}</td>
    <td className="px-3 py-2">{row.lowTrustPenalty + row.balancePenalty}</td>
    <td className="px-3 py-2 font-black text-[#84cc16]">{row.finalScore}</td>
  </tr>
);

const PlannerGeneratorPanel: React.FC<{
  draft: PlannerDraft;
  draftItems: DraftTaskItem[];
  weeklyHours: number;
  maxTasks: number;
  onWeeklyHoursChange: (value: number) => void;
  onMaxTasksChange: (value: number) => void;
  onUpdateTask: (key: string, updates: DraftTaskEdit) => void;
  onRemoveTask: (key: string) => void;
  onResetDraft: () => void;
  hasCustomDraft: boolean;
  onApply: () => void;
}> = ({
  draft,
  draftItems,
  weeklyHours,
  maxTasks,
  onWeeklyHoursChange,
  onMaxTasksChange,
  onUpdateTask,
  onRemoveTask,
  onResetDraft,
  hasCustomDraft,
  onApply,
}) => (
  <section className="space-y-4">
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-lg border border-[#404040] bg-[#262626] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#84cc16]" />
          <h2 className="text-lg font-black text-white">Gerador da Próxima Meta</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Horas/semana" value={weeklyHours} onChange={onWeeklyHoursChange} />
          <NumberField label="Tarefas" value={maxTasks} onChange={onMaxTasksChange} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric icon={Timer} label="Carga" value={formatMinutes(draft.totalMinutes)} />
          <Metric icon={ClipboardList} label="Tarefas" value={`${draft.totalTasks}`} />
        </div>
        {draft.warnings.length > 0 && (
          <div className="space-y-2">
            {draft.warnings.map((warning) => (
              <div key={warning} className="rounded border border-yellow-400/20 bg-yellow-400/10 p-3 text-xs font-bold text-yellow-200">
                {warning}
              </div>
            ))}
          </div>
        )}
        {hasCustomDraft && (
          <button
            type="button"
            onClick={onResetDraft}
            className="flex w-full items-center justify-center gap-2 rounded border border-white/10 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-white/10"
          >
            <RotateCcw className="h-4 w-4" /> Resetar Rascunho
          </button>
        )}
        <button
          type="button"
          onClick={onApply}
          disabled={draft.tasks.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded bg-[#84cc16] px-4 py-3 text-sm font-black text-black transition hover:bg-[#65a30d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="h-4 w-4" /> Usar como Meta Gerada
        </button>
      </aside>

      <main className="space-y-4">
        <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex items-center gap-2">
            <Table2 className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-black text-white">Rascunho de Tarefas</h2>
          </div>
          {draftItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-gray-500">
                    <th className="px-3 py-3">Nº</th>
                    <th className="px-3 py-3">Disciplina</th>
                    <th className="px-3 py-3">Formato</th>
                    <th className="px-3 py-3">Descrição</th>
                    <th className="px-3 py-3">Carga</th>
                    <th className="px-3 py-3">Rel.</th>
                    <th className="px-3 py-3">Motivo</th>
                    <th className="px-3 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {draftItems.map(({ key, task }, index) => (
                    <tr key={key} className="border-b border-white/5 text-sm text-gray-300">
                      <td className="px-3 py-3 font-black text-white">{index + 1}</td>
                      <td className="px-3 py-3 font-bold text-white">{task.discipline}</td>
                      <td className="px-3 py-3 text-gray-400">{task.format}</td>
                      <td className="max-w-md px-3 py-3">
                        <textarea
                          value={task.description}
                          onChange={(event) => onUpdateTask(key, { description: event.target.value })}
                          className="h-16 w-full resize-none rounded border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs font-bold text-gray-100 outline-none focus:border-purple-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={15}
                          max={240}
                          step={15}
                          value={task.durationMinutes}
                          onChange={(event) => onUpdateTask(key, {
                            durationMinutes: Math.min(240, Math.max(15, Number(event.target.value) || 15)),
                          })}
                          className="w-20 rounded border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs font-black text-white outline-none focus:border-purple-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={task.relevance}
                          onChange={(event) => onUpdateTask(key, {
                            relevance: Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                          })}
                          className="w-16 rounded border border-white/10 bg-[#1a1a1a] px-2 py-2 text-xs font-black text-purple-300 outline-none focus:border-purple-500"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${draftReasonClass[task.reason]}`}>
                          {draftReasonLabel[task.reason]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onRemoveTask(key)}
                          className="rounded bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase text-red-300 hover:bg-red-500/20"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel icon={Sparkles} title="Importe metas ou ajuste os limites para gerar um rascunho" />
          )}
        </div>

        <div className="rounded-lg border border-[#404040] bg-[#262626] p-4">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#84cc16]" />
            <h2 className="text-lg font-black text-white">Distribuição do Rascunho</h2>
          </div>
          {draft.allocations.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {draft.allocations.map((allocation) => (
                <div key={allocation.discipline} className="rounded border border-white/5 bg-[#1a1a1a] p-3">
                  <p className="text-sm font-black text-white">{allocation.discipline}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
                    <span className="rounded bg-white/5 px-2 py-1 text-gray-300">{allocation.tasks} tarefa(s)</span>
                    <span className="rounded bg-white/5 px-2 py-1 text-gray-300">{formatMinutes(allocation.minutes)}</span>
                    <span className="rounded bg-purple-500/10 px-2 py-1 text-purple-300">Rel {allocation.relevance}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel icon={BarChart3} title="Sem distribuição calculada" />
          )}
        </div>
      </main>
    </div>
  </section>
);
