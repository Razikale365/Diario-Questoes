export interface TaskQuestionImportParseGate {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (generation: number) => boolean;
}

export const createTaskQuestionImportParseGate = (): TaskQuestionImportParseGate => {
  let generation = 0;

  return {
    begin: () => {
      generation += 1;
      return generation;
    },
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (candidate) => candidate === generation,
  };
};
