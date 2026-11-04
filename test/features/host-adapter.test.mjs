import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HostChatError,
  mapStreamChunk,
  realChatEnabled,
  resolveHostModel,
  streamHostChat,
} from '../../src/features/chat/host-adapter.mjs';
import { defaultChatPreferences, sanitizeChatPreferences } from '../../src/features/chat/config.mjs';

async function collect(options) {
  const chunks = [];
  for await (const chunk of streamHostChat(options)) chunks.push(chunk);
  return chunks;
}

test('默认模型优先来自 agentDefaultModel，不写死 deepseek-flash', async () => {
  const resolved = await resolveHostModel({ agentDefaultModel: { get: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) } });
  assert.deepEqual(resolved, { provider: 'deepseek-account', model: 'deepseek-flash', source: 'agent-default-model' });
});

test('agentDefaultModel 为异步解析时同样可用', async () => {
  const resolved = await resolveHostModel({ agentDefaultModel: { resolve: async () => ({ provider: 'p', model: 'm' }) } });
  assert.equal(resolved?.provider, 'p');
});

test('没有默认模型时退回 listProviders/listModels', async () => {
  const llm = {
    listProviders: () => [{ id: 'prov-a' }, { id: 'prov-b' }],
    listModels: async id => (id === 'prov-b' ? [{ id: 'model-b' }] : []),
  };
  assert.deepEqual(await resolveHostModel({ llm }), { provider: 'prov-b', model: 'model-b', source: 'list-models' });
});

test('模型不可用时返回 null（调用方据此降级，不抛错）', async () => {
  assert.equal(await resolveHostModel({}), null);
  assert.equal(await resolveHostModel({ llm: { listProviders: () => { throw new Error('no service'); } } }), null);
});

test('StreamChunk 映射：text-delta / finish(ok, aborted, error, unknown)', () => {
  assert.deepEqual(mapStreamChunk({ type: 'text-delta', text: 'hi' }), { kind: 'delta', text: 'hi' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'ok' } }), { kind: 'finish', reason: 'ok' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'aborted' } }), { kind: 'finish', reason: 'aborted' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT' } } }), { kind: 'finish', reason: 'error', code: 'RATE_LIMIT' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'weird' } }), { kind: 'finish', reason: 'error', code: 'UNKNOWN_FINISH' });
  assert.equal(mapStreamChunk({ type: 'block-end' }), null);
  assert.equal(mapStreamChunk(null), null);
});

test('正常流：分片后跟一个 finish.ok', async () => {
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', text: '你' };
      yield { type: 'text-delta', text: '好' };
      yield { type: 'finish', reason: { kind: 'ok' } };
    })(),
  };
  const chunks = await collect({ llm, provider: 'p', model: 'm', messages: [] });
  assert.equal(chunks.filter(c => c.kind === 'delta').map(c => c.text).join(''), '你好');
  assert.deepEqual(chunks.at(-1), { kind: 'finish', reason: 'ok' });
});

test('有文本后 aborted：终止帧是 aborted，不是 ok', async () => {
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', text: '半句' };
      yield { type: 'finish', reason: { kind: 'aborted' } };
    })(),
  };
  const chunks = await collect({ llm, provider: 'p', model: 'm', messages: [] });
  assert.deepEqual(chunks.at(-1), { kind: 'finish', reason: 'aborted' });
});

test('错误 finish：透传稳定错误码', async () => {
  const llm = { stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } }; })() };
  const chunks = await collect({ llm, provider: 'p', model: 'm', messages: [] });
  assert.deepEqual(chunks.at(-1), { kind: 'finish', reason: 'error', code: 'AUTH' });
});

test('没有 finish 就结束：判 NO_FINISH', async () => {
  const llm = { stream: () => (async function* () { yield { type: 'text-delta', text: '没有收尾' }; })() };
  const chunks = await collect({ llm, provider: 'p', model: 'm', messages: [] });
  assert.deepEqual(chunks.at(-1), { kind: 'finish', reason: 'error', code: 'NO_FINISH' });
});

test('上游不响应取消时，取消仍能在有界时间内返回并收尾', async () => {
  const controller = new AbortController();
  let returned = false;
  const llm = {
    stream: () => (async function* () {
      try {
        yield { type: 'text-delta', text: 'a' };
        await new Promise(() => {});
      } finally { returned = true; }
    })(),
  };
  const started = Date.now();
  const task = (async () => {
    const chunks = [];
    for await (const chunk of streamHostChat({ llm, provider: 'p', model: 'm', messages: [], signal: controller.signal })) chunks.push(chunk);
    return chunks;
  })();
  setTimeout(() => controller.abort(), 100);
  const chunks = await task;
  assert.ok(Date.now() - started < 2000, '应在有界时间内结束');
  assert.deepEqual(chunks.at(-1), { kind: 'finish', reason: 'aborted' });
  // 上游既不响应 abort 也不完成时，无法强制其 finally；我们保证的是有界返回与本地收尾。
  void returned;
});

test('缺少模型服务时抛 NO_LLM_SERVICE', async () => {
  await assert.rejects(async () => { for await (const chunk of streamHostChat({ llm: {}, provider: 'p', model: 'm', messages: [] })) void chunk; }, error => error instanceof HostChatError && error.code === 'NO_LLM_SERVICE');
});

test('真实调用默认不允许：必须 backend=host 且显式环境变量', () => {
  assert.equal(realChatEnabled({ env: {}, chat: { backend: 'host' } }).ok, false);
  assert.equal(realChatEnabled({ env: { DSH_LIVE2D_CHAT_REAL: '1' }, chat: { backend: 'simulated' } }).ok, false);
  assert.equal(realChatEnabled({ env: { DSH_LIVE2D_CHAT_REAL: '1' }, chat: { backend: 'host' } }).ok, true);
  const defaults = defaultChatPreferences();
  assert.equal(defaults.backend, 'simulated');
  assert.equal(defaults.realConsent, false);
  assert.equal(sanitizeChatPreferences({ backend: 'host', realConsent: true }, defaults).realConsent, true);
  assert.equal(sanitizeChatPreferences({ backend: 'evil' }, defaults).backend, 'simulated');
});
