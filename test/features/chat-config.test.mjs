import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_LIMITS, defaultChatPreferences, sanitizeChatPreferences, validateChatMessage } from '../../src/features/chat/config.mjs';

test('对话默认关闭、follow 模式、256 tokens、6 轮、空人格', () => {
  assert.deepEqual(defaultChatPreferences(), { enabled: false, mode: 'follow', backend: 'simulated', realConsent: false, maxTokens: 256, historyTurns: 6, persona: '' });
});

test('非对象输入保留上一份配置', () => {
  const previous = { ...defaultChatPreferences(), enabled: true, mode: 'pet' };
  for (const input of [null, undefined, 42, 'x', []]) {
    assert.deepEqual(sanitizeChatPreferences(input, previous), previous);
  }
});

test('enabled 只接受布尔，mode 只接受白名单', () => {
  const base = defaultChatPreferences();
  assert.equal(sanitizeChatPreferences({ enabled: true }, base).enabled, true);
  assert.equal(sanitizeChatPreferences({ enabled: 'yes' }, base).enabled, false);
  assert.equal(sanitizeChatPreferences({ mode: 'pet' }, base).mode, 'pet');
  assert.equal(sanitizeChatPreferences({ mode: 'chat' }, base).mode, 'follow');
  assert.equal(sanitizeChatPreferences({ mode: null }, base).mode, 'follow');
});

test('maxTokens 与 historyTurns 的边界与取整', () => {
  const base = defaultChatPreferences();
  assert.equal(sanitizeChatPreferences({ maxTokens: 16 }, base).maxTokens, 16);
  assert.equal(sanitizeChatPreferences({ maxTokens: 1024 }, base).maxTokens, 1024);
  assert.equal(sanitizeChatPreferences({ maxTokens: 15 }, base).maxTokens, 256);
  assert.equal(sanitizeChatPreferences({ maxTokens: 1025 }, base).maxTokens, 256);
  assert.equal(sanitizeChatPreferences({ maxTokens: 128.6 }, base).maxTokens, 129);
  assert.equal(sanitizeChatPreferences({ historyTurns: 0 }, base).historyTurns, 0);
  assert.equal(sanitizeChatPreferences({ historyTurns: 20 }, base).historyTurns, 20);
  assert.equal(sanitizeChatPreferences({ historyTurns: 21 }, base).historyTurns, 6);
  assert.equal(sanitizeChatPreferences({ historyTurns: Number.NaN }, base).historyTurns, 6);
});

test('persona 去空白并截断，未知字段被丢弃', () => {
  const base = defaultChatPreferences();
  assert.equal(sanitizeChatPreferences({ persona: '  温柔一点  ' }, base).persona, '温柔一点');
  assert.equal(sanitizeChatPreferences({ persona: 'x'.repeat(300) }, base).persona.length, CHAT_LIMITS.persona.maxLength);
  const next = sanitizeChatPreferences({ evil: 1, maxTokens: 32 }, base);
  assert.equal(next.evil, undefined);
  assert.deepEqual(Object.keys(next).sort(), ['backend', 'enabled', 'historyTurns', 'maxTokens', 'mode', 'persona', 'realConsent']);
});

test('消息校验：空白、非字符串、超长与边界', () => {
  assert.deepEqual(validateChatMessage('  你好  '), { ok: true, text: '你好' });
  assert.deepEqual(validateChatMessage(''), { ok: false, code: 'empty-text' });
  assert.deepEqual(validateChatMessage('   '), { ok: false, code: 'empty-text' });
  assert.deepEqual(validateChatMessage(42), { ok: false, code: 'invalid-text' });
  assert.equal(validateChatMessage('字'.repeat(500)).ok, true);
  assert.deepEqual(validateChatMessage('字'.repeat(501)), { ok: false, code: 'text-too-long' });
  // 按字符（码点）而不是 UTF-16 单元计数：500 个 emoji 应通过
  assert.equal(validateChatMessage('🙂'.repeat(500)).ok, true);
});
