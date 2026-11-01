import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BREATH_PERIOD, breathValue } from '../src/runtime/breathing.mjs';
import { createGaze } from '../src/runtime/gaze.mjs';
import { fadeFor, fadeTable } from '../src/runtime/fades.mjs';
import { AUTHORED_MOTIONS, HEAD_LIMIT, HELLO_SECONDS, NOD_SECONDS, SAFE_PARAMS, SHAKE_SECONDS, STRETCH_SECONDS, THINKING_SECONDS, authoredMotion, thinkingLoopMotion } from '../src/runtime/authored-motions.mjs';

test('呼吸值在区间内、首尾连续（不会跳）', () => {
  const low = 0.15;
  const high = 0.85;
  for (let t = 0; t < 12; t += 0.05) {
    const value = breathValue(t);
    assert.ok(value >= low - 1e-9 && value <= high + 1e-9, `t=${t} 越界：${value}`);
  }
  // 一个周期后回到同一点，循环不会跳帧
  const a = breathValue(0.3);
  const b = breathValue(0.3 + BREATH_PERIOD);
  assert.ok(Math.abs(a - b) < 1e-6, `周期不闭合：${a} vs ${b}`);
});

test('呼吸有起伏，不是常数', () => {
  const samples = [];
  for (let t = 0; t < BREATH_PERIOD; t += 0.1) samples.push(breathValue(t));
  const span = Math.max(...samples) - Math.min(...samples);
  assert.ok(span > 0.4, `起伏太小：${span}`);
});

test('视线漂移有界且随时间变化', () => {
  const gaze = createGaze({ seed: 3, range: 0.32 });
  let moved = false;
  let last = gaze.valueAt(0);
  for (let t = 0; t < 20; t += 0.25) {
    const { x, y } = gaze.valueAt(t);
    assert.ok(Math.abs(x) <= 0.32 + 1e-9, `x 越界：${x}`);
    assert.ok(Math.abs(y) <= 0.32 * 0.6 + 1e-9, `y 越界：${y}`);
    if (Math.abs(x - last.x) > 0.02) moved = true;
    last = { x, y };
  }
  assert.ok(moved, '视线一直没动');
});

test('同一 seed 的视线完全可复现', () => {
  const a = createGaze({ seed: 11 });
  const b = createGaze({ seed: 11 });
  for (const t of [0, 1.3, 4.7, 9.9]) {
    assert.deepEqual(a.valueAt(t), b.valueAt(t));
  }
});

test('不同 seed 的视线不一样', () => {
  const a = createGaze({ seed: 1 });
  const b = createGaze({ seed: 2 });
  const same = [1, 2, 3, 5].every(t => {
    const pa = a.valueAt(t);
    const pb = b.valueAt(t);
    return Math.abs(pa.x - pb.x) < 1e-9 && Math.abs(pa.y - pb.y) < 1e-9;
  });
  assert.equal(same, false);
});

test('淡入淡出按组区分：待机慢、出错快', () => {
  const table = fadeTable();
  assert.ok(table.Idle.in > table.Answering.in, '待机应该比回答慢');
  assert.ok(table.Flinch.in < table.Thinking.in, '出错应该最快');
  assert.deepEqual(fadeFor('Idle'), { in: 0.6, out: 0.6 });
  assert.deepEqual(fadeFor('不存在的组'), { in: 0.25, out: 0.25 });
});

test('思考动作是 4 秒循环，首尾归零', () => {
  const motion = thinkingLoopMotion();
  assert.equal(motion.Version, 3);
  assert.equal(motion.Meta.Loop, true);
  assert.equal(motion.Meta.Duration, THINKING_SECONDS);
  assert.deepEqual(motion.Curves.map(curve => curve.Id), ['AngleY', 'AngleZ', 'ParamEyeBallY']);
  for (const curve of motion.Curves) {
    const segments = curve.Segments;
    assert.equal(segments[1], 0, `${curve.Id} 起始不为 0`);
    assert.equal(segments[segments.length - 1], 0, `${curve.Id} 结束不为 0`);
    assert.equal(segments[segments.length - 2], THINKING_SECONDS, `${curve.Id} 结束时间不对`);
  }
  const totalSegments = motion.Curves.reduce((sum, c) => sum + (c.Segments.length - 2) / 3, 0);
  assert.equal(motion.Meta.TotalSegmentCount, totalSegments);
});

test('新增动作只用安全参数，幅度不越界', () => {
  for (const name of ['hello', 'nod', 'shake', 'stretch', 'thinking', 'flinch']) {
    const motion = authoredMotion(`${name}.motion3.json`);
    assert.ok(motion, `${name} 应该能生成`);
    for (const curve of motion.Curves) {
      assert.ok(SAFE_PARAMS.has(curve.Id), `${name} 用了未登记的参数 ${curve.Id}`);
      const values = [];
      const segments = curve.Segments;
      let index = 2;
      while (index < segments.length) {
        if (segments[index] === 1) { values.push(segments[index + 2], segments[index + 4], segments[index + 6]); index += 7; }
        else { values.push(segments[index + 2]); index += 3; }
      }
      if (curve.Id === 'AngleX') assert.ok(Math.max(...values.map(Math.abs)) <= HEAD_LIMIT.x, `${name} AngleX 越界`);
      if (curve.Id === 'AngleY') assert.ok(Math.max(...values.map(Math.abs)) <= HEAD_LIMIT.y, `${name} AngleY 越界`);
      if (curve.Id === 'AngleZ') assert.ok(Math.max(...values.map(Math.abs)) <= HEAD_LIMIT.z, `${name} AngleZ 越界`);
    }
  }
});

test('四个新动作已注册且时长对得上', () => {
  const expected = { Hello: HELLO_SECONDS, Nod: NOD_SECONDS, Shake: SHAKE_SECONDS, Stretch: STRETCH_SECONDS };
  for (const [group, seconds] of Object.entries(expected)) {
    assert.ok(AUTHORED_MOTIONS[group], `${group} 未注册`);
    assert.equal(AUTHORED_MOTIONS[group].seconds, seconds, `${group} 时长不一致`);
    const doc = authoredMotion(AUTHORED_MOTIONS[group].file.replace('generated/', ''));
    assert.equal(doc.Meta.Duration, seconds);
    assert.equal(doc.Meta.Loop, false, `${group} 不该循环`);
  }
});

test('思考动作已注册，且能按名字取到', () => {
  assert.ok(AUTHORED_MOTIONS.Thinking, '应该注册 Thinking');
  assert.equal(AUTHORED_MOTIONS.Thinking.loop, true);
  const doc = authoredMotion('thinking.motion3.json');
  assert.equal(doc.Meta.Loop, true);
  assert.equal(authoredMotion('不存在.motion3.json'), null);
});
