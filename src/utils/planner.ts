import { PlannerMetaSummary, PlannerTask, PlannerTaskSource, PlannerTaskStatus } from '../types';

export interface ParsedLsMeta {
  meta: PlannerMetaSummary;
  tasks: PlannerTask[];
}

export interface MonthDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface AutoScheduleConfig {
  maxTasksPerDay: number;
  maxMinutesPerDay: number;
  startTime: string;
  availableWeekdays: number[];
  monthDate: Date;
  startDate?: Date;
}

export type PlannerTaskResultOutcome = 'started' | 'completed' | 'failed' | 'skipped';

export interface PlannerTaskResultInput {
  outcome: PlannerTaskResultOutcome;
  performance?: number | null;
  spentMinutes?: number;
}

export interface PlannerTaskChatPromptOptions {
  targetName?: string;
  organizer?: string;
  phase?: string;
}

export interface PlannerTodayCommandCenter {
  date: string;
  tasks: PlannerTask[];
  totalTasks: number;
  visibleTasks: number;
  overflowCount: number;
  completedTasks: number;
  openTasks: number;
  totalMinutes: number;
  nextTask?: PlannerTask;
}

export interface ReplacePendingGeneratedStudyOsTasksOptions {
  targetSlug: string;
  scheduledDates: string[];
}

const TASK_FORMATS = [
  'Revisão e Exercícios',
  'Teórico e Exercícios',
  'Teórico ou Exercícios',
  'Material Complementar',
  'Exercícios',
  'Simulados',
  'Lei Seca',
  'Revisão',
  'Teórico',
];

const STATUS_MAP: Record<string, PlannerTaskStatus> = {
  pendente: 'pending',
  concluido: 'completed',
  concluida: 'completed',
  iniciado: 'started',
  iniciada: 'started',
  ignorado: 'ignored',
  ignorada: 'ignored',
  ignoradas: 'ignored',
  arquivado: 'archived',
  arquivada: 'archived',
  arquivadas: 'archived',
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

const toInt = (value: string | undefined, fallback = 0) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizePerformance = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(clampNumber(value, 0, 100));
};

const sanitizeSpentMinutes = (value: number | undefined, fallback: number) => {
  if (value === undefined || !Number.isFinite(value)) return Math.max(0, Math.round(fallback));
  return Math.max(0, Math.round(value));
};

export const toIsoDate = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const year = copy.getFullYear();
  const month = `${copy.getMonth() + 1}`.padStart(2, '0');
  const day = `${copy.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const parseDurationToMinutes = (value: string | undefined) => {
  if (!value) return 0;
  const match = value.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const formatMinutes = (minutes: number) => {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
};

export const addMinutesToTime = (time: string, minutes: number) => {
  const [hours, mins] = time.split(':').map(Number);
  const total = Math.max(0, (hours || 0) * 60 + (mins || 0) + minutes);
  const nextHours = Math.floor(total / 60) % 24;
  const nextMins = total % 60;
  return `${String(nextHours).padStart(2, '0')}:${String(nextMins).padStart(2, '0')}`;
};

export const applyPlannerTaskResult = (
  task: PlannerTask,
  result: PlannerTaskResultInput,
  now = new Date().toISOString(),
): PlannerTask => {
  if (result.outcome === 'started') {
    return {
      ...task,
      status: 'started',
      spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes),
      updatedAt: now,
    };
  }

  if (result.outcome === 'skipped') {
    return {
      ...task,
      status: 'ignored',
      performance: null,
      spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes),
      updatedAt: now,
    };
  }

  return {
    ...task,
    status: 'completed',
    performance: sanitizePerformance(result.outcome === 'failed' ? result.performance ?? 0 : result.performance),
    spentMinutes: sanitizeSpentMinutes(result.spentMinutes, task.spentMinutes),
    updatedAt: now,
  };
};

const extractDetailValue = (details: string | undefined, label: string) => {
  if (!details) return undefined;
  const match = details.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim();
};

const summarizePromptLines = (value: string | undefined, maxLines = 8) => {
  if (!value) return [];
  return value
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, maxLines);
};

const hasLowTrustPlannerSource = (task: PlannerTask) => {
  const sourceText = `${task.format}\n${task.description}\n${task.details || ''}\n${task.tips || ''}`;
  const normalized = normalize(sourceText);
  return normalized.includes('dicas') || normalized.includes('bizus');
};

export const buildPlannerTaskChatPrompt = (task: PlannerTask, options: PlannerTaskChatPromptOptions = {}) => {
  const target = options.targetName || task.targetSlug || extractDetailValue(task.details, 'Target') || task.planejamento || 'target atual';
  const source = task.materialHint || extractDetailValue(task.details, 'Fonte') || task.source;
  const score = task.scoreBreakdown?.finalScore ?? extractDetailValue(task.details, 'Score');
  const schedule = [task.scheduledDate, task.startTime].filter(Boolean).join(' ');
  const structuredLines = [
    task.plannerSourceKind ? `Camada de origem: ${task.plannerSourceKind}` : '',
    task.plannedBlockKind ? `Tipo planejado: ${task.plannedBlockKind}` : '',
    task.plannedQuestions ? `Volume planejado: ${task.plannedQuestions} questões` : '',
    task.originTaskId ? `Origem vinculada: ${task.originTaskId}` : '',
    ...(task.sourceReason || []),
  ].filter(Boolean);
  const detailLines = [
    ...structuredLines,
    ...summarizePromptLines(task.details).filter((line) => !/^(target|fonte|score)\s*:/i.test(line)),
  ].slice(0, 12);
  const lowTrustWarning = hasLowTrustPlannerSource(task)
    ? '\n- Dicas e Bizus aparecem como apoio de baixo grau de confiança: use apenas para checagem rápida e valide contra o material original.'
    : '';

  return `---
ATUAÇÃO: Tutor especialista em concursos, focado em execução de estudo.
OBJETIVO: me ajudar a executar este bloco com o menor atrito possível, sem trocar o plano do Study OS.

CONTEXTO DO TARGET
- Target: ${target}
- Banca/organizador: ${options.organizer || 'não informado'}
- Fase: ${options.phase || 'não informada'}

TAREFA DE AGORA
- Disciplina: ${task.discipline}
- Bloco: ${task.format}
- Tipo Study OS: ${task.plannedBlockKind || 'não estruturado'}
- Tema: ${task.description}
- Duração planejada: ${formatMinutes(task.durationMinutes)}
- Questões planejadas: ${task.plannedQuestions ? `${task.plannedQuestions} questões` : 'não se aplica'}
- Agenda: ${schedule || 'não agendada'}
- Fonte principal: ${source}
- Score do planner: ${score || task.relevance}
- Desempenho registrado: ${task.performance === null ? 'sem registro' : `${task.performance}%`}
${lowTrustWarning}

NOTAS DO PLANNER
${detailLines.length > 0 ? detailLines.map((line) => `- ${line}`).join('\n') : '- Sem notas adicionais.'}

INSTRUÇÕES
1. Monte um plano de execução objetivo para este bloco, com ordem de ataque e tempo por etapa.
2. Se for bloco de teoria/releitura, diga exatamente o que devo procurar no material original e como transformar isso em revisão ativa.
3. Se for bloco de questões TEC, não reproduza questões proprietárias; use apenas meus resultados, assuntos e erros que eu informar.
4. Se for revisão de erros, comece por causa provável do erro, regra/conceito central, pegadinha de banca e um mini-teste de validação.
5. Não invente edital, incidência, jurisprudência, lei, gabarito ou conteúdo que eu não tenha fornecido. Quando faltar material, me peça o trecho.

SAÍDA ESPERADA
- Plano de execução em até 6 passos.
- Lista curta do que eu devo abrir agora.
- Critério simples para eu marcar o bloco como concluído, falhei ou precisa voltar no refresh.
---`;
};

const scheduledTaskSort = (left: PlannerTask, right: PlannerTask) => {
  const leftTime = left.startTime || '99:99';
  const rightTime = right.startTime || '99:99';
  return leftTime.localeCompare(rightTime) || left.number - right.number || left.description.localeCompare(right.description);
};

const isOpenPlannerTask = (task: PlannerTask) => task.status === 'pending' || task.status === 'started';

export const getPlannerTodayCommandCenter = (
  tasks: PlannerTask[],
  date = new Date(),
  limit = 4,
): PlannerTodayCommandCenter => {
  const today = toIsoDate(date);
  const todayTasks = tasks
    .filter((task) => task.status !== 'archived' && task.scheduledDate === today)
    .sort(scheduledTaskSort);
  const safeLimit = Math.max(1, Math.round(limit));

  return {
    date: today,
    tasks: todayTasks.slice(0, safeLimit),
    totalTasks: todayTasks.length,
    visibleTasks: Math.min(todayTasks.length, safeLimit),
    overflowCount: Math.max(0, todayTasks.length - safeLimit),
    completedTasks: todayTasks.filter((task) => task.status === 'completed').length,
    openTasks: todayTasks.filter(isOpenPlannerTask).length,
    totalMinutes: todayTasks.reduce((sum, task) => sum + task.durationMinutes, 0),
    nextTask: todayTasks.find(isOpenPlannerTask),
  };
};

const findFirstFormat = (line: string) => {
  return TASK_FORMATS
    .map((format) => ({ format, index: line.indexOf(` ${format} `) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
};

const extractMetaNumber = (text: string) => {
  const currentMetaMatch = text.match(/Meta\s+\d+\s*\(#?(\d+)\)/i);
  if (currentMetaMatch) return Number(currentMetaMatch[1]);

  const pdfMetaNumbers = Array.from(text.matchAll(/^\s*META\s+(\d{1,4})\s*$/gim))
    .map((candidate) => Number(candidate[1]))
    .filter((value) => Number.isFinite(value));

  if (pdfMetaNumbers.length > 0) return Math.max(...pdfMetaNumbers);

  const hashMatch = text.match(/#(\d{1,4})/);
  return hashMatch ? Number(hashMatch[1]) : undefined;
};

const extractMetaTitle = (text: string, metaNumber?: number) => {
  const match = text.match(/Meta atual\s*\|\s*(Meta\s+\d+\s*\(#?\d+\))/i);
  if (match) return match[1].replace(/\(#?(\d+)\)/, '(#$1)').trim();
  return metaNumber ? `Meta (#${metaNumber})` : 'Meta Atual';
};

const extractPlanning = (text: string) => {
  const match = text.match(/Planejamento\s+(?!\|)([^\n]+)/i);
  if (!match) return undefined;
  return match[1].replace(/\s+/g, ' ').trim();
};

const extractFirstNumberAfterLabel = (text: string, label: RegExp, fallback = 0) => {
  const match = text.match(label);
  return toInt(match?.[1], fallback);
};

const extractDateAfterLabel = (text: string, label: RegExp) => {
  const match = text.match(label);
  return match?.[1];
};

const parseStatus = (value: string): PlannerTaskStatus => {
  return STATUS_MAP[normalize(value)] || 'pending';
};

const createTaskId = (metaNumber: number | undefined, number: number, line: string) => {
  let hash = 2166136261;
  for (let index = 0; index < line.length; index += 1) {
    hash ^= line.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `planner_${metaNumber || 'meta'}_${number}_${(hash >>> 0).toString(36)}`;
};

const cleanPdfChrome = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => {
      if (!line) return false;
      if (/^\[Pagina\s+\d+\]$/i.test(line)) return false;
      if (/^\.$/.test(line)) return false;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) return false;
      if (/^META\s+\d+\s*(?:\(.+\))?$/i.test(line)) return false;
      if (/^JOAO NAVARRO\b/i.test(line)) return false;
      if (/^\d{1,4}$/.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const extractFirstLineAfter = (block: string, label: RegExp) => {
  const match = block.match(label);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
};

const findTipsStart = (body: string) => {
  const markers = [
    /^ART\.\s*\d/im,
    /^ALERTAS DE PROVA/im,
    /^ONDE A FCC/im,
    /^Vamos dar continuidade/im,
    /^Isenções e Disposições Gerais/im,
    /^Regras Gerais e o Papel/im,
    /^Ponto Vital:/im,
    /^Preste Atenção:/im,
    /^Regra de Ouro:/im,
  ];

  return markers
    .map((marker) => body.search(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
};

const inferDetailedTaskFormat = (subject: string, block: string) => {
  const subjectFormat = subject.match(/\(([^)]+)\)\s*$/u)?.[1]?.trim();
  if (/quest(?:ões|oes)|exerc[ií]cios?/iu.test(block) && subjectFormat) return `${subjectFormat} e Exercícios`;
  if (subjectFormat) return subjectFormat;
  if (/quest(?:ões|oes)|exerc[ií]cios?/iu.test(block)) return 'Exercícios';
  return 'Tarefa LS';
};

const parseDetailedTaskSections = (
  text: string,
  metaNumber: number | undefined,
  planejamento: string | undefined,
  source: PlannerTaskSource
) => {
  const normalizedText = text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const starts = Array.from(
    normalizedText.matchAll(/(?:^|\n)\s*(?:\.\s*\n\s*)?(\d{1,3})\)\s+([^\n]+?)\s*\n\s*Material indicado:/giu)
  ).map((match) => ({
    start: match.index ?? 0,
    number: Number(match[1]),
    discipline: match[2].replace(/\s+/g, ' ').trim(),
  }));

  if (starts.length === 0) return [];

  const now = new Date().toISOString();

  return starts
    .map((start, index) => {
      const nextStart = starts[index + 1]?.start ?? normalizedText.length;
      const rawBlock = normalizedText.slice(start.start, nextStart).trim();
      const material = extractFirstLineAfter(rawBlock, /Material indicado:\s*([^\n]+)/i);
      const subject =
        extractFirstLineAfter(rawBlock, /Assunto\(s\):\s*([^\n]+)/i) ||
        extractFirstLineAfter(rawBlock, /\nAssuntos:\s*\n([^\n]+)/i) ||
        `Tarefa ${start.number}`;
      const relevanceMatch = rawBlock.match(/Relevância:\s*(\d{1,2})/i);
      const relevance = relevanceMatch ? Number(relevanceMatch[1]) : 5;
      const durationMatch = rawBlock.match(/tempo ideal:\s*(\d{1,3})\s*minutos/i);
      const durationMinutes = durationMatch ? Number(durationMatch[1]) : 60;
      const headerEndIndex =
        relevanceMatch?.index !== undefined ? relevanceMatch.index + relevanceMatch[0].length : rawBlock.indexOf(subject) + subject.length;
      const body = rawBlock.slice(Math.max(0, headerEndIndex));
      const tipsStart = findTipsStart(body);
      const detailsBody = tipsStart === undefined ? body : body.slice(0, tipsStart);
      const tipsBody = tipsStart === undefined ? '' : body.slice(tipsStart);
      const details = cleanPdfChrome([material ? `Material indicado: ${material}` : '', detailsBody].filter(Boolean).join('\n'));
      const tips = cleanPdfChrome(tipsBody);
      const seed = `${start.number} ${start.discipline} ${subject}`;

      return {
        id: createTaskId(metaNumber, start.number, seed),
        number: start.number,
        metaNumber,
        planejamento,
        discipline: start.discipline,
        format: inferDetailedTaskFormat(subject, rawBlock),
        description: subject,
        details: details || undefined,
        tips: tips || undefined,
        spentMinutes: 0,
        estimatedMinutes: durationMinutes,
        performance: null,
        status: 'pending',
        relevance: Number.isFinite(relevance) ? relevance : 5,
        durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 60,
        source,
        createdAt: now,
        updatedAt: now,
      } satisfies PlannerTask;
    })
    .filter((task) => task.discipline && task.description);
};

const mergeDetailedTaskSections = (tableTasks: PlannerTask[], detailedTasks: PlannerTask[]) => {
  if (detailedTasks.length === 0) return tableTasks;
  if (tableTasks.length === 0) return detailedTasks;

  const detailedByNumber = new Map(detailedTasks.map((task) => [task.number, task]));
  const merged = tableTasks.map((task) => {
    const detailed = detailedByNumber.get(task.number);
    if (!detailed) return task;
    detailedByNumber.delete(task.number);

    return {
      ...task,
      description: detailed.description || task.description,
      details: detailed.details || task.details,
      tips: detailed.tips || task.tips,
      relevance: detailed.relevance || task.relevance,
      durationMinutes: task.durationMinutes || detailed.durationMinutes,
      estimatedMinutes: task.estimatedMinutes || detailed.estimatedMinutes,
      updatedAt: new Date().toISOString(),
    };
  });

  return [...merged, ...Array.from(detailedByNumber.values())].sort((a, b) => a.number - b.number);
};

const parseTaskLine = (
  line: string,
  metaNumber: number | undefined,
  planejamento: string | undefined,
  source: PlannerTaskSource
): PlannerTask | null => {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  const numberMatch = trimmed.match(/^(\d{1,3})\s+/);
  if (!numberMatch) return null;

  const number = Number(numberMatch[1]);
  const withoutNumber = trimmed.slice(numberMatch[0].length);
  const formatHit = findFirstFormat(` ${withoutNumber} `);
  if (!formatHit) return null;

  const format = formatHit.format;
  const formatIndex = withoutNumber.indexOf(format);
  const discipline = withoutNumber.slice(0, formatIndex).trim();
  const tail = withoutNumber.slice(formatIndex + format.length).trim();
  const tailMatch = tail.match(/(.+?)\s+(\d{1,2}:\d{2})\s+(\d{1,3})%\s+([A-Za-zÀ-ÿ]+)\b(?:.*?)(\d{1,2})$/u);
  if (!discipline || !tailMatch) return null;

  const spentMinutes = parseDurationToMinutes(tailMatch[2]);
  const relevance = Number(tailMatch[5]);
  const now = new Date().toISOString();

  return {
    id: createTaskId(metaNumber, number, trimmed),
    number,
    metaNumber,
    planejamento,
    discipline,
    format,
    description: tailMatch[1].trim(),
    spentMinutes,
    estimatedMinutes: spentMinutes || 60,
    performance: Number(tailMatch[3]),
    status: parseStatus(tailMatch[4]),
    relevance: Number.isFinite(relevance) ? relevance : 5,
    durationMinutes: spentMinutes || 60,
    source,
    createdAt: now,
    updatedAt: now,
  } satisfies PlannerTask;
};

export const parseLsMetaText = (text: string, source: PlannerTaskSource = 'ls-meta-text'): ParsedLsMeta => {
  const normalizedText = text.replace(/\r\n?/g, '\n');
  const metaNumber = extractMetaNumber(normalizedText);
  const planejamento = extractPlanning(normalizedText);
  const importedAt = new Date().toISOString();

  const tableTasks = normalizedText
    .split('\n')
    .map((line) => parseTaskLine(line, metaNumber, planejamento, source))
    .filter((task): task is PlannerTask => task !== null);
  const detailedTasks = parseDetailedTaskSections(normalizedText, metaNumber, planejamento, source);
  const tasks = mergeDetailedTaskSections(tableTasks, detailedTasks);

  const completedTasks = extractFirstNumberAfterLabel(normalizedText, /Tarefas Conclu[ií]das\s+(\d+)/i, tasks.filter((task) => task.status === 'completed').length);
  const pendingTasks = extractFirstNumberAfterLabel(normalizedText, /Tarefas Pendentes\s+(\d+)/i, tasks.filter((task) => task.status === 'pending').length);
  const ignoredTasks = extractFirstNumberAfterLabel(normalizedText, /Tarefas Ignoradas\s+(\d+)/i, tasks.filter((task) => task.status === 'ignored').length);
  const startedTasks = extractFirstNumberAfterLabel(normalizedText, /Tarefas Iniciadas\s+(\d+)/i, tasks.filter((task) => task.status === 'started').length);
  const totalTasks = extractFirstNumberAfterLabel(normalizedText, /Total de Tarefas\s+(\d+)/i, tasks.length);
  const totalDisciplines = extractFirstNumberAfterLabel(normalizedText, /Quantidade de Mat[eé]rias\s+(\d+)/i, new Set(tasks.map((task) => task.discipline)).size);
  const completedPercent = extractFirstNumberAfterLabel(normalizedText, /Meta Conclu[ií]da\(%\)\s+(\d+)%/i, totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0);

  return {
    meta: {
      id: `meta_${metaNumber || Date.now()}`,
      title: extractMetaTitle(normalizedText, metaNumber),
      planejamento,
      metaNumber,
      totalTasks,
      totalDisciplines,
      completedPercent,
      completedTasks,
      pendingTasks,
      ignoredTasks,
      startedTasks,
      startedAt: extractDateAfterLabel(normalizedText, /meta iniciada em\s+(\d{2}\/\d{2}\/\d{4})/i),
      nextMetaAt: extractDateAfterLabel(normalizedText, /Pr[oó]xima meta\s+(\d{2}\/\d{2}\/\d{4})/i),
      importedAt,
    },
    tasks,
  };
};

const getPlannerTaskMergeKey = (task: PlannerTask) =>
  task.metaNumber !== undefined ? `meta:${task.metaNumber}:task:${task.number}` : `id:${task.id}`;

export const mergePlannerTasks = (existing: PlannerTask[], incoming: PlannerTask[]) => {
  const byId = new Map(existing.map((task) => [task.id, task]));
  const existingByNaturalKey = new Map(existing.map((task) => [getPlannerTaskMergeKey(task), task]));

  incoming.forEach((task) => {
    const previous = byId.get(task.id) || existingByNaturalKey.get(getPlannerTaskMergeKey(task));
    const merged = previous ? {
      ...task,
      id: previous.id,
      scheduledDate: previous.scheduledDate ?? task.scheduledDate,
      startTime: previous.startTime ?? task.startTime,
      linkedStudyTaskId: previous.linkedStudyTaskId ?? task.linkedStudyTaskId,
    } : task;

    byId.set(merged.id, merged);
  });

  return Array.from(byId.values()).sort((a, b) => a.number - b.number);
};

export const replacePendingGeneratedStudyOsTasks = (
  existing: PlannerTask[],
  incoming: PlannerTask[],
  { targetSlug, scheduledDates }: ReplacePendingGeneratedStudyOsTasksOptions,
) => {
  const datesToReplace = new Set(scheduledDates);
  const retained = existing.filter((task) => !(
    task.plannerSourceKind === 'generated_planner' &&
    task.targetSlug === targetSlug &&
    task.status === 'pending' &&
    task.scheduledDate !== undefined &&
    datesToReplace.has(task.scheduledDate)
  ));

  return [...retained, ...incoming];
};

export const shouldReplacePlannerMetaWithStudyOs = (metaSummary: PlannerMetaSummary | null | undefined) =>
  !metaSummary || metaSummary.id.startsWith('study_os_');

export const buildMonthGrid = (monthDate: Date): MonthDay[] => {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const today = toIsoDate(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = toIsoDate(date);
    return {
      date: iso,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
      isToday: iso === today,
    };
  });
};

export const startOfWeek = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
};

export const buildWeekDays = (weekDate: Date) => {
  const start = startOfWeek(weekDate);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: toIsoDate(date),
      label: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][index],
      dayNumber: date.getDate(),
    };
  });
};

export const autoSchedulePlannerTasks = (tasks: PlannerTask[], config: AutoScheduleConfig) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requestedStart = config.startDate ? new Date(config.startDate) : today;
  requestedStart.setHours(0, 0, 0, 0);
  const firstOfMonth = new Date(config.monthDate.getFullYear(), config.monthDate.getMonth(), 1);
  const minScheduleDate =
    requestedStart.getFullYear() === config.monthDate.getFullYear() &&
    requestedStart.getMonth() === config.monthDate.getMonth()
      ? requestedStart
      : firstOfMonth;
  const monthDays = buildMonthGrid(config.monthDate).filter((day) => {
    const date = new Date(`${day.date}T00:00:00`);
    return day.isCurrentMonth && date >= minScheduleDate && config.availableWeekdays.includes(date.getDay());
  });

  const dayLoad = new Map<string, { tasks: number; minutes: number }>();
  tasks.forEach((task) => {
    if (!task.scheduledDate) return;
    const current = dayLoad.get(task.scheduledDate) || { tasks: 0, minutes: 0 };
    dayLoad.set(task.scheduledDate, {
      tasks: current.tasks + 1,
      minutes: current.minutes + task.durationMinutes,
    });
  });

  const pending = [...tasks]
    .filter((task) => !task.scheduledDate && task.status !== 'completed' && task.status !== 'ignored' && task.status !== 'archived')
    .sort((a, b) => b.relevance - a.relevance || a.number - b.number);

  const scheduled = new Map<string, PlannerTask>();

  for (const task of pending) {
    const targetDay = monthDays.find((day) => {
      const load = dayLoad.get(day.date) || { tasks: 0, minutes: 0 };
      return load.tasks < config.maxTasksPerDay && load.minutes + task.durationMinutes <= config.maxMinutesPerDay;
    });

    if (!targetDay) continue;

    const load = dayLoad.get(targetDay.date) || { tasks: 0, minutes: 0 };
    scheduled.set(task.id, {
      ...task,
      scheduledDate: targetDay.date,
      startTime: addMinutesToTime(config.startTime, load.minutes),
      updatedAt: new Date().toISOString(),
    });
    dayLoad.set(targetDay.date, {
      tasks: load.tasks + 1,
      minutes: load.minutes + task.durationMinutes,
    });
  }

  return tasks.map((task) => scheduled.get(task.id) || task);
};
