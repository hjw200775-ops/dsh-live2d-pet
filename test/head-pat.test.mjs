import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAD_PAT_GAIN,
  HEAD_PAT_TIMING,
  createHeadPat,
  headPatFeedback,
  headPatStage,
} from '../src/runtime/head-pat.mjs';

test('长按阈值：450ms 前不进入，到了才进入', () => {
  const pat = createHeadPat();
  pat.begin(0);
  pat.tick(300);
  assert.equal(pat.active, false, '300ms 不该进入摸头');
  assert.equal(pat.pressing, true);
  pat.tick(HEAD_PAT_TIMING.thresholdMs - 1);
  assert.equal(pat.active, false);
  pat.tick(HEAD_PAT_TIMING.thresholdMs);
  assert.equal(pat.active, true, '到阈值应进入摸头');
});

test('短按：松手后直接回到 idle，不进入摸头也不残留', () => {
  const pat = createHeadPat();
  pat.begin(0);
  pat.tick(200);
  pat.end(200);
  pat.tick(1000);
  assert.equal(pat.active, false);
  assert.equal(pat.phase, 'idle');
  assert.equal(pat.feedback(1000).headY, 0);
});

test('三级反馈：1 秒只有头部，2.5 秒开始有表情，6 秒更强', () => {
  assert.equal(headPatStage(1000), 1);
  assert.equal(headPatStage(2500), 2);
  assert.equal(headPatStage(6000), 3);

  const early = headPatFeedback(1200);
  assert.ok(early.headY < 0, '应该轻微低头');
  assert.equal(early.eyeSmile, 0, '1 秒时不该有眯眼');
  assert.equal(early.blush, 0, '1 秒时不该脸红');

  const mid = headPatFeedback(2600);
  assert.ok(mid.eyeSmile > 0, '2.5 秒应该有眯眼');
  assert.ok(mid.blush > 0, '2.5 秒应该开始脸红');

  const late = headPatFeedback(6000);
  assert.ok(late.headY < mid.headY, '5 秒后头部变化应更强');
  assert.ok(late.eyeSmile >= mid.eyeSmile);
});

test('5 秒那一次蹭头是个有始有终的脉冲', () => {
  const atStart = headPatFeedback(HEAD_PAT_TIMING.flourishMs + 1);
  const atPeak = headPatFeedback(HEAD_PAT_TIMING.flourishMs + HEAD_PAT_TIMING.nuzzleMs / 2);
  const atEnd = headPatFeedback(HEAD_PAT_TIMING.flourishMs + HEAD_PAT_TIMING.nuzzleMs + 60);
  assert.ok(Math.abs(atStart.nuzzle) < 0.05, '起点应接近 0');
  assert.ok(atPeak.nuzzle > 0.9, `峰值应接近 1，实际 ${atPeak.nuzzle}`);
  assert.ok(Math.abs(atEnd.nuzzle) < 0.05, '终点应归零');
});

test('反馈是连续的，不会跳变', () => {
  let previous = headPatFeedback(0);
  for (let t = 16; t <= 8000; t += 16) {
    const now = headPatFeedback(t);
    for (const key of ['headY', 'headZ', 'eyeSmile', 'squint', 'mouthForm', 'blush']) {
      // 每 16ms 的增量限制在 0.5 以内：相当于头最快 ~30°/s，肉眼是平滑的
      assert.ok(Math.abs(now[key] - previous[key]) < 0.5, `${key} 在 ${t}ms 处跳变过大`);
    }
    previous = now;
  }
});

test('松手后淡出，最终归零并回到 idle', () => {
  const pat = createHeadPat();
  pat.begin(0);
  pat.tick(HEAD_PAT_TIMING.thresholdMs);
  pat.tick(3000);

  const held = pat.feedback(3000);
  assert.ok(held.headY < 0);
  pat.end(3000);
  assert.equal(pat.phase, 'fading');

  const midway = pat.feedback(3000 + HEAD_PAT_TIMING.fadeMs / 2);
  assert.ok(Math.abs(midway.headY) < Math.abs(held.headY), '淡出中幅度应减小');
  assert.ok(Math.abs(midway.headY) > 0, '淡出中不该瞬间归零');

  pat.tick(3000 + HEAD_PAT_TIMING.fadeMs + 1);
  assert.equal(pat.phase, 'idle');
  assert.equal(pat.feedback(9000).headY, 0);
});

test('cancel 立即清零（失焦 / 面板打开等硬中断）', () => {
  const pat = createHeadPat();
  pat.begin(0);
  pat.tick(HEAD_PAT_TIMING.thresholdMs);
  pat.tick(2500);
  pat.cancel();
  assert.equal(pat.phase, 'idle');
  assert.equal(pat.feedback(2500).headY, 0);
  assert.equal(pat.feedback(2500).blush, 0);
});

test('engaged 覆盖摸头与淡出，用来抑制其他交互', () => {
  const pat = createHeadPat();
  pat.begin(0);
  assert.equal(pat.engaged, false, '还没到阈值时不占用交互');
  pat.tick(HEAD_PAT_TIMING.thresholdMs);
  assert.equal(pat.engaged, true);
  pat.end(1000);
  assert.equal(pat.engaged, true, '淡出期间仍应抑制');
  pat.tick(1000 + HEAD_PAT_TIMING.fadeMs + 1);
  assert.equal(pat.engaged, false);
});

test('幅度上限合理：头不超过 5 度，表情不超过 1', () => {
  for (let t = 0; t <= 9000; t += 50) {
    const value = headPatFeedback(t);
    assert.ok(Math.abs(value.headY) <= 5, `headY 越界: ${value.headY}`);
    assert.ok(Math.abs(value.headZ) <= 5, `headZ 越界: ${value.headZ}`);
    for (const key of ['eyeSmile', 'squint', 'mouthForm', 'blush']) {
      assert.ok(value[key] >= 0 && value[key] <= 1, `${key} 越界: ${value[key]}`);
    }
  }
  assert.ok(Math.abs(HEAD_PAT_GAIN.headY) < 5);
});
