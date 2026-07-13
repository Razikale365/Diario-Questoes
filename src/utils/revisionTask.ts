import { ActivityBlock, Question, StudyTask } from '../types';
import { formatQuestionList } from './parser';

export interface RevisionTaskDraft {
  lines: string[];
  blocks: ActivityBlock[];
  questionCount: number;
}

interface RevisionGroup {
  lesson: string;
  bank: string;
  pages: Set<string>;
  questions: Map<string, Question>;
}

const questionIdentity = (task: StudyTask, block: ActivityBlock, question: Question) =>
  question.localId || `${task.id}:${block.id}:${question.number}`;

const displayQuestionNumber = (question: Question) =>
  question.sourceQuestionNumber ?? question.number;

const retryQuestion = (question: Question, index: number): Question => ({
  ...question,
  number: index + 1,
  sourceQuestionNumber: displayQuestionNumber(question),
  answer: '',
  isCorrect: null,
  eliminated: [],
  doubtedAlts: [...(question.doubtedAlts || [])],
  attempts: [],
});

export const buildRevisionTaskDraft = (
  tasks: StudyTask[],
  discipline: string,
  selectedLessons: ReadonlySet<string>,
  options: { idFactory?: () => string } = {},
): RevisionTaskDraft => {
  if (!discipline || selectedLessons.size === 0) {
    return { lines: [], blocks: [], questionCount: 0 };
  }

  const groups = new Map<string, RevisionGroup>();
  tasks
    .filter((task) => task.status === 'completed' && task.discipline === discipline)
    .forEach((task) => {
      task.blocks.forEach((block) => {
        if (!block.lesson || !selectedLessons.has(block.lesson) || block.isSection) return;

        const bank = block.bank || task.bank || 'Outra';
        const key = JSON.stringify([block.lesson, bank]);
        const group = groups.get(key) || {
          lesson: block.lesson,
          bank,
          pages: new Set<string>(),
          questions: new Map<string, Question>(),
        };

        block.questions.forEach((question) => {
          if (question.isCorrect !== false && !question.hasDoubt) return;
          const identity = questionIdentity(task, block, question);
          if (!group.questions.has(identity)) group.questions.set(identity, question);
        });
        if (block.pages) group.pages.add(block.pages);
        groups.set(key, group);
      });
    });

  const selectedGroups = [...groups.values()]
    .filter((group) => group.questions.size > 0)
    .sort((left, right) => left.lesson.localeCompare(right.lesson) || left.bank.localeCompare(right.bank));
  if (selectedGroups.length === 0) {
    return { lines: [], blocks: [], questionCount: 0 };
  }

  const lines = [
    'Refaça as questões que você errou ou marcou como dúvida. Os itens abaixo preservam o enunciado, as alternativas e o vínculo com o banco local:',
    '',
  ];
  const blocks: ActivityBlock[] = [];
  const lessonsSeen = new Set<string>();
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());
  let questionCount = 0;

  selectedGroups.forEach((group) => {
    const sourceQuestions = [...group.questions.values()].sort((left, right) =>
      displayQuestionNumber(left) - displayQuestionNumber(right));
    const questions = sourceQuestions.map(retryQuestion);
    const listedNumbers = [...new Set(sourceQuestions.map(displayQuestionNumber))].sort((a, b) => a - b);
    const pages = [...group.pages].join(', ');
    const pageLabel = pages ? ` (páginas ${pages})` : '';

    lines.push(
      `- Na ${group.lesson} - Resolver as questões ${formatQuestionList(listedNumbers)} (total: ${questions.length} questões)${pageLabel}. ${group.bank}`,
    );
    const questionsWithNotes = sourceQuestions.filter((question) =>
      question.observations || question.doubtedAlts?.length);
    if (questionsWithNotes.length > 0) {
      lines.push('  Observações/Dúvidas:');
      questionsWithNotes.forEach((question) => {
        let line = `  - Questão ${displayQuestionNumber(question)}:`;
        if (question.doubtedAlts?.length) line += ` [Considerou: ${question.doubtedAlts.join(', ')}]`;
        if (question.observations) line += ` ${question.observations}`;
        lines.push(line);
      });
    }

    if (!lessonsSeen.has(group.lesson)) {
      blocks.push({
        id: idFactory(),
        title: group.lesson,
        lesson: group.lesson,
        pages: '',
        questions: [],
        isSection: true,
        layout: { columns: 12, rows: 1, type: 'columns', width: 12 },
      });
      lessonsSeen.add(group.lesson);
    }

    blocks.push({
      id: idFactory(),
      title: `Revisão - ${group.lesson}`,
      lesson: group.lesson,
      pages,
      bank: group.bank,
      questions,
      showStats: true,
      showGabarito: false,
      layout: {
        columns: 1,
        rows: Math.min(Math.max(questions.length, 1), 8),
        type: 'grid',
        width: 12,
        rowSpan: 4,
      },
    });
    questionCount += questions.length;
  });

  return { lines, blocks, questionCount };
};
