import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noise1D, seededRandom } from '../src/runtime/noise.mjs';
import { createBlink, nextBlink } from '../src/runtime/blink.mjs';
import { createIdleMotion, createWeightShift } from '../src/runtime/idle-motion.mjs';
import { breathPeriodAt, breathValue } from '../src/runtime/breathing.mjs';

test('值噪声有界、可复现，格点处连续且不按短周期重复', () => {
  let last = noise1D(-20, 42);
  for (let t = -20; t < 200; t += 0.01) {
    const value = noise1D(t, 42);
    assert.ok(Math.abs(value) <= 1);
    assert.equal(value, noise1D(t, 42));
    assert.ok(Math.abs(value - last) < 0.04);
    last = value;
  }
  for (let i = -20; i < 200; i++) {
    assert.ok(Math.abs(noise1D(i - 1e-5) - noise1D(i + 1e-5)) < 1e-8);
  }
  // 回归短周期循环；有限采样不能证明数学意义上的无周期。
  for (const lag of [1, 4, 8, 16, 32, 64]) {
    const error = Array.from({ length: 100 }, (_, i) => Math.abs(noise1D(i * 0.37) - noise1D(i * 0.37 + lag)));
    assert.ok(error.reduce((sum, n) => sum + n, 0) / error.length > 0.1);
  }
  assert.notEqual(noise1D(1.3, 1), noise1D(1.3, 2));
  assert.equal(noise1D(NaN), 0);
});

test('1000 次眨眼间隔均匀覆盖 2–6 秒，连眨概率约 20%', () => {
  const random = seededRandom(1234);
  const bins = [0, 0, 0, 0];
  let doubles = 0;
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    const { interval, count } = nextBlink(random);
    assert.ok(interval >= 2 && interval <= 6);
    bins[Math.floor(interval - 2)]++;
    total += interval;
    doubles += count === 2 ? 1 : 0;
  }
  assert.ok(doubles >= 160 && doubles <= 240, `连眨 ${doubles} 次`);
  assert.ok(bins.every(n => n > 200 && n < 300), bins.toString());
  assert.ok(Math.abs(total / 1000 - 4) < 0.15);
});

test('连眨有两次闭眼和中间睁眼，禁用和长时间跳帧后不追赶补播', () => {
  const seed = Array.from({ length: 100 }, (_, i) => i).find(seed => nextBlink(seededRandom(seed)).count === 2);
  const start = nextBlink(seededRandom(seed)).interval;
  const blink = createBlink({ seed });
  assert.equal(blink.valueAt(0), 1);
  assert.ok(blink.valueAt(start + 0.07) < 1e-10);
  assert.equal(blink.valueAt(start + 0.20), 1);
  assert.ok(blink.valueAt(start + 0.33) < 1e-10);
  assert.equal(blink.valueAt(start + 0.34, false), 1);
  assert.equal(blink.valueAt(50), 1);
  assert.equal(blink.valueAt(1000), 1);
});

test('重心每 8–20 秒选目标，2 秒缓动，AngleZ 与 PositionX 同步有界', () => {
  const random = seededRandom(29);
  const shift = createWeightShift({ seed: 29 });
  let at = 8 + random() * 12;
  let last = 0;
  for (let i = 0; i < 1000; i++) {
    const target = random() * 2 - 1;
    const before = shift.valueAt(at - 1e-5);
    const beginning = shift.valueAt(at);
    assert.ok(Math.abs(beginning.AngleZ - before.AngleZ) < 1e-8);
    assert.ok(Math.abs(beginning.AngleZ - last * 1.4) < 1e-8);
    const middle = shift.valueAt(at + 1);
    assert.ok(Math.abs(middle.AngleZ - (last + target) / 2 * 1.4) < 1e-8);
    const end = shift.valueAt(at + 2);
    assert.ok(Math.abs(end.AngleZ - target * 1.4) < 1e-8);
    assert.ok(Math.abs(end.PositionX - target * 1.2) < 1e-8);
    assert.ok(Math.abs(end.AngleZ) <= 1.4);
    const interval = 8 + random() * 12;
    assert.ok(interval >= 8 && interval <= 20);
    assert.deepEqual(shift.valueAt(at + interval - 1e-5), end);
    at += interval;
    last = target;
  }
  const dense = createWeightShift();
  for (let t = 0; t < 99; t += 0.1) dense.valueAt(t);
  assert.deepEqual(dense.valueAt(100), createWeightShift().valueAt(100));
});

test('待机层从零淡入，禁用后回零；恢复和长时间挂起没有姿态跳变', () => {
  const idle = createIdleMotion();
  assert.ok(Object.values(idle.valueAt(0)).every(v => v === 0));
  let last = idle.valueAt(0);
  for (let i = 1; i < 18000; i++) {
    const enabled = i % 600 < 300;
    const current = idle.valueAt(i / 60, enabled);
    for (const id of Object.keys(current)) assert.ok(Math.abs(current[id] - last[id]) < 0.16, id);
    if (i % 600 === 590) assert.ok(Object.values(current).every(v => v === 0));
    last = current;
  }
  const resumed = idle.valueAt(100000);
  for (const id of Object.keys(resumed)) assert.ok(Math.abs(resumed[id] - last[id]) < 0.2);
});

test('默认呼吸瞬时周期 3.6–4.8 秒，周期与值连续，真实峰间隔也在范围内', () => {
  const peaks = [];
  let previous = breathValue(0);
  let rising = false;
  let minPeriod = Infinity;
  let maxPeriod = 0;
  for (let i = 1; i < 60000; i++) {
    const t = i / 100;
    const period = breathPeriodAt(t);
    minPeriod = Math.min(minPeriod, period);
    maxPeriod = Math.max(maxPeriod, period);
    assert.ok(period >= 3.6 - 1e-9 && period <= 4.8 + 1e-9);
    assert.ok(Math.abs(period - breathPeriodAt(t - 0.01)) < 0.001);
    const value = breathValue(t);
    assert.ok(value >= 0.15 && value <= 0.85);
    assert.ok(Math.abs(value - previous) < 0.01);
    if (rising && value < previous) peaks.push(t - 0.01);
    rising = value > previous;
    previous = value;
  }
  assert.ok(maxPeriod - minPeriod > 1.19);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] - peaks[i - 1] >= 3.59 && peaks[i] - peaks[i - 1] <= 4.81);
});
