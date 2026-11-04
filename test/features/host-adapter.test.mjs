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

test('StreamChunk 映射：text-delta / finish(ok, aborted, error)', () => {
  assert.deepEqual(mapStreamChunk({ type: 'text-delta', text: 'hi' }), { kind: 'delta', text: 'hi' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'ok' } }), { kind: 'finish', reason: 'ok' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'aborted' } }), { kind: 'finish', reason: 'aborted' });
  assert.deepEqual(mapStreamChunk({ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT' } } }), { kind: 'finish', reason: 'error', code: 'RATE_LIMIT' });
  assert.equal(mapStreamChunk({ type: 'block-end' }), null);
  assert.equal(mapStreamChunk(null), null);
});

test('streamHostChat 透传分片并在错误 finish 时抛具名错误', async () => {
  const llm = {
    stream: () => (async function* () {
      yield { type: 'text-delta', text: '你' };
      yield { type: 'text-delta', text: '好' };
      yield { type: 'finish', reason: { kind: 'ok' } };
    })(),
  };
  const chunks = [];
  for await (const chunk of streamHostChat({ llm, provider: 'p', model: 'm', messages: [] })) chunks.push(chunk);
  assert.deepEqual(chunks.map(c => c.text).join(''), '你好');

  const failing = { stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } }; })() };
  await assert.rejects(async () => { for await (const chunk of streamHostChat({ llm: failing, provider: 'p', model: 'm', messages: [] })) void chunk; }, error => error instanceof HostChatError && error.code === 'AUTH');
});

test('streamHostChat 在缺少服务或取消时安全退出', async () => {
  await assert.rejects(async () => { for await (const chunk of streamHostChat({ llm: {}, provider: 'p', model: 'm', messages: [] })) void chunk; }, error => error.code === 'NO_LLM_SERVICE');

  const controller = new AbortController();
  let returned = false;
  const llm = {
    stream: ({ signal }) => (async function* () {
      try {
        yield { type: 'text-delta', text: 'a' };
        yield { type: 'text-delta', text: 'b' };
        void signal;
      } finally { returned = true; }
    })(),
  };
  const chunks = [];
  for await (const chunk of streamHostChat({ llm, provider: 'p', model: 'm', messages: [], signal: controller.signal })) {
    chunks.push(chunk);
    controller.abort();
    break;
  }
  assert.equal(chunks.length, 1);
  assert.equal(returned, true, '上游迭代器应被 return 收尾');
});

test('真实调用默认不允许：必须 backend=host 且显式环境变量', () => {
  assert.equal(realChatEnabled({ env: {}, chat: { backend: 'host' } }).ok, false);
  assert.equal(realChatEnabled({ env: { DSH_LIVE2D_CHAT_REAL: '1' }, chat: { backend: 'simulated' } }).ok, false);
  assert.equal(realChatEnabled({ env: { DSH_LIVE2D_CHAT_REAL: '1' }, chat: { backend: 'host' } }).ok, true);
  const defaults = defaultChatPreferences();
  assert.equal(defaults.backend, 'simulated');
  assert.equal(sanitizeChatPreferences({ backend: 'host' }, defaults).backend, 'host');
  assert.equal(sanitizeChatPreferences({ backend: 'evil' }, defaults).backend, 'simulated');
});
