import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERACTION_LIMITS,
  defaultInteractionPreferences,
  sanitizeInteractionPreferences,
  resetInteractionPreferences,
  pickBubble,
  parseBubbleText,
  formatBubbleText,
} from '../../src/features/interaction-preferences.mjs';

test('默认互动配置等价于 v0.7.3 的硬编码交互', () => {
  const value = defaultInteractionPreferences();
  assert.deepEqual(value, {
    version: 1,
    enabled: { head: true, body: true, double: true },
    bubbles: { head: ['嗯？', '在的', '嘿嘿'], body: [], double: ['嘿嘿！'] },
    cooldownMs: 650,
  });
});

test('非对象输入返回上一份配置，不抛错', () => {
  const previous = defaultInteractionPreferences();
  for (const input of [null, undefined, 42, 'x', [], true]) {
    assert.deepEqual(sanitizeInteractionPreferences(input, previous), previous);
  }
});

test('开关只接受布尔值，其他类型保留旧值', () => {
  const previous = defaultInteractionPreferences();
  const next = sanitizeInteractionPreferences(
    { enabled: { head: false, body: 'no', double: 0 } },
    previous,
  );
  assert.equal(next.enabled.head, false);
  assert.equal(next.enabled.body, true);
  assert.equal(next.enabled.double, true);
});

test('未知字段被丢弃，返回值结构始终完整', () => {
  const next = sanitizeInteractionPreferences({
    enabled: { head: true },
    bubbles: { head: ['好'] },
    cooldownMs: 300,
    evil: { nested: true },
    version: 99,
  });
  assert.deepEqual(Object.keys(next).sort(), ['bubbles', 'cooldownMs', 'enabled', 'version']);
  assert.equal(next.version, 1);
  assert.equal(next.evil, undefined);
});

test('冷却时间边界：0 与 10000 接受，越界与非法值保留旧值', () => {
  const base = defaultInteractionPreferences();
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: 0 }, base).cooldownMs, 0);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: 10000 }, base).cooldownMs, 10000);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: -1 }, base).cooldownMs, 650);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: 10001 }, base).cooldownMs, 650);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: Number.NaN }, base).cooldownMs, 650);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: Number.POSITIVE_INFINITY }, base).cooldownMs, 650);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: '300' }, base).cooldownMs, 650);
  assert.equal(sanitizeInteractionPreferences({ cooldownMs: null }, base).cooldownMs, 650);
});

test('冷却时间取整到毫秒整数', () => {
  const next = sanitizeInteractionPreferences({ cooldownMs: 12.6 }, defaultInteractionPreferences());
  assert.equal(next.cooldownMs, 13);
});

test('气泡逐条校验：去空白、丢空串、截断 40 字、最多 12 条', () => {
  const long = 'x'.repeat(60);
  const input = ['  你好  ', '', '   ', long, ...Array.from({ length: 20 }, (_, i) => `第${i}条`)];
  const next = sanitizeInteractionPreferences({ bubbles: { head: input } }, defaultInteractionPreferences());
  assert.equal(next.bubbles.head.length, INTERACTION_LIMITS.bubbles.maxItems);
  assert.equal(next.bubbles.head[0], '你好');
  assert.equal(next.bubbles.head.find(item => item.startsWith('x'))?.length, 40);
  assert.ok(next.bubbles.head.every(item => item.length > 0 && item.length <= 40));
});

test('气泡非字符串元素被丢弃，非数组整段保留旧值', () => {
  const base = defaultInteractionPreferences();
  const next = sanitizeInteractionPreferences({ bubbles: { head: ['好', 42, null, { text: 'x' }] } }, base);
  assert.deepEqual(next.bubbles.head, ['好']);
  const kept = sanitizeInteractionPreferences({ bubbles: { double: '嘿嘿' } }, base);
  assert.deepEqual(kept.bubbles.double, ['嘿嘿！']);
});

test('空气泡数组合法，表示这一类不弹气泡', () => {
  const next = sanitizeInteractionPreferences({ bubbles: { head: [] } }, defaultInteractionPreferences());
  assert.deepEqual(next.bubbles.head, []);
  assert.deepEqual(next.bubbles.double, ['嘿嘿！']);
});

test('sanitize 是纯函数：不修改入参与上一份配置', () => {
  const previous = defaultInteractionPreferences();
  const snapshot = JSON.stringify(previous);
  const input = { enabled: { head: false }, bubbles: { body: ['啊啊'] }, cooldownMs: 900 };
  const inputSnapshot = JSON.stringify(input);
  sanitizeInteractionPreferences(input, previous);
  assert.equal(JSON.stringify(previous), snapshot);
  assert.equal(JSON.stringify(input), inputSnapshot);
});

test('恢复默认返回全新副本，改动它不会污染默认常量', () => {
  const a = resetInteractionPreferences();
  a.enabled.head = false;
  a.bubbles.head.push('污染');
  a.cooldownMs = 1;
  const b = resetInteractionPreferences();
  assert.equal(b.enabled.head, true);
  assert.deepEqual(b.bubbles.head, ['嗯？', '在的', '嘿嘿']);
  assert.equal(b.cooldownMs, 650);
});

test('pickBubble 空列表返回 null，有值时按随机数落点取样', () => {
  assert.equal(pickBubble([]), null);
  assert.equal(pickBubble(undefined), null);
  assert.equal(pickBubble(['a', 'b', 'c'], () => 0), 'a');
  assert.equal(pickBubble(['a', 'b', 'c'], () => 0.99), 'c');
  assert.equal(pickBubble(['a', 'b', 'c'], () => 1), 'c');
});

test('面板文本与配置数组可以互转', () => {
  assert.deepEqual(parseBubbleText('嗯？，在的|嘿嘿'), ['嗯？', '在的', '嘿嘿']);
  assert.deepEqual(parseBubbleText('  '), []);
  assert.deepEqual(parseBubbleText(null), []);
  assert.equal(formatBubbleText(['嗯？', '在的']), '嗯？，在的');
  assert.equal(formatBubbleText(undefined), '');
});
