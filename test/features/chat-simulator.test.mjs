import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIMULATED_BADGE, simulatedReplyText, streamSimulatedReply } from '../../src/features/chat/simulator.mjs';

async function collect(options) {
  const chunks = [];
  for await (const chunk of streamSimulatedReply(options)) chunks.push(chunk);
  return chunks;
}

test('正常模式：分片拼起来是带模拟标记的回复，并回显用户输入', async () => {
  const chunks = await collect({ prompt: '晚上好', delayMs: 0 });
  const text = chunks.join('');
  assert.ok(text.startsWith(SIMULATED_BADGE));
  assert.ok(text.includes('晚上好'));
  assert.ok(text.includes('本地假模型'));
  assert.equal(chunks.length > 3, true);
});

test('follow 模式产出跟随示例消息，而不是 pet 回显', async () => {
  const text = (await collect({ prompt: 'irrelevant', mode: 'follow', delayMs: 0 })).join('');
  assert.ok(text.includes('开发会话'));
  assert.equal(text.includes('irrelevant'), false);
});

test('空场景不产出任何分片', async () => {
  assert.deepEqual(await collect({ prompt: 'x', scenario: 'empty', delayMs: 0 }), []);
});

test('故障注入：抛出具名错误码', async () => {
  await assert.rejects(
    () => collect({ prompt: 'x', scenario: 'error', delayMs: 0 }),
    error => error.code === 'SIMULATED_UPSTREAM_ERROR',
  );
});

test('stall 场景只发一片，交给上层超时处理', async () => {
  const chunks = await collect({ prompt: 'x', scenario: 'stall', delayMs: 0 });
  assert.equal(chunks.length, 1);
});

test('取消后立即停止产出', async () => {
  const controller = new AbortController();
  const chunks = [];
  for await (const chunk of streamSimulatedReply({ prompt: '一二三四五六七八九十', delayMs: 5, chunkSize: 1, signal: controller.signal })) {
    chunks.push(chunk);
    if (chunks.length === 2) controller.abort();
  }
  assert.equal(chunks.length, 2);
});

test('回复文本本身不会拼出密钥样式的字符串', () => {
  const text = simulatedReplyText('你好', 'pet');
  assert.equal(/sk-[A-Za-z0-9_-]{16,}/.test(text), false);
});

test('hang 场景真正挂起，取消后立即返回且不产出', async () => {
  const controller = new AbortController();
  const chunks = [];
  const task = (async () => {
    for await (const chunk of streamSimulatedReply({ prompt: 'x', scenario: 'hang', signal: controller.signal })) chunks.push(chunk);
  })();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(chunks.length, 0, '挂起期间不应产出任何分片');
  controller.abort();
  await task;
  assert.deepEqual(chunks, []);
});