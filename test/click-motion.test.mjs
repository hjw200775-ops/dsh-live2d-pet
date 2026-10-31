import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clickMotionGroups, clickMotionWait, idleVarietyGroups } from '../src/runtime/click-motion.mjs';

test('clicks use the short hand clips and leave the long escape clip alone', () => {
  assert.deepEqual(clickMotionGroups('head'), ['FingerOut', 'FingerBack']);
  assert.deepEqual(clickMotionGroups('body'), ['GrassOut', 'GrassBack']);
  assert.equal(clickMotionGroups('double'), null);
  assert.equal(clickMotionGroups('head', { mode: 'answering' }), null);
  assert.equal(clickMotionGroups('body', { locked: true }), null);
  assert.equal(idleVarietyGroups(15000), null);
  assert.deepEqual(idleVarietyGroups(16000, { seed: 0 }), ['FingerOut', 'FingerBack']);
  assert.deepEqual(idleVarietyGroups(16000, { seed: 1 }), ['GrassOut', 'GrassBack']);
  assert.equal(idleVarietyGroups(20000, { mode: 'thinking' }), null);
  assert.equal(idleVarietyGroups(20000, { dragging: true }), null);
  assert.equal(clickMotionWait('GrassOut', 0), 1500);
  assert.equal(clickMotionWait('FingerOut', 0), 2000);
});
