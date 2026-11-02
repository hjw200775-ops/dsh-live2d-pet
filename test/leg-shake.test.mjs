import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLegShake, LEG_SHAKE_LIMIT, LEG_SHAKE_PARAMETER } from '../src/runtime/leg-shake.mjs';
import { createIdleMotion } from '../src/runtime/idle-motion.mjs';

test('腿抖偶发短促、幅度有界、连续且首尾收回到零', () => {
  const shake = createLegShake({ seed: 83 });
  const episodes = [];
  let current = null;
  let previous = 0;
  let maxStep = 0;
  for (let frame = 0; frame < 60 * 180; frame++) {
    const time = frame / 60;
    const value = shake.valueAt(time)[LEG_SHAKE_PARAMETER];
    assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(value) <= LEG_SHAKE_LIMIT + 1e-9);
    maxStep = Math.max(maxStep, Math.abs(value - previous));
    if (Math.abs(value) > 1e-4) {
      if (!current) current = { start: time, end: time, min: value, max: value };
      current.end = time;
      current.min = Math.min(current.min, value);
      current.max = Math.max(current.max, value);
    } else if (current && time - current.end > 0.05) {
      episodes.push(current);
      current = null;
    }
    previous = value;
  }
  assert.ok(episodes.length >= 5);
  assert.ok(episodes[0].start >= 12 && episodes[0].start <= 18);
  for (const episode of episodes) {
    assert.ok(episode.end - episode.start >= 1 && episode.end - episode.start <= 1.8);
    assert.ok(episode.max > 1.4 && episode.min < -1.4, '应能辨认双向轻抖');
  }
  for (let index = 1; index < episodes.length; index++) {
    assert.ok(episodes[index].start - episodes[index - 1].end >= 17.5);
  }
  assert.ok(maxStep < 1.1, `60fps 单帧跳变过大：${maxStep}`);
});

test('暂停、状态或手势打断后平滑收回，恢复时重新等待而不续播旧动作', () => {
  const direct = createLegShake({ seed: 42 });
  for (let frame = 0; frame < 60 * 16; frame++) direct.valueAt(frame / 60);
  let interrupted = 0;
  for (let frame = 60 * 16; frame < 60 * 17; frame++) {
    interrupted = Math.abs(direct.valueAt(frame / 60, false)[LEG_SHAKE_PARAMETER]);
  }
  assert.equal(interrupted, 0);
  const resumeAt = 17;
  direct.valueAt(resumeAt, true);
  assert.ok(direct.nextAt >= resumeAt + 10, '打断恢复不能立刻补播');
  const skipped = createLegShake({ seed: 42 });
  for (let frame = 0; frame < 60 * 40; frame++) skipped.valueAt(frame / 60, false);
  skipped.valueAt(40, true);
  assert.ok(skipped.nextAt >= 40 + 17.5, '被手势或状态错过的槽位不能补播');

  const idle = createIdleMotion({ seed: 31 });
  for (let frame = 0; frame < 60 * 14; frame++) idle.valueAt(frame / 60, true, { resting: true });
  assert.ok(idle.shaking);
  idle.valueAt(14, false, { resting: false });
  for (let frame = 1; frame <= 120; frame++) idle.valueAt(14 + frame / 60, false, { resting: false });
  assert.equal(idle.shaking, false);
  const resumed = idle.valueAt(16, true, { resting: true });
  assert.equal(resumed[LEG_SHAKE_PARAMETER] || 0, 0);
  assert.ok(idle.legState.nextAt >= 16 + 12);
});

test('腿抖与久待身体摆动互斥，且每帧输出不累积', () => {
  const idle = createIdleMotion({ seed: 31 });
  let peak = 0;
  let sawShake = false;
  let sawSway = false;
  for (let frame = 0; frame < 60 * 180; frame++) {
    const value = idle.valueAt(frame / 60, true, { resting: true });
    const leg = Math.abs(value[LEG_SHAKE_PARAMETER] || 0);
    peak = Math.max(peak, leg);
    sawShake ||= leg > 0.1;
    sawSway ||= Math.abs(value.PositionZ || 0) > 1;
    if (leg > 0.02) assert.ok(Math.abs(value.PositionZ || 0) < 1e-5, '双腿轻抖时不应同时做久待身体摆动');
  }
  assert.ok(sawShake);
  assert.ok(sawSway);
  assert.ok(peak <= LEG_SHAKE_LIMIT);
});
