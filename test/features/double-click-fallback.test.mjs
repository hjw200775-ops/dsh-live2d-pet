import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultInteractionPreferences, sanitizeInteractionPreferences, doubleClickFallbackKind, shouldFireFeedback } from '../../src/features/interaction-preferences.mjs';

const defaultEnabled = defaultInteractionPreferences().enabled;

test('方案 C：双击反馈开启时保持 double，不做任何折叠', () => {
  assert.equal(doubleClickFallbackKind({ doubleEnabled: true, region: 'head' }), 'double');
  assert.equal(doubleClickFallbackKind({ doubleEnabled: true, region: 'body' }), 'double');
});

test('方案 C：双击反馈关闭时按点击位置折叠成一次普通单击', () => {
  assert.equal(doubleClickFallbackKind({ doubleEnabled: false, region: 'head' }), 'head');
  assert.equal(doubleClickFallbackKind({ doubleEnabled: false, region: 'body' }), 'body');
  assert.equal(doubleClickFallbackKind({ doubleEnabled: false, region: undefined }), 'body');
});

test('折叠后的单击仍受开关约束：头部关闭时不会借双击绕过', () => {
  const enabled = sanitizeInteractionPreferences({ enabled: { head: false, double: false } }, defaultInteractionPreferences()).enabled;
  assert.equal(enabled.head, false);
  const kind = doubleClickFallbackKind({ doubleEnabled: enabled.double, region: 'head' });
  assert.equal(kind, 'head');
  assert.equal(shouldFireFeedback({ kind, enabled, now: 10_000, lastReaction: 0, cooldownMs: 650 }), false);
});

test('折叠后的单击仍受冷却约束，且一旦触发会刷新冷却', () => {
  const enabled = { ...defaultEnabled, double: false };
  const kind = doubleClickFallbackKind({ doubleEnabled: enabled.double, region: 'body' });

  // 距上次反馈 100ms < 650ms：不触发
  assert.equal(shouldFireFeedback({ kind, enabled, now: 1_100, lastReaction: 1_000, cooldownMs: 650 }), false);
  // 正好等于冷却边界：可以触发（与 v0.7.3 的 `<` 判定一致）
  assert.equal(shouldFireFeedback({ kind, enabled, now: 1_650, lastReaction: 1_000, cooldownMs: 650 }), true);
  // 触发后 lastReaction 被刷新，紧接着的第二次点击会被挡住
  const firedAt = 1_650;
  assert.equal(shouldFireFeedback({ kind, enabled, now: firedAt + 120, lastReaction: firedAt, cooldownMs: 650 }), false);
  assert.equal(shouldFireFeedback({ kind, enabled, now: firedAt + 700, lastReaction: firedAt, cooldownMs: 650 }), true);
});

test('冷却为 0 时折叠单击可以连续触发', () => {
  const enabled = { ...defaultEnabled, double: false };
  const kind = doubleClickFallbackKind({ doubleEnabled: enabled.double, region: 'head' });
  assert.equal(shouldFireFeedback({ kind, enabled, now: 5_000, lastReaction: 4_999, cooldownMs: 0 }), true);
});

test('双击本身不走冷却，但被关闭的 double 开关挡住', () => {
  const on = { ...defaultEnabled, double: true };
  assert.equal(shouldFireFeedback({ kind: 'double', enabled: on, now: 10, lastReaction: 10, cooldownMs: 10_000 }), true);
  const off = { ...defaultEnabled, double: false };
  assert.equal(shouldFireFeedback({ kind: 'double', enabled: off, now: 10, lastReaction: 0, cooldownMs: 650 }), false);
});

test('渲染器只在 mouseup 的双击分支做折叠，且未改动手势识别器', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /doubleClickFallbackKind\(\{doubleEnabled:interaction\.enabled\.double,region:regionAt\(e\.clientY\)\}\)/);
  assert.match(viewer, /shouldFireFeedback\(\{kind,enabled:interaction\.enabled,now,lastReaction,cooldownMs:interaction\.cooldownMs\}\)/);
  assert.match(viewer, /decision\.type==='double-click'[\s\S]{0,220}react\(doubleClickFallbackKind/);

  // gesture.mjs 属于主机（动画）范围，本轮不得出现任何改动痕迹
  const gesture = await readFile(path.resolve('src/runtime/gesture.mjs'), 'utf8');
  assert.doesNotMatch(gesture, /doubleEnabled|fallback|interaction/);
});
