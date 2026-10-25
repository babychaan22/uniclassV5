import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triangleSideSteps } from '../src/lib/missionReview.js';

test('explains the actual calculation for a right triangle', () => {
  const steps = triangleSideSteps('8,15,17', 'Right');
  assert.match(steps[0], /8² \+ 15² = 64 \+ 225 = 289/);
  assert.match(steps[1], /17² = 289/);
  assert.match(steps[2], /289 = 289/);
});

test('explains acute and obtuse comparisons', () => {
  assert.match(triangleSideSteps('4, 4, 5', 'Acute')[2], /32 > 25/);
  assert.match(triangleSideSteps('2, 3, 4', 'Obtuse')[2], /13 < 16/);
});

test('does not fabricate reasoning for invalid or inconsistent answers', () => {
  assert.equal(triangleSideSteps('1,2,3', 'Right'), null);
  assert.equal(triangleSideSteps('8,15,17', 'Acute'), null);
  assert.equal(triangleSideSteps('a word', 'Right'), null);
});
