import { ActivityBlock, LayoutConfig, LayoutPatch, StudyTask } from '../types';

export const DEFAULT_ACTIVITY_LAYOUT: LayoutConfig = {
  columns: 2,
  rows: 10,
  type: 'columns' as const,
  width: 12
};

export const DEFAULT_SECTION_LAYOUT: LayoutConfig = {
  columns: 12,
  rows: 1,
  type: 'columns' as const,
  width: 12
};

export type LayoutTemplateId = 'default' | 'short_questions' | 'mock_exam' | 'reading_questions' | 'revision';

export const LAYOUT_TEMPLATES: Array<{
  id: LayoutTemplateId;
  label: string;
  description: string;
  layout: LayoutConfig;
}> = [
  {
    id: 'default',
    label: 'Questões curtas',
    description: 'Padrão LS: colunas, 2 colunas e 10 linhas.',
    layout: DEFAULT_ACTIVITY_LAYOUT
  },
  {
    id: 'mock_exam',
    label: 'Simulado',
    description: 'Grade mais compacta para muitas questões.',
    layout: { columns: 5, rows: 8, type: 'grid', width: 12 }
  },
  {
    id: 'reading_questions',
    label: 'Leitura + questões',
    description: 'Blocos mais largos, com menos densidade visual.',
    layout: { columns: 2, rows: 6, type: 'columns', width: 12 }
  },
  {
    id: 'revision',
    label: 'Revisão',
    description: 'Lista enxuta para rever erros e dúvidas.',
    layout: { columns: 1, rows: 12, type: 'columns', width: 12 }
  }
];

export const getLayoutTemplate = (id: LayoutTemplateId): LayoutConfig => (
  LAYOUT_TEMPLATES.find(template => template.id === id)?.layout || DEFAULT_ACTIVITY_LAYOUT
);

export const applyLayoutToBlocks = (blocks: ActivityBlock[], layout: LayoutPatch): ActivityBlock[] => (
  blocks.map(block => ({
    ...block,
    layout: block.isSection
      ? mergeLayout(block.layout, {}, DEFAULT_SECTION_LAYOUT)
      : mergeLayout(block.layout, layout, DEFAULT_ACTIVITY_LAYOUT)
  }))
);

export const mergeLayout = (
  current: LayoutConfig | undefined,
  patch: LayoutPatch,
  fallback: LayoutConfig = DEFAULT_ACTIVITY_LAYOUT
): LayoutConfig => ({
  ...fallback,
  ...current,
  ...patch
});

export const applyDefaultLayoutToBlock = (block: ActivityBlock): ActivityBlock => {
  if (block.isSection) {
    return {
      ...block,
      layout: block.layout || DEFAULT_SECTION_LAYOUT
    };
  }

  return {
    ...block,
    layout: block.layout || DEFAULT_ACTIVITY_LAYOUT
  };
};

export const normalizeTaskBlocksLayout = (task: StudyTask): StudyTask => ({
  ...task,
  blocks: task.blocks.map(applyDefaultLayoutToBlock)
});
