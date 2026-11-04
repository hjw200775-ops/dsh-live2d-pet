import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer } from '../../src/runtime/gesture.mjs';
import { defaultInteractionPreferences, sanitizeInteractionPreferences, doubleClickFallbackKind } from '../../src/features/interaction-preferences.mjs';

/**
 * 本文件只“记录”识别器与折叠规则，不改变识别规则。
 * 识别器层面：双击由识别器独吞，不会再补发单击（`expire()` 返回 null）。
 * 交互层面（第三阶段人工决策 = 方案 C）：关闭双击反馈后，viewer 把这个 double-click
 * **折叠成一次普通单击**（按点击位置判头部/身体），仍受开关与冷却约束；
 * 双击反馈开启时保持原语义。方案 B（拆成两次单击）需要改 gesture.mjs，本轮未采用。
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

test('识别器：双击由识别器独吞，不会再补发单击', () => {
  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  const events = doubleClickSequence(recognizer);
  assert.equal(events[0].type, 'down');
  assert.equal(events[1].type, 'click-arm');
  assert.equal(events[2].type, 'pending-double', '第二下按下应把上一击的 armed 清掉');
  assert.equal(events[3].type, 'double-click');
  assert.equal(events[4].result, null, '双击结束后不应再冒出一次单击');
});

test('方案 C：关闭双击后由 viewer 折叠成一次普通单击，double 本身不触发', () => {
  const interaction = sanitizeInteractionPreferences({ enabled: { double: false } }, defaultInteractionPreferences());
  assert.equal(interaction.enabled.double, false);

  const recognizer = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  const events = doubleClickSequence(recognizer);
  const finalEvent = events.filter(item => item.type === 'double-click' || item.type === 'click');
  assert.deepEqual(finalEvent.map(item => item.type), ['double-click']);

  // viewer 会把这个 double-click 折算成 head/body 中的一种，且不会触发 double 反馈
  const folded = doubleClickFallbackKind({ doubleEnabled: interaction.enabled.double, region: 'head' });
  assert.equal(folded, 'head');
  assert.equal(interaction.enabled.double, false);
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
