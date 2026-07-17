import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTaskExecutionDraft,
  parseTaskResultDraft,
  type TaskExecutionDraft,
} from './taskResultDraft';

const draft = (overrides: Partial<TaskExecutionDraft> = {}): TaskExecutionDraft => ({
  performedOn: '2026-07-16',
  taskMinutes: '60',
  exerciseMinutes: '35',
  questionsTotal: '20',
  correctCount: '16',
  wrongCount: '4',
  doubtCount: '2',
  energyAfter: 3,
  notes: 'Revisão registrada no dia correto',
  ...overrides,
});

test('execution drafts tolerate incomplete typing until submission', () => {
  assert.deepEqual(parseTaskExecutionDraft(draft({
    performedOn: '', taskMinutes: '', exerciseMinutes: '', questionsTotal: '',
    correctCount: '', wrongCount: '', doubtCount: '',
  })), {
    ok: false,
    errors: {
      performedOn: 'Use uma data válida que não seja futura',
      taskMinutes: 'Use minutos entre 0 e 720',
      exerciseMinutes: 'Use minutos entre 0 e 720',
      questionsTotal: 'Use um total entre 0 e 10000',
      correctCount: 'Use uma contagem válida',
      wrongCount: 'Use uma contagem válida',
      doubtCount: 'Use uma contagem válida',
    },
  });
});

test('execution drafts accept yesterday and derive performance solely from answered counts', () => {
  assert.deepEqual(parseTaskExecutionDraft(draft()), {
    ok: true,
    value: {
      performedOn: '2026-07-16', taskMinutes: 60, exerciseMinutes: 35,
      questionsTotal: 20, correctCount: 16, wrongCount: 4, doubtCount: 2,
      energyAfter: 3, notes: 'Revisão registrada no dia correto', performanceBp: 8000,
    },
  });
  assert.deepEqual(parseTaskExecutionDraft(draft({
    questionsTotal: '0', correctCount: '0', wrongCount: '0', doubtCount: '0',
  })), {
    ok: true,
    value: {
      performedOn: '2026-07-16', taskMinutes: 60, exerciseMinutes: 35,
      questionsTotal: 0, correctCount: 0, wrongCount: 0, doubtCount: 0,
      energyAfter: 3, notes: 'Revisão registrada no dia correto', performanceBp: null,
    },
  });
});

test('execution drafts reject future dates and time or count overflows', () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  const performedOn = [future.getFullYear(), `${future.getMonth() + 1}`.padStart(2, '0'), `${future.getDate()}`.padStart(2, '0')].join('-');
  const parsed = parseTaskExecutionDraft(draft({
    performedOn, taskMinutes: '721', exerciseMinutes: '722', questionsTotal: '10001',
    correctCount: '10001', wrongCount: '1', doubtCount: '10001',
  }));
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.deepEqual(parsed.errors, {
    performedOn: 'Use uma data válida que não seja futura',
    taskMinutes: 'Use minutos entre 0 e 720',
    exerciseMinutes: 'Use minutos entre 0 e 720',
    questionsTotal: 'Use um total entre 0 e 10000',
    correctCount: 'Use uma contagem válida',
    wrongCount: 'Use uma contagem válida',
    doubtCount: 'Use uma contagem válida',
  });
});

test('legacy PlannerArea draft parsing remains isolated during the rich-draft migration', () => {
  assert.deepEqual(parseTaskResultDraft({ spentMinutes: '45', performance: '91' }), {
    ok: true,
    value: { spentMinutes: 45, performance: 91 },
  });
});
