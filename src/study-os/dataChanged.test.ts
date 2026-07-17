import assert from 'node:assert/strict';
import test from 'node:test';

import {
  announceStudyOsDataChanged,
  parseStudyOsDataChangedDetail,
  STUDY_OS_DATA_CHANGED,
} from './dataChanged';

test('data-change details reject malformed values before consumers act', () => {
  assert.equal(parseStudyOsDataChangedDetail({ targetSlug: '', resources: ['source-plan'] }), null);
  assert.equal(parseStudyOsDataChangedDetail({ targetSlug: 'sefaz_ce', taskId: 0, resources: ['source-plan'] }), null);
  assert.equal(parseStudyOsDataChangedDetail({ targetSlug: 'sefaz_ce', resources: ['unknown'] }), null);
});

test('data-change announcements normalize duplicate resource names', () => {
  const events: Event[] = [];
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => { events.push(event); return true; } },
  });
  try {
    announceStudyOsDataChanged({
      targetSlug: 'sefaz_ce', taskId: 4,
      resources: ['source-plan', 'calendar', 'source-plan'],
    });
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }

  assert.equal(events[0]?.type, STUDY_OS_DATA_CHANGED);
  assert.deepEqual(parseStudyOsDataChangedDetail((events[0] as CustomEvent).detail), {
    targetSlug: 'sefaz_ce', taskId: 4, resources: ['source-plan', 'calendar'],
  });
});
