import { ActivityBlock, StudyTask } from '../types';

export const DEFAULT_ACTIVITY_LAYOUT = {
  columns: 2,
  rows: 10,
  type: 'columns' as const,
  width: 12
};

export const DEFAULT_SECTION_LAYOUT = {
  columns: 12,
  rows: 1,
  type: 'columns' as const,
  width: 12
};

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
