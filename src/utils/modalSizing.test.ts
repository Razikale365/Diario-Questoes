import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlannerTaskModalStyle, createResizableModalStyle } from './modalSizing';

test('createResizableModalStyle returns wide resizable viewport-safe sizing', () => {
  const style = createResizableModalStyle();

  assert.equal(style.resize, 'both');
  assert.equal(style.overflow, 'hidden');
  assert.match(String(style.width), /1120px/);
  assert.match(String(style.maxWidth), /100vw/);
  assert.match(String(style.maxHeight), /100vh/);
  assert.match(String(style.minHeight), /420px/);
});

test('createResizableModalStyle accepts task modal sizing overrides', () => {
  const style = createResizableModalStyle({
    width: 'min(1180px, calc(100vw - 2rem))',
    minHeight: '520px',
  });

  assert.equal(style.width, 'min(1180px, calc(100vw - 2rem))');
  assert.equal(style.minHeight, '520px');
});

test('createPlannerTaskModalStyle is wide enough for calendar task details', () => {
  const style = createPlannerTaskModalStyle();

  assert.equal(style.resize, 'both');
  assert.equal(style.overflow, 'hidden');
  assert.match(String(style.width), /1100px/);
  assert.match(String(style.minWidth), /760px/);
  assert.match(String(style.minHeight), /520px/);
});
