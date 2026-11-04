import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HOST_BRIDGE_FILE, HOST_BRIDGE_LIMITS, HOST_BRIDGE_PROTOCOL, readHostBridgeInfo, startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function startBridge(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const logs = [];
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
