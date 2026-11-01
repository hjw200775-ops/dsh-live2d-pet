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

test('待机随机动作会轮到代码生成的四个新动作', () => {
  // 前四轮保持老行为（手指 / 狗尾巴草），之后轮换新动作
  assert.deepEqual(idleVarietyGroups(20000, { seed: 0 }), ['FingerOut', 'FingerBack']);
  assert.deepEqual(idleVarietyGroups(20000, { seed: 1 }), ['GrassOut', 'GrassBack']);
  const seen = new Set();
  for (let seed = 4; seed < 12; seed++) {
    const groups = idleVarietyGroups(20000, { seed });
    assert.ok(groups, `seed ${seed} 应该有动作`);
    seen.add(groups[0]);
  }
  assert.deepEqual([...seen].sort(), ['Hello', 'Nod', 'Shake', 'Stretch']);
  assert.equal(clickMotionWait('Hello', 0), 2300);
  assert.equal(clickMotionWait('Stretch', 0), 3300);
});
