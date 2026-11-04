import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_BRIDGE_FILE, HOST_BRIDGE_LIMITS, HOST_BRIDGE_PROTOCOL, readHostBridgeInfo, startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function startBridge(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [];
  await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({ version: 1, chat: options.chat || { enabled: true, mode: 'pet', backend: 'simulated' } }), 'utf8');
  const bridge = await startHostBridge({ configDir: dir, log: line => logs.push(line), ...options });
  t.after(() => bridge.close());
  return { dir, bridge, logs, file: path.join(dir, HOST_BRIDGE_FILE) };
}

const post = (bridge, body, { token = bridge.info.token, origin, raw } = {}) => fetch(`${bridge.url}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
  body: raw ?? JSON.stringify(body),
});

function parse(text) {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push({ event: frame.event, data: JSON.parse(frame.data) }) });
  parser.push(text);
  parser.end();
  return frames;
}

test('启动后写 host-bridge.json：回环地址、随机令牌、协议与 pid 完整', async t => {
  const { bridge, file } = await startBridge(t);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(raw.protocol, HOST_BRIDGE_PROTOCOL);
  assert.equal(raw.host, '127.0.0.1');
  assert.equal(raw.port, bridge.info.port);
  assert.equal(raw.token, bridge.info.token);
  assert.equal(raw.token.length >= 32, true);
  assert.equal(raw.pid, process.pid);
  assert.deepEqual(raw.capabilities.chat, ['simulated']);
  const parsed = readHostBridgeInfo(raw);
  assert.equal(parsed.url, `http://127.0.0.1:${raw.port}`);
});

test('readHostBridgeInfo 拒绝缺字段、错误协议与非法端口', () => {
  assert.equal(readHostBridgeInfo('not json'), null);
  assert.equal(readHostBridgeInfo({ version: 1, protocol: 'x', host: '127.0.0.1', port: 1, token: 'a'.repeat(40), pid: 1 }), null);
  assert.equal(readHostBridgeInfo({ version: 1, protocol: HOST_BRIDGE_PROTOCOL, host: '0.0.0.0', port: 1, token: 'a'.repeat(40), pid: 1 }), null);
  assert.equal(readHostBridgeInfo({ version: 1, protocol: HOST_BRIDGE_PROTOCOL, host: '127.0.0.1', port: 70000, token: 'a'.repeat(40), pid: 1 }), null);
  assert.equal(readHostBridgeInfo({ version: 1, protocol: HOST_BRIDGE_PROTOCOL, host: '127.0.0.1', port: 1234, token: 'short', pid: 1 }), null);
});

test('认证：缺失或错误令牌返回 401，未知路径 404，外部 Origin 403', async t => {
  const { bridge } = await startBridge(t);
  assert.equal((await post(bridge, { text: '你好' }, { token: null })).status, 401);
  assert.equal((await post(bridge, { text: '你好' }, { token: 'wrong' })).status, 401);
  assert.equal((await fetch(`${bridge.url}/nope`, { method: 'POST' })).status, 404);
  assert.equal((await post(bridge, { text: '你好' }, { origin: 'http://evil.example' })).status, 403);
});

test('正常响应：SSE meta → delta → end，全部来自模拟后端', async t => {
  const { bridge } = await startBridge(t);
  const response = await post(bridge, { text: '晚上好', mode: 'pet' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const frames = parse(await response.text());
  assert.equal(frames[0].data.type, 'meta');
  assert.equal(frames[0].data.simulated, true);
  assert.equal(frames[0].data.backend, 'simulated');
  const text = frames.filter(f => f.data.type === 'delta').map(f => f.data.text).join('');
  assert.ok(text.includes('晚上好'));
  assert.equal(frames.at(-1).data.type, 'end');
  assert.equal(frames.at(-1).data.reason, 'ok');
});

test('文本校验与请求体上限', async t => {
  const { bridge } = await startBridge(t);
  assert.equal((await post(bridge, { text: '   ' })).status, 400);
  assert.equal((await post(bridge, { text: '字'.repeat(501) })).status, 400);
  const oversized = JSON.stringify({ text: 'x'.repeat(HOST_BRIDGE_LIMITS.bodyBytes) });
  assert.equal((await post(bridge, null, { raw: oversized })).status, 413);
});

test('并发限制 1 与每分钟 6 次限流', async t => {
  const { bridge } = await startBridge(t);
  const first = await post(bridge, { text: '第一条' });
  assert.equal(first.status, 200);
  assert.equal((await post(bridge, { text: '第二条' })).status, 429);
  await first.text();

  for (let i = 0; i < 5; i++) {
    const response = await post(bridge, { text: `补${i}` });
    assert.equal(response.status, 200, `第 ${i + 2} 次应通过`);
    await response.text();
  }
  const blocked = await post(bridge, { text: '第 8 次' });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'rate-limited');
});

test('上游挂起：超时返回 error{timeout} 并释放并发', async t => {
  const { bridge } = await startBridge(t, { scenario: 'hang', timeoutMs: 250 });
  const response = await post(bridge, { text: '会超时' });
  assert.equal(response.status, 200);
  const frames = parse(await response.text());
  assert.equal(frames.find(f => f.data.type === 'error')?.data.code, 'timeout');
  assert.equal(frames.some(f => f.data.type === 'end'), false);

  // 释放后再发一次（同样超时）应能正常进入流，而不是 429
  const again = await post(bridge, { text: '再来一次' });
  assert.equal(again.status, 200);
  await again.text();
});

test('关闭后删除桥接文件、端口不再接受连接', async t => {
  const { bridge, file } = await startBridge(t);
  await bridge.close();
  await assert.rejects(stat(file));
  await assert.rejects(fetch(`${bridge.url}/chat`, { method: 'POST', body: '{}' }));
});

test('日志不含正文与令牌', async t => {
  const { bridge, logs } = await startBridge(t);
  await (await post(bridge, { text: '这是一段不该出现在日志里的正文' })).text();
  const joined = logs.join('\n');
  assert.equal(joined.includes('这是一段不该出现在日志里的正文'), false);
  assert.equal(joined.includes(bridge.info.token), false);
});

const fakeModel = { get: () => ({ provider: 'fake-provider', model: 'fake-model' }) };
const fakeLlm = { stream: () => (async function* () { yield { type: 'text-delta', text: '假模型' }; yield { type: 'finish', reason: { kind: 'ok' } }; })() };

test('请求正文不能绕过真实调用开关：正文声明 backend=host 也仍是模拟', async t => {
  const { bridge } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'simulated', realConsent: true },
    llm: fakeLlm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: '绕过尝试', backend: 'host', mode: 'pet' })).text());
    assert.equal(frames[0].data.backend, 'simulated');
    assert.equal(frames[0].data.simulated, true);
    assert.equal(frames.some(f => f.data.backend === 'host-llm'), false);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('用户显式选择 + 授权 + 环境变量 + 模型可用时，才切到 host-llm', async t => {
  const { bridge } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true },
    llm: fakeLlm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: '走假模型' })).text());
    assert.equal(frames[0].data.backend, 'host-llm');
    assert.equal(frames[0].data.simulated, false);
    assert.ok(frames.filter(f => f.data.type === 'delta').map(f => f.data.text).join('').includes('假模型'));
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('缺少用户同意（realConsent=false）时即使其它条件齐全也不调用模型', async t => {
  const { bridge } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: false },
    llm: fakeLlm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: '没有同意' })).text());
    assert.equal(frames[0].data.backend, 'simulated');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('模式不是 pet 时不允许真实调用', async t => {
  const { bridge } = await startBridge(t, {
    chat: { enabled: true, mode: 'follow', backend: 'host', realConsent: true },
    llm: fakeLlm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: 'follow 模式' })).text());
    assert.equal(frames[0].data.backend, 'simulated');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('上游错误只暴露稳定错误码，日志不含原始 message 与正文', async t => {
  const secret = '这是不该出现在日志里的正文';
  const failing = { stream: () => (async function* () { const error = new Error('raw failure ' + secret); error.code = 'AUTH'; throw error; })() };
  const { bridge, logs } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true },
    llm: failing,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: secret })).text());
    const error = frames.find(f => f.data.type === 'error');
    assert.ok(['AUTH', 'UPSTREAM_ERROR'].includes(error?.data.code), JSON.stringify(frames));
    const joined = logs.join('\n');
    assert.equal(joined.includes(secret), false);
    assert.equal(joined.includes('raw failure'), false);
    assert.equal(joined.includes(bridge.info.token), false);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});
test('enabled=false 时即使 backend/consent/mode/env/模型都满足，也绝不调用 llm.stream', async t => {
  let called = false;
  const llm = { stream: () => { called = true; return (async function* () { yield { type: 'finish', reason: { kind: 'ok' } }; })(); } };
  const { bridge } = await startBridge(t, {
    chat: { enabled: false, mode: 'pet', backend: 'host', realConsent: true },
    llm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: '不该调用' })).text());
    assert.equal(frames[0].data.backend, 'simulated');
    assert.equal(called, false, 'llm.stream 不得被调用');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('ACL 收敛失败时禁止真实后端，并给出非敏感原因', async t => {
  const { bridge, logs } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true },
    llm: fakeLlm,
    agentDefaultModel: fakeModel,
    restrictFile: async () => false,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: 'acl 失败' })).text());
    assert.equal(frames[0].data.backend, 'simulated');
    assert.ok(logs.some(line => line.includes('acl=unavailable')), logs.join('\n'));
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('授权阶段抛异常不会锁死 chatBusy：返回 500 后下一次请求仍可服务', async t => {
  let first = true;
  const authorize = async () => {
    if (first) { first = false; throw new Error('secret config details'); }
    return { ok: false, reasons: ['forced-simulated'], chat: { mode: 'pet' } };
  };
  const { bridge, logs } = await startBridge(t, { authorize });
  const failed = await post(bridge, { text: '第一下' });
  assert.equal(failed.status, 500);
  const next = await post(bridge, { text: '第二下' });
  assert.equal(next.status, 200);
  assert.equal(parse(await next.text())[0].data.backend, 'simulated');
  assert.equal(logs.join('\n').includes('secret config details'), false);
});

test('恶意错误码与密钥样式内容不会进入 SSE 或日志', async t => {
  const secret = ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
  const llm = { stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: `BAD CODE ${secret}` } } }; })() };
  const { bridge, logs } = await startBridge(t, {
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true },
    llm,
    agentDefaultModel: fakeModel,
  });
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const frames = parse(await (await post(bridge, { text: `正文 ${secret}` })).text());
    const error = frames.find(f => f.data.type === 'error');
    assert.equal(error?.data.code, 'UPSTREAM_ERROR');
    const joined = logs.join('\n');
    assert.equal(joined.includes(secret), false);
    assert.equal(joined.includes('BAD CODE'), false);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});