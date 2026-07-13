import type { PlannerTask, QuestionBankItem } from '../../types';
import {
  parseStudyCoverageTable,
  parseStudySourceTable,
  parseStudyTargetProfileTable,
  type ExamTargetProfile,
  type StudyCoverageRow,
  type StudySourceItem,
} from '../../utils/studyPlannerCore';

export const MIGRATED_STUDY_OS_KEYS = [
  'study_os_target_v1',
  'study_os_phase_v1',
  'study_os_coverage_table_v1',
  'study_os_target_profiles_v1',
  'study_os_source_signals_v1',
] as const;

const TARGET_KEY = 'study_os_target_v1';
const PHASE_KEY = 'study_os_phase_v1';
const COVERAGE_KEY = 'study_os_coverage_table_v1';
const PROFILES_KEY = 'study_os_target_profiles_v1';
const SOURCE_SIGNALS_KEY = 'study_os_source_signals_v1';
const LS_TASKS_KEY = 'ls_planner_tasks_v1';
const QUESTION_BANK_KEY = 'ls_question_bank_v1';
const SUPPORTED_TARGETS = new Set([
  'bacen_economia_financas',
  'rfb_auditor',
  'rfb_analista',
  'sefaz_ce',
]);

export interface LegacyStorageReader {
  getItem(key: string): string | null;
}

export interface LegacyStorageCleaner {
  removeItem(key: string): void;
}

export interface LegacyTargetProfilePayload {
  legacyId: string;
  targetSlug: string;
  displayName: string;
  institution: string;
  role: string;
  banca: string;
  phase: 'pre_edital' | 'pos_edital';
  deadline: null;
  dailyQuota: number;
  priorityScore: number;
  sourceUrls: string[];
  notes: string;
  active: boolean;
}

export interface LegacyCoveragePayload {
  legacyId: string;
  targetSlug: string;
  discipline: string;
  topic: string;
  coverageStatus: 'strong' | 'stale' | 'weak' | 'unread';
  editalWeight: number;
  incidence: number;
  tier: number;
  bancaFit: number;
  overlapValue: number;
  transferKind: 'target_specific' | 'shared';
  sourceKind: 'course' | 'tec' | 'ls' | 'trilha' | 'manual' | 'bizu';
  plannedQuestions: number;
  reviewDebt: number;
  notes: string;
  active: boolean;
}

export interface LegacyLsTaskPayload {
  legacyId: string;
  sourceTargetSlug: string;
  targetSlug: string;
  discipline: string;
  topicHint: string;
  order: number;
  taskKind: string;
  status: 'pending' | 'started' | 'completed' | 'ignored' | 'archived';
  scheduledDate: string | null;
  metadata: Record<string, string | number>;
}

export interface LegacySourceSignalPayload {
  legacyId: string;
  sourceTargetSlug: string;
  targetSlug: string;
  sourceKey: string;
  sourceKind: 'trilha' | 'ls' | 'andrety' | 'tec' | 'manual';
  displayName: string;
  trustTier: number;
  discipline: string;
  topicHint: string;
  order: number;
  contentRole: 'schedule_advice' | 'incidence_signal';
  targetTopicId: null;
  transferKind: 'target_specific' | 'shared';
  incidenceBp: number;
  banca: string;
  edition: string;
  notes: string;
  externalUrl: null;
  externalId: string;
  metadata: Record<string, string>;
}

export interface LegacyLearningPayload {
  legacyId: string;
  targetSlug: string;
  targetTopicId: null;
  discipline: string;
  topic: string;
  eventKind: 'questions';
  occurredAt: string;
  sourceDate: string;
  questionsDone: number;
  correctCount: number;
  wrongCount: number;
  doubtCount: number;
  favoriteCount: number;
  sourceLabel: string;
  banca: string;
  tags: string[];
}

export interface LegacyBrowserBundlePayload extends Record<string, unknown> {
  schema: 'study-os.browser-migration.v1';
  migrationId: string;
  exportedAt: string;
  activeTargetSlug: string;
  targetProfiles: LegacyTargetProfilePayload[];
  coverageRows: LegacyCoveragePayload[];
  lsTasks: LegacyLsTaskPayload[];
  sourceSignals: LegacySourceSignalPayload[];
  learningItems: LegacyLearningPayload[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const finite = (value: unknown, fallback = 0): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const clamp = (value: number, minimum: number, maximum: number): number => (
  Math.min(maximum, Math.max(minimum, value))
);
const integer = (value: unknown, fallback = 0): number => (
  Math.round(finite(value, fallback))
);
const supportedTarget = (value: unknown): string | null => {
  const candidate = text(value);
  return SUPPORTED_TARGETS.has(candidate) ? candidate : null;
};

const parseArray = (value: string | null): unknown[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const stableHash = (value: unknown): string => {
  const serialized = canonical(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
};

const normalizedIdentity = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'item';

const validDate = (value: unknown, fallback: Date): string => {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
};

const validDay = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
};

const profilePayload = (
  profile: ExamTargetProfile,
  activeTargetSlug: string,
  storedPhase: string,
): LegacyTargetProfilePayload => ({
  legacyId: `profile:${profile.slug}`,
  targetSlug: profile.slug,
  displayName: profile.name,
  institution: profile.institution || profile.name,
  role: profile.role || profile.name,
  banca: profile.organizer || 'A definir',
  phase: profile.slug === activeTargetSlug && storedPhase === 'pos_edital'
    ? 'pos_edital'
    : profile.phase,
  deadline: null,
  dailyQuota: clamp(integer(profile.defaultDailyQuota, 4), 1, 8),
  priorityScore: clamp(integer(profile.priorityScore, 50), 0, 100),
  sourceUrls: profile.sourceUrls.filter((url) => /^https?:\/\//i.test(url)),
  notes: [profile.editalNotes, profile.vagasNotes].filter(Boolean).join(' | '),
  active: profile.slug === activeTargetSlug ? true : profile.active,
});

const coverageSourceKind = (row: StudyCoverageRow): LegacyCoveragePayload['sourceKind'] => {
  const source = `${row.materialSource || ''} ${row.materialHint || ''}`.toLowerCase();
  if (source.includes('tec')) return 'tec';
  if (source.includes('trilha')) return 'trilha';
  if (source.includes('ls')) return 'ls';
  if (source.includes('bizu') || source.includes('dica')) return 'bizu';
  if (source.includes('estrategia') || source.includes('curso') || source.includes('aula')) return 'course';
  return 'manual';
};

const reviewDebt = (status: StudyCoverageRow['status']): number => ({
  strong: 0,
  stale: 60,
  weak: 80,
  unread: 20,
}[status]);

const coveragePayload = (
  row: StudyCoverageRow,
  activeTargetSlug: string,
  profiles: Map<string, ExamTargetProfile>,
): LegacyCoveragePayload | null => {
  const shared = row.targetSlug === 'shared';
  const targetSlug = shared ? activeTargetSlug : supportedTarget(row.targetSlug);
  if (!targetSlug) return null;
  const profile = profiles.get(targetSlug);
  return {
    legacyId: [
      'coverage',
      shared ? 'shared' : targetSlug,
      normalizedIdentity(row.discipline),
      normalizedIdentity(row.topic),
    ].join(':'),
    targetSlug,
    discipline: row.discipline,
    topic: row.topic,
    coverageStatus: row.status,
    editalWeight: clamp(finite(row.editalWeight, 1), 0, 10),
    incidence: clamp(finite(row.incidence), 0, 100),
    tier: clamp(integer(row.tier, 3), 1, 5),
    bancaFit: clamp(integer((profile?.bancaFit ?? 5) * 10), 0, 100),
    overlapValue: shared ? 80 : 100,
    transferKind: shared ? 'shared' : 'target_specific',
    sourceKind: coverageSourceKind(row),
    plannedQuestions: 20,
    reviewDebt: reviewDebt(row.status),
    notes: [row.materialHint, row.notes].filter(Boolean).join(' | '),
    active: true,
  };
};

const taskPayload = (
  value: unknown,
  activeTargetSlug: string,
): LegacyLsTaskPayload | null => {
  if (!isRecord(value)) return null;
  const source = text(value.source);
  const plannerSourceKind = text(value.plannerSourceKind);
  if (!(source === 'ls-meta-text' || source === 'ls-meta-pdf' || plannerSourceKind === 'ls')) return null;
  const targetSlug = supportedTarget(value.targetSlug) || activeTargetSlug;
  const legacyId = text(value.id);
  const discipline = text(value.discipline);
  const topicHint = text(value.description);
  const allowedStatuses = new Set(['pending', 'started', 'completed', 'ignored', 'archived']);
  const status = text(value.status);
  if (!legacyId || !discipline || !topicHint || !allowedStatuses.has(status)) return null;
  const rawKind = text(value.plannedBlockKind);
  const taskKind = ['theory', 'questions', 'review'].includes(rawKind)
    ? rawKind
    : /quest/i.test(`${text(value.format)} ${topicHint}`)
      ? 'questions'
      : /revis/i.test(`${text(value.format)} ${topicHint}`)
        ? 'review'
        : 'theory';
  const metadata: Record<string, string | number> = { source };
  if (Number.isInteger(value.metaNumber) && finite(value.metaNumber) >= 0) {
    metadata.metaNumber = finite(value.metaNumber);
  }
  return {
    legacyId,
    sourceTargetSlug: targetSlug,
    targetSlug,
    discipline,
    topicHint,
    order: Math.max(0, integer(value.number)),
    taskKind,
    status: status as LegacyLsTaskPayload['status'],
    scheduledDate: validDay(value.scheduledDate),
    metadata,
  };
};

const SOURCE_KIND_MAP: Record<
  StudySourceItem['sourceKind'],
  LegacySourceSignalPayload['sourceKind']
> = {
  trilha_estrategica: 'trilha',
  guia_andrety: 'andrety',
  tec_incidence: 'tec',
  ls: 'ls',
  estrategia_aulas: 'manual',
  manual: 'manual',
};

const sourceKind = (
  value: StudySourceItem['sourceKind'],
): LegacySourceSignalPayload['sourceKind'] => SOURCE_KIND_MAP[value];

const sourceLabel = (value: StudySourceItem['sourceKind']): string => ({
  trilha_estrategica: 'Trilha Estrategica (legado)',
  guia_andrety: 'Guia Andrety (legado)',
  tec_incidence: 'TEC incidencia (legado)',
  ls: 'LS (legado)',
  estrategia_aulas: 'Estrategia aulas (legado)',
  manual: 'Sinal manual (legado)',
}[value]);

const sourcePayload = (
  item: StudySourceItem,
  activeTargetSlug: string,
  profiles: Map<string, ExamTargetProfile>,
): LegacySourceSignalPayload | null => {
  const shared = item.targetSlug === 'shared';
  const targetSlug = shared ? activeTargetSlug : supportedTarget(item.targetSlug);
  if (!targetSlug) return null;
  const mappedKind = sourceKind(item.sourceKind);
  const trustTier = clamp(integer(item.sourceTrust, 5), 0, 10);
  return {
    legacyId: item.id,
    sourceTargetSlug: targetSlug,
    targetSlug,
    sourceKey: `legacy-browser:${mappedKind}:${targetSlug}:${item.id}`,
    sourceKind: mappedKind,
    displayName: sourceLabel(item.sourceKind),
    trustTier,
    discipline: item.discipline,
    topicHint: item.topic,
    order: Math.max(0, integer(item.sourceOrder)),
    contentRole: mappedKind === 'tec' ? 'incidence_signal' : 'schedule_advice',
    targetTopicId: null,
    transferKind: shared ? 'shared' : 'target_specific',
    incidenceBp: clamp(integer(finite(item.incidence) * 100), 0, 10000),
    banca: profiles.get(targetSlug)?.organizer || '',
    edition: 'legacy-browser',
    notes: text(item.lesson),
    externalUrl: null,
    externalId: item.id,
    metadata: { legacySourceKind: item.sourceKind },
  };
};

const learningPayload = (
  value: unknown,
  fallback: Date,
): LegacyLearningPayload | null => {
  if (!isRecord(value)) return null;
  const targetSlug = supportedTarget(value.targetSlug);
  const discipline = text(value.discipline);
  const fingerprint = text(value.fingerprint) || text(value.id);
  if (!targetSlug || !discipline || !fingerprint) return null;
  const attempts = Array.isArray(value.attempts)
    ? value.attempts.filter(isRecord)
    : [];
  const favorite = value.favorite === true;
  const doubt = value.hasDoubt === true;
  if (attempts.length === 0 && !favorite && !doubt) return null;
  const timestamps = [
    ...attempts.map((attempt) => text(attempt.attemptedAt)),
    text(value.updatedAt),
    text(value.importedAt),
  ]
    .map((item) => new Date(item))
    .filter((item) => !Number.isNaN(item.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  const occurredAt = validDate(timestamps[0]?.toISOString(), fallback);
  return {
    legacyId: `question:${fingerprint}`,
    targetSlug,
    targetTopicId: null,
    discipline,
    topic: text(value.lesson) || 'Questoes importadas',
    eventKind: 'questions',
    occurredAt,
    sourceDate: occurredAt.slice(0, 10),
    questionsDone: attempts.length,
    correctCount: attempts.filter((attempt) => attempt.isCorrect === true).length,
    wrongCount: attempts.filter((attempt) => attempt.isCorrect === false).length,
    doubtCount: doubt ? 1 : 0,
    favoriteCount: favorite ? 1 : 0,
    sourceLabel: text(value.sourceName) || 'Banco local',
    banca: text(value.bank),
    tags: Array.isArray(value.tags) ? value.tags.map(text).filter(Boolean) : [],
  };
};

export function buildLegacyBrowserBundle(
  storage: LegacyStorageReader,
  now: Date,
): LegacyBrowserBundlePayload {
  if (Number.isNaN(now.getTime())) throw new TypeError('Migration time must be valid');
  const parsedProfiles = parseStudyTargetProfileTable(storage.getItem(PROFILES_KEY) || '')
    .filter((profile) => SUPPORTED_TARGETS.has(profile.slug));
  const storedTarget = supportedTarget(storage.getItem(TARGET_KEY));
  const activeTargetSlug = storedTarget
    || parsedProfiles.find((profile) => profile.active)?.slug
    || 'bacen_economia_financas';
  const storedPhase = text(storage.getItem(PHASE_KEY));
  const profileMap = new Map(parsedProfiles.map((profile) => [profile.slug, profile]));
  const targetProfiles = parsedProfiles.map((profile) => (
    profilePayload(profile, activeTargetSlug, storedPhase)
  ));
  const coverageRows = parseStudyCoverageTable(storage.getItem(COVERAGE_KEY) || '')
    .map((row) => coveragePayload(row, activeTargetSlug, profileMap))
    .filter((row): row is LegacyCoveragePayload => row !== null);
  const lsTasks = parseArray(storage.getItem(LS_TASKS_KEY))
    .map((task) => taskPayload(task as PlannerTask, activeTargetSlug))
    .filter((task): task is LegacyLsTaskPayload => task !== null);
  const sourceSignals = parseStudySourceTable(storage.getItem(SOURCE_SIGNALS_KEY) || '')
    .map((item) => sourcePayload(item, activeTargetSlug, profileMap))
    .filter((item): item is LegacySourceSignalPayload => item !== null);
  const seenLearningIds = new Set<string>();
  const learningItems = parseArray(storage.getItem(QUESTION_BANK_KEY))
    .map((item) => learningPayload(item as QuestionBankItem, now))
    .filter((item): item is LegacyLearningPayload => item !== null)
    .filter((item) => {
      if (seenLearningIds.has(item.legacyId)) return false;
      seenLearningIds.add(item.legacyId);
      return true;
    });
  const safeContent = {
    activeTargetSlug,
    targetProfiles,
    coverageRows,
    lsTasks,
    sourceSignals,
    learningItems,
  };
  return {
    schema: 'study-os.browser-migration.v1',
    migrationId: `browser-${stableHash(safeContent)}`,
    exportedAt: now.toISOString(),
    ...safeContent,
  };
}

export function hasLegacyBrowserMetadata(storage: LegacyStorageReader): boolean {
  if (MIGRATED_STUDY_OS_KEYS.some((key) => Boolean(storage.getItem(key)?.trim()))) {
    return true;
  }
  return parseArray(storage.getItem(LS_TASKS_KEY)).length > 0
    || parseArray(storage.getItem(QUESTION_BANK_KEY)).length > 0;
}

export function clearMigratedStudyOsKeys(
  storage: LegacyStorageCleaner,
): string[] {
  MIGRATED_STUDY_OS_KEYS.forEach((key) => storage.removeItem(key));
  return [...MIGRATED_STUDY_OS_KEYS];
}
