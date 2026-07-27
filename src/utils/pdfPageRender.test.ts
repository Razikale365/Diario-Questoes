import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatePdfPageScale } from './pdfPageRender';

test('fits a PDF page to the available width and applies readable zoom', () => {
  assert.equal(calculatePdfPageScale(600, 1200, 1), 0.5);
  assert.equal(calculatePdfPageScale(600, 1200, 1.5), 0.75);
});

test('uses a safe scale when layout dimensions are not ready', () => {
  assert.equal(calculatePdfPageScale(0, 1200, 1), 1);
  assert.equal(calculatePdfPageScale(600, 0, 1), 1);
});
