import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONVERSATION_LIMITS, createPetConversation } from '../../src/features/chat/conversation.mjs';

test('6 轮窗口滚动：只保留最近 6 轮', () => {
  const conversation = createPetConversation();
  for (let i = 1; i <= 8; i++) conversation.commit(conversation.begin(`u${i}`, 'host-llm'), `a${i}`);
  const history = conversation.history('host-llm', 6);
  assert.equal(history.length, 6);
  assert.deepEqual(history[0], { user: 'u3', assistant: 'a3' });
  assert.deepEqual(history.at(-1), { user: 'u8', assistant: 'a8' });
});

test('historyTurns=0 返回空；最大 20 轮封顶', () => {
  const conversation = createPetConversation();
  for (let i = 0; i < 25; i++) conversation.commit(conversation.begin(`u${i}`, 'host-llm'), `a${i}`);
  assert.deepEqual(conversation.history('host-llm', 0), []);
  assert.equal(conversation.history('host-llm', 20).length, 20);
  assert.equal(conversation.history('host-llm', 100).length, 20);
  assert.equal(CONVERSATION_LIMITS.maxTurns, 20);
});

test('实例隔离：两个对话互不可见', () => {
  const a = createPetConversation();
  const b = createPetConversation();
  a.commit(a.begin('只有 A', 'host-llm'), 'A 的回复');
  assert.equal(a.history('host-llm', 6).length, 1);
  assert.deepEqual(b.history('host-llm', 6), []);
  a.clear();
  assert.deepEqual(a.history('host-llm', 6), []);
});

test('按后端隔离：模拟轮次不会进入真实请求的历史', () => {
  const conversation = createPetConversation();
  conversation.commit(conversation.begin('模拟问题', 'simulated'), '模拟回答');
  conversation.commit(conversation.begin('真实问题', 'host-llm'), '真实回答');
  assert.deepEqual(conversation.history('host-llm', 6), [{ user: '真实问题', assistant: '真实回答' }]);
  assert.deepEqual(conversation.history('simulated', 6), [{ user: '模拟问题', assistant: '模拟回答' }]);
});

test('取消/失败/空回复都不写入历史', () => {
  const conversation = createPetConversation();
  const pending = conversation.begin('会取消', 'host-llm');
  conversation.abort(pending);
  assert.deepEqual(conversation.history('host-llm', 6), []);

  const empty = conversation.begin('空回复', 'host-llm');
  assert.equal(conversation.commit(empty, '   '), false);
  assert.deepEqual(conversation.history('host-llm', 6), []);

  const wrong = conversation.begin('错误句柄', 'host-llm');
  assert.equal(conversation.commit({}, '不该写入'), false);
  conversation.abort(wrong);
  assert.deepEqual(conversation.history('host-llm', 6), []);
});

test('单条与总字符硬上限：超限截断/丢弃最旧', () => {
  const conversation = createPetConversation({ maxMessageChars: 10, maxTotalChars: 30 });
  conversation.commit(conversation.begin('x'.repeat(50), 'host-llm'), 'y'.repeat(50));
  const history = conversation.history('host-llm', 6);
  assert.equal([...history[0].user].length, 10);
  assert.equal([...history[0].assistant].length, 10);

  for (let i = 0; i < 5; i++) conversation.commit(conversation.begin('u' + i, 'host-llm'), 'a' + i);
  const kept = conversation.history('host-llm', 20);
  const chars = kept.reduce((sum, turn) => sum + turn.user.length + turn.assistant.length, 0);
  assert.ok(chars <= 30, `总字符 ${chars} 应 <= 30`);
});

test('clear 清空历史与未完成轮次', () => {
  const conversation = createPetConversation();
  conversation.begin('进行中', 'host-llm');
  conversation.commit(conversation.begin('已完成', 'host-llm'), '回答');
  conversation.clear();
  assert.deepEqual(conversation.history('host-llm', 6), []);
  assert.deepEqual(conversation.snapshot(), { turns: 0, pending: false, chars: 0 });
});
