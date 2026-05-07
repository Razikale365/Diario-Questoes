import { ActivityBlock, StudyTask } from '../types';
import { DEFAULT_SECTION_LAYOUT } from './layout';

const moveArrayItem = <T,>(items: T[], oldIndex: number, newIndex: number): T[] => {
  const result = [...items];
  const [moved] = result.splice(oldIndex, 1);
  result.splice(newIndex, 0, moved);
  return result;
};

const createSectionBlock = (title: string): ActivityBlock => ({
  id: crypto.randomUUID(),
  title,
  lesson: title,
  pages: '',
  questions: [],
  isSection: true,
  layout: DEFAULT_SECTION_LAYOUT
});

export const moveBlocks = (blocks: ActivityBlock[], activeId: string, overId: string): ActivityBlock[] => {
  const oldIndex = blocks.findIndex(block => block.id === activeId);
  const newIndex = blocks.findIndex(block => block.id === overId);

  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
    return blocks;
  }

  const activeBlock = blocks[oldIndex];
  const overBlock = blocks[newIndex];

  if (activeBlock.isSection) {
    const sectionTitle = activeBlock.title.trim().toLowerCase();
    const remainingBlocks = blocks.filter(block => {
      if (block.id === activeBlock.id) return false;
      return block.isSection || block.lesson.trim().toLowerCase() !== sectionTitle;
    });
    const sectionChildren = blocks.filter(block => !block.isSection && block.lesson.trim().toLowerCase() === sectionTitle);
    const targetIndex = remainingBlocks.findIndex(block => block.id === overId);
    const insertIndex = targetIndex === -1 ? remainingBlocks.length : targetIndex;

    return [
      ...remainingBlocks.slice(0, insertIndex),
      activeBlock,
      ...sectionChildren,
      ...remainingBlocks.slice(insertIndex)
    ];
  }

  if (!activeBlock.isSection && !overBlock.isSection) {
    const sectionTitle = activeBlock.lesson.trim() || overBlock.lesson.trim() || 'Nova Seção';
    const hasSection = blocks.some(block => block.isSection && block.title.trim().toLowerCase() === sectionTitle.trim().toLowerCase());
    const activeHasLesson = activeBlock.lesson.trim().length > 0;
    const overHasLesson = overBlock.lesson.trim().length > 0;

    if (!hasSection && !activeHasLesson && !overHasLesson) {
      const withoutActive = blocks.filter(block => block.id !== activeId);
      const adjustedNewIndex = withoutActive.findIndex(block => block.id === overId);
      const insertIndex = adjustedNewIndex === -1 ? withoutActive.length : adjustedNewIndex;

      return [
        ...withoutActive.slice(0, insertIndex),
        createSectionBlock(sectionTitle),
        { ...activeBlock, lesson: sectionTitle },
        { ...overBlock, lesson: sectionTitle },
        ...withoutActive.slice(insertIndex + 1)
      ];
    }
  }

  return moveArrayItem(blocks, oldIndex, newIndex);
};

export const moveBlockByStep = (blocks: ActivityBlock[], blockId: string, direction: -1 | 1): ActivityBlock[] => {
  const currentIndex = blocks.findIndex(block => block.id === blockId);
  if (currentIndex === -1) return blocks;

  const targetIndex = currentIndex + direction;
  if (targetIndex < 0 || targetIndex >= blocks.length) return blocks;

  return moveArrayItem(blocks, currentIndex, targetIndex);
};

export const autoSnapTaskBlocks = (blocks: ActivityBlock[]): ActivityBlock[] => {
  const sections = blocks.filter(block => block.isSection);
  const activities = blocks.filter(block => !block.isSection);
  const orderedBlocks: ActivityBlock[] = [];
  const processedActivityIds = new Set<string>();

  sections.forEach(section => {
    orderedBlocks.push(section);
    activities.forEach(activity => {
      const activityLesson = activity.lesson.trim().toLowerCase();
      const sectionTitle = section.title.trim().toLowerCase();

      if (!processedActivityIds.has(activity.id) && (activityLesson === sectionTitle || activityLesson.includes(sectionTitle))) {
        orderedBlocks.push(activity);
        processedActivityIds.add(activity.id);
      }
    });
  });

  activities.forEach(activity => {
    if (!processedActivityIds.has(activity.id)) {
      orderedBlocks.push(activity);
    }
  });

  return orderedBlocks;
};

export const replaceTaskBlocks = (
  task: StudyTask,
  blocks: ActivityBlock[],
  updatedAt: string
): StudyTask => ({
  ...task,
  updatedAt,
  blocks
});
