import { ActivityBlock, StudyTask } from '../types';
import { DISCIPLINAS } from './constants';
import { DEFAULT_ACTIVITY_LAYOUT } from './layout';
import { parseLSTask } from './parser';

export type MetaTaskStatus = 'pendente' | 'concluido' | 'iniciado' | 'ignorado' | 'desconhecido';

export interface MetaTaskDraft {
  id: string;
  numero: string;
  discipline: string;
  formato: string;
  descricao: string;
  tempoEstimadoMinutos?: number;
  statusOrigem: MetaTaskStatus;
  rawText: string;
  blocks: ActivityBlock[];
  warnings: string[];
}

export interface MetaParseLine {
  index: number;
  text: string;
  reason: string;
}

export interface MetaParseResult {
  drafts: MetaTaskDraft[];
  ignoredLines: MetaParseLine[];
  warnings: string[];
  summary: {
    totalTasks: number;
    totalEstimatedMinutes: number;
    disciplines: string[];
    formatos: string[];
  };
}

export interface CreateTasksFromMetaDraftsOptions {
  planejamento?: string;
  meta?: string;
  bank: string;
  selectedDraftIds?: string[];
  now?: string;
  idFactory?: () => string;
}

const MAIN_ACTIVITY_BOUNDARY = /\s+Atividade\s+Extra\s*(?:\([^)]*\))?\s*[-:]/i;

const FORMATS = [
  'Revisão e Exercícios',
  'Teórico e Exercícios',
  'Lei seca e exercícios',
  'Revisão',
  'Exercícios',
  'Teórico',
  'Outros'
];

const normalizeSpaces = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripDiacritics = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const comparable = (value: string): string =>
  stripDiacritics(normalizeSpaces(value)).toLowerCase();

const createId = (prefix: string): string => {
  const randomId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${randomId}`;
};

const parseDuration = (value: string): number | undefined => {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
};

const parseStatus = (value: string): MetaTaskStatus => {
  const normalized = comparable(value);
  if (/\bconcluid[ao]\b/.test(normalized)) return 'concluido';
  if (/\bpendente\b/.test(normalized)) return 'pendente';
  if (/\biniciad[ao]\b/.test(normalized)) return 'iniciado';
  if (/\bignorada?s?\b/.test(normalized)) return 'ignorado';
  return 'desconhecido';
};

const findDiscipline = (content: string): string => {
  const normalizedContent = comparable(content);
  const sortedDisciplines = [...DISCIPLINAS].sort((a, b) => b.length - a.length);
  return sortedDisciplines.find(discipline => normalizedContent.startsWith(comparable(discipline))) || '';
};

const findFormat = (content: string): { formato: string; index: number; length: number } | null => {
  const normalizedContent = comparable(content);
  const matches = FORMATS
    .map(format => ({
      formato: format,
      index: normalizedContent.indexOf(comparable(format)),
      length: format.length
    }))
    .filter(match => match.index >= 0)
    .sort((a, b) => a.index - b.index || b.length - a.length);

  return matches[0] || null;
};

const splitRows = (text: string): { index: number; text: string }[] => {
  const rows: { index: number; text: string }[] = [];
  let current: { index: number; text: string } | null = null;

  text.split(/\r?\n/).forEach((rawLine, rawIndex) => {
    const line = normalizeSpaces(rawLine);
    if (!line) return;

    if (/^\d+\s+/.test(line)) {
      if (current) rows.push(current);
      current = { index: rawIndex + 1, text: line };
      return;
    }

    if (current && !/\d{1,2}:\d{2}/.test(current.text)) {
      const previousToken = current.text.match(/([a-záéíóúâêôãõç]{1,5})$/i)?.[1] || '';
      const continuationToken = line.match(/^([a-záéíóúâêôãõç]{1,5})/i)?.[1] || '';
      const splitLooksLikeWord = previousToken.length >= 3
        && continuationToken.length >= 3
        && !/\b(?:de|da|do|das|dos|e|em|para|por|com|sem)$/i.test(previousToken);
      const separator = splitLooksLikeWord ? '' : ' ';
      current.text = `${current.text}${separator}${line}`;
      return;
    }

    rows.push({ index: rawIndex + 1, text: line });
  });

  if (current) rows.push(current);
  return rows;
};

const parseRow = (rowText: string): Omit<MetaTaskDraft, 'id'> | null => {
  const numberMatch = rowText.match(/^(\d+)\s+(.+)$/);
  if (!numberMatch) return null;

  const numero = numberMatch[1];
  const content = normalizeSpaces(numberMatch[2]);
  const discipline = findDiscipline(content);
  if (!discipline) return null;

  const afterDiscipline = normalizeSpaces(content.slice(discipline.length));
  const formatMatch = findFormat(afterDiscipline);
  if (!formatMatch) return null;

  const formato = formatMatch.formato;
  const afterFormat = normalizeSpaces(afterDiscipline.slice(formatMatch.index + formatMatch.length));
  const timeMatch = afterFormat.match(/\b\d{1,2}:\d{2}\b/);
  const descriptionEnd = timeMatch ? timeMatch.index || 0 : afterFormat.length;
  const descricao = normalizeSpaces(afterFormat.slice(0, descriptionEnd).replace(/\s+\d+%\s*$/, ''));
  const tail = timeMatch ? afterFormat.slice(timeMatch.index || 0) : '';
  const tempoEstimadoMinutos = parseDuration(tail);
  const statusOrigem = parseStatus(tail || afterFormat);
  const warnings: string[] = [];

  if (!descricao) warnings.push('Descrição não detectada.');
  if (tempoEstimadoMinutos === undefined) warnings.push('Tempo estimado não detectado.');
  if (statusOrigem === 'desconhecido') warnings.push('Status de origem não detectado.');

  const parsedBlocks = parseLSTask(rowText).filter(block => !block.isSection);
  const blocks = parsedBlocks.length > 0
    ? parsedBlocks
    : [{
      id: createId('meta-block'),
      title: formato,
      lesson: descricao || discipline,
      pages: '',
      bank: '',
      questions: [],
      layout: DEFAULT_ACTIVITY_LAYOUT
    }];

  return {
    numero,
    discipline,
    formato,
    descricao,
    tempoEstimadoMinutos,
    statusOrigem,
    rawText: rowText,
    blocks,
    warnings
  };
};

const inferDetailedFormat = (content: string): string => {
  const mainContent = content.split(MAIN_ACTIVITY_BOUNDARY)[0] || content;
  const normalized = comparable(mainContent);
  const hasTheory = /\bestude\b.*\bteoria\b/.test(normalized) || /\bmaterial indicado\b/.test(normalized);
  const hasQuestions = /\bresolva\b.*\bquest/.test(normalized) || /\bresolucao de quest/.test(normalized);
  const hasRevision = /\brevis/.test(normalized);
  const hasLeiSeca = /\blei seca\b/.test(normalized);

  if (hasLeiSeca && hasQuestions) return 'Lei seca e exercícios';
  if ((hasTheory || hasRevision) && hasQuestions) return hasRevision ? 'Revisão e Exercícios' : 'Teórico e Exercícios';
  if (hasQuestions) return 'Exercícios';
  if (hasRevision) return 'Revisão';
  if (hasTheory) return 'Teórico';
  return 'Outros';
};

const parseDetailedDuration = (content: string): number | undefined => {
  const mainContent = content.split(MAIN_ACTIVITY_BOUNDARY)[0] || content;
  const durations: number[] = [];
  const durationRegex = /(?:tempo ideal(?:\s+de\s+resolu[cç][aã]o)?|estimativa\s+de\s+tempo)\D{0,40}(\d{1,3})\s*minutos/gi;
  let match: RegExpExecArray | null;

  while ((match = durationRegex.exec(mainContent)) !== null) {
    durations.push(parseInt(match[1], 10));
  }

  if (durations.length === 0) return undefined;
  return durations.reduce((total, duration) => total + duration, 0);
};

export const isDraftSelectedByDefault = (draft: MetaTaskDraft): boolean =>
  draft.statusOrigem !== 'concluido' && draft.statusOrigem !== 'ignorado';

const parseDetailedDescription = (content: string, discipline: string): string => {
  const assuntoMatch = content.match(/Assunto\(s\):\s*(.+?)(?:\s+Assuntos?:\s|\s+ATENÇÃO:|\s+Orienta[cç][oõ]es|\s+Atividade\s+\d|\s+Quadro\s+de|\s+META\s+\d|$)/i);
  if (assuntoMatch?.[1]) {
    return normalizeSpaces(assuntoMatch[1]);
  }

  const beforeActivity = content.split(/\s+Atividade\s+\d/i)[0] || '';
  return normalizeSpaces(beforeActivity.replace(/^Material indicado:.+?(?:\.|$)/i, '')) || discipline;
};

const prepareDetailedTextForTaskParser = (content: string): string =>
  content
    .replace(/\s+(Atividade\s+(?:Alternativa|Extra)?(?:\s*\([^)]*\))?\s*[-:]?)/gi, '\n$1')
    .replace(/\s+(Resolva\s+(?:a|as)\s+quest)/gi, '\n$1')
    .replace(/\s+(Sugestão de descanso)/gi, '\n$1');

const parseDetailedSection = (
  numero: string,
  discipline: string,
  content: string
): Omit<MetaTaskDraft, 'id'> => {
  const descricao = parseDetailedDescription(content, discipline);
  const formato = inferDetailedFormat(content);
  const tempoEstimadoMinutos = parseDetailedDuration(content);
  const warnings: string[] = [];

  if (!descricao) warnings.push('Descrição não detectada.');
  if (tempoEstimadoMinutos === undefined) warnings.push('Tempo estimado não detectado.');

  const parsedBlocks = parseLSTask(prepareDetailedTextForTaskParser(content));
  const blocks = parsedBlocks.filter(block => !block.isSection).length > 0
    ? parsedBlocks
    : [{
      id: createId('meta-block'),
      title: formato,
      lesson: descricao || discipline,
      pages: '',
      bank: '',
      questions: [],
      layout: DEFAULT_ACTIVITY_LAYOUT
    }];

  return {
    numero,
    discipline,
    formato,
    descricao,
    tempoEstimadoMinutos,
    statusOrigem: 'desconhecido',
    rawText: normalizeSpaces(`${numero}) ${discipline} ${content}`),
    blocks,
    warnings
  };
};

const parseDetailedSections = (text: string): Array<Omit<MetaTaskDraft, 'id'>> => {
  const normalizedText = normalizeSpaces(text);
  const disciplinePattern = [...DISCIPLINAS]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  const sectionRegex = new RegExp(
    `(?:^|\\s|\\.\\s+)(\\d{1,2})\\)\\s+(${disciplinePattern})\\s+(.+?)(?=(?:\\s+\\.?\\s*\\d{1,2}\\)\\s+(?:${disciplinePattern})\\s+)|\\s+Relatando inconsistências|$)`,
    'gi'
  );
  const sections: Array<Omit<MetaTaskDraft, 'id'>> = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(normalizedText)) !== null) {
    const [, numero, discipline, content] = match;
    sections.push(parseDetailedSection(numero, discipline, content));
  }

  return sections;
};

export const parseMetaText = (text: string): MetaParseResult => {
  const drafts: MetaTaskDraft[] = [];
  const ignoredLines: MetaParseLine[] = [];
  const warnings: string[] = [];

  splitRows(text).forEach(row => {
    if (/^(n[uú]mero|disciplina|formato|descri[cç][aã]o|tempo|status)\b/i.test(row.text)) {
      ignoredLines.push({ index: row.index, text: row.text, reason: 'Cabeçalho da tabela.' });
      return;
    }

    const parsed = parseRow(row.text);
    if (!parsed) {
      ignoredLines.push({ index: row.index, text: row.text, reason: 'Não parece uma linha de tarefa da meta.' });
      return;
    }

    drafts.push({
      ...parsed,
      id: createId(`meta-${parsed.numero}`)
    });
  });

  parseDetailedSections(text).forEach(parsed => {
    const detailedDraft = {
      ...parsed,
      id: createId(`meta-${parsed.numero}`)
    };
    const existingIndex = drafts.findIndex(draft => draft.numero === parsed.numero);

    if (existingIndex >= 0) {
      const existing = drafts[existingIndex];
      const existingQuestionCount = existing.blocks.reduce((total, block) => total + block.questions.length, 0);
      const detailedQuestionCount = detailedDraft.blocks.reduce((total, block) => total + block.questions.length, 0);

      if (detailedDraft.blocks.length > existing.blocks.length || detailedQuestionCount > existingQuestionCount) {
        drafts[existingIndex] = { ...detailedDraft, id: existing.id };
      }
      return;
    }

    drafts.push(detailedDraft);
  });

  if (drafts.length === 0) {
    warnings.push('Nenhuma tarefa de meta foi detectada no texto extraído.');
  }

  return {
    drafts,
    ignoredLines,
    warnings,
    summary: {
      totalTasks: drafts.length,
      totalEstimatedMinutes: drafts.reduce((total, draft) => total + (draft.tempoEstimadoMinutos || 0), 0),
      disciplines: Array.from(new Set(drafts.map(draft => draft.discipline))).sort(),
      formatos: Array.from(new Set(drafts.map(draft => draft.formato))).sort()
    }
  };
};

export const createTasksFromMetaDrafts = (
  drafts: MetaTaskDraft[],
  options: CreateTasksFromMetaDraftsOptions
): StudyTask[] => {
  const selected = new Set(options.selectedDraftIds || drafts.map(draft => draft.id));
  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || (() => globalThis.crypto?.randomUUID?.() || createId('task'));

  return drafts
    .filter(draft => selected.has(draft.id))
    .map(draft => ({
      id: idFactory(),
      date: now,
      planejamento: options.planejamento || '',
      meta: options.meta || '',
      tarefa: draft.numero,
      assunto: draft.descricao,
      discipline: draft.discipline,
      bank: options.bank,
      idealMinutes: draft.tempoEstimadoMinutos,
      blocks: draft.blocks.map(block => ({
        ...block,
        id: idFactory(),
        bank: block.bank || options.bank
      })),
      status: 'in_progress' as const
    }));
};
