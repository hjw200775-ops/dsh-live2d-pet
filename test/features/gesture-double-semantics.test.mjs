import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer } from '../../src/runtime/gesture.mjs';
import { defaultInteractionPreferences, sanitizeInteractionPreferences } from '../../src/features/interaction-preferences.mjs';

/**
 * 本文件只“记录”当前手势语义，不改变识别规则。
 * 语义 A（现行）：关闭双击反馈后，双击由识别器判成 double-click，viewer 的 react() 直接返回，
 * 因此两次快速点击**完全无反馈**——第一下也不会退化成单击。
 * 语义 B（备选，未实现）：关闭双击后按两次单击处理，需要改 gesture.mjs 的判定顺序。
 */
function doubleClickSequence(recognizer, x = 100, y = 100) {
  const events = [];
  events.push(recognizer.pointerDown(x, y, 0));
  events.push(recognizer.pointerUp(x, y, 40));
  events.push(recognizer.pointerDown(x, y, 120));
  events.push(recognizer.pointerUp(x, y, 160));
  events.push({ type: 'expire', result: recognizer.expire(1000) });
  return events;
}

test('语义 A：双击由识别器独吞，不会再补发单击', () => {
  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  const events = doubleClickSequence(recognizer);
  assert.equal(events[0].type, 'down');
  assert.equal(events[1].type, 'click-arm');
  assert.equal(events[2].type, 'pending-double', '第二下按下应把上一击的 armed 清掉');
  assert.equal(events[3].type, 'double-click');
  assert.equal(events[4].result, null, '双击结束后不应再冒出一次单击');
});

test('语义 A + 关闭双击开关：手势被识别，但 viewer 的 react() 会直接返回', () => {
  const interaction = sanitizeInteractionPreferences({ enabled: { double: false } }, defaultInteractionPreferences());
  assert.equal(interaction.enabled.double, false);

  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  const events = doubleClickSequence(recognizer);
  const finalEvent = events.filter(item => item.type === 'double-click' || item.type === 'click');
  assert.deepEqual(finalEvent.map(item => item.type), ['double-click']);

  // viewer 侧的等价逻辑：disabled → return，所以不会点头、不会弹气泡、也不触发动作组
  const react = kind => (interaction.enabled[kind] ? `feedback:${kind}` : null);
  assert.equal(react('double'), null);
  assert.equal(react('head'), 'feedback:head');
});

test('对照：单击路径不受双击开关影响', () => {
  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  recognizer.pointerDown(10, 10, 0);
  assert.equal(recognizer.pointerUp(10, 10, 50).type, 'click-arm');
  assert.equal(recognizer.expire(400).type, 'click');
});

test('对照：两次点击间隔超过 doubleMs 时按两次单击处理', () => {
  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  recognizer.pointerDown(10, 10, 0);
  assert.equal(recognizer.pointerUp(10, 10, 50).type, 'click-arm');
  recognizer.pointerDown(10, 10, 400);
  assert.equal(recognizer.pointerUp(10, 10, 450).type, 'click-arm');
  assert.equal(recognizer.expire(800).type, 'click');
});
