import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewer-server.js';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function fixture(t, { backend = 'host', mode = 'pet' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-host-proxy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  await Promise.all([
    writeFile(path.join(root, 't.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 't.moc3', Textures: ['t.png'] } })),
    writeFile(path.join(root, 't.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(root, 't.png'), 'x'),
    writeFile(path.join(root, 'core.js'), '// core'),
    writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
    writeFile(path.join(root, 'preferences.json'), JSON.stringify({ version: 1, chat: { enabled: true, mode, backend } })),
  ]);
  const viewer = await startViewer({
    modelFile: path.join(root, 't.model3.json'),
    coreFile: path.join(root, 'core.js'),
    configDir: root,
    preferencesFile: path.join(root, 'preferences.json'),
  });
  t.after(() => viewer.close());
  return { root, viewer, base: new URL('.', viewer.url) };
}

function parse(text) {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
  parser.push(text);
  parser.end();
  return frames;
}

const chat = (base, body, opts = {}) => fetch(new URL('chat', base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base.origin },
  body: JSON.stringify(body),
  signal: opts.signal,
});

test('backend=host 且 Host 在线：请求被转发，帧序完整', async t => {
  const { root, base } = await fixture(t);
  const host = await startHostBridge({ configDir: root });
  t.after(() => host.close());

  const frames = parse(await (await chat(base, { text: '转发测试' })).text());
  assert.equal(frames[0].type, 'meta');
  assert.equal(frames[0].backend, 'simulated');
  assert.equal(frames[0].degraded, undefined);
  const text = frames.filter(f => f.type === 'delta').map(f => f.text).join('');
  assert.ok(text.includes('转发测试'));
  assert.equal(frames.at(-1).type, 'end');
});

test('Host 不在线：降级为本地模拟，并在 meta 标记 degraded', async t => {
  const { base } = await fixture(t);
  const frames = parse(await (await chat(base, { text: '没有 Host' })).text());
  assert.equal(frames[0].type, 'meta');
  assert.equal(frames[0].degraded, true);
  assert.equal(frames[0].reason, 'host-unavailable');
  assert.ok(frames.filter(f => f.type === 'delta').map(f => f.text).join('').includes('没有 Host'));
  assert.equal(frames.at(-1).type, 'end');
});

test('Host 中途退出：返回 host-lost，而不是假装成功', async t => {
  const { root, base } = await fixture(t);
  const host = await startHostBridge({ configDir: root, scenario: 'hang' });
  const response = await chat(base, { text: '中途断' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // 读出首帧 meta 后关闭 Host
  await reader.read().then(chunk => { buffer += decoder.decode(chunk.value, { stream: true }); });
  await host.close();
  await new Promise(resolve => setTimeout(resolve, 150));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
  } catch { /* 连接被中断也接受 */ }
  const frames = parse(buffer);
  assert.equal(frames.some(f => f.type === 'error' && f.code === 'host-lost'), true, buffer);
});

test('客户端取消：连接断开后 viewer 释放并发', async t => {
  const { root, base } = await fixture(t);
  const host = await startHostBridge({ configDir: root });
  t.after(() => host.close());

  const controller = new AbortController();
  const response = await chat(base, { text: '要中断的' }, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 400));

  const next = await chat(base, { text: '中断之后' });
  assert.equal(next.status, 200);
  await next.text();
});

test('follow 模式的 mode 会透传到 Host（不做 pet 回显）', async t => {
  const { root, base } = await fixture(t, { mode: 'follow' });
  const host = await startHostBridge({ configDir: root });
  t.after(() => host.close());
  const frames = parse(await (await chat(base, { text: '不该回显' })).text());
  const text = frames.filter(f => f.type === 'delta').map(f => f.text).join('');
  assert.ok(text.includes('开发会话'));
  assert.equal(text.includes('不该回显'), false);
});

test('假 llm + host 后端：帧来自适配器（meta backend=host-llm），不触碰真实 API', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const { root, base } = await fixture(t);
    const llm = {
      stream: () => (async function* () {
        yield { type: 'text-delta', text: '假' };
        yield { type: 'text-delta', text: '模型' };
        yield { type: 'finish', reason: { kind: 'ok' } };
      })(),
    };
    const host = await startHostBridge({ configDir: root, llm, agentDefaultModel: { get: () => ({ provider: 'fake-provider', model: 'fake-model' }) } });
    t.after(() => host.close());

    const frames = parse(await (await chat(base, { text: '调用假模型' })).text());
    assert.equal(frames[0].type, 'meta');
    assert.equal(frames[0].backend, 'host-llm');
    assert.equal(frames[0].simulated, false);
    assert.ok(frames.filter(f => f.type === 'delta').map(f => f.text).join('') === '假模型');
    assert.equal(frames.at(-1).type, 'end');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});
