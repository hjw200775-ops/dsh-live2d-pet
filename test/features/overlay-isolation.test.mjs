import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewer-server.js';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';
import { canUseHostBackend } from '../../src/features/chat/config.mjs';

async function fixture(t, mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-overlay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  await Promise.all([
    writeFile(path.join(root, 't.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 't.moc3', Textures: ['t.png'] } })),
    writeFile(path.join(root, 't.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(root, 't.png'), 'x'),
    writeFile(path.join(root, 'core.js'), '// core'),
    writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
    writeFile(path.join(root, 'preferences.desktop.json'), JSON.stringify({
      version: 1,
      chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true },
      follow: { enabled: true, sessionId: 's1' },
    })),
    writeFile(path.join(root, 'preferences.json'), JSON.stringify({ version: 1, chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true } })),
  ]);
  const viewer = await startViewer({
    modelFile: path.join(root, 't.model3.json'),
    coreFile: path.join(root, 'core.js'),
    configDir: root,
    preferencesFile: path.join(root, 'preferences.json'),
    mode,
  });
  t.after(() => viewer.close());
  return { root, base: new URL('.', viewer.url) };
}

const post = (base, pathName, body) => fetch(new URL(pathName, base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base.origin },
  body: JSON.stringify(body ?? {}),
});

function parse(text) {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
  parser.push(text);
  parser.end();
  return frames;
}

test('Overlay 即使有 Desktop 授权也绝不调用真实模型', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  let calls = 0;
  try {
    const { root, base } = await fixture(t, 'overlay');
    const source = { list: async () => [{ id: 's1', title: '会话一' }], subscribe: () => () => {} };
    const host = await startHostBridge({
      configDir: root,
      sessionSource: source,
      llm: { stream: () => { calls++; return (async function* () { yield { type: 'text-delta', text: '不该出现' }; yield { type: 'finish', reason: { kind: 'ok' } }; })(); } },
      agentDefaultModel: { get: () => ({ provider: 'fake', model: 'm' }) },
    });
    t.after(() => host.close());

    const frames = parse(await (await post(base, 'chat', { text: 'Overlay 请求' })).text());
    assert.equal(frames[0].type, 'meta');
    assert.equal(frames[0].simulated, true);
    assert.equal(frames[0].degraded, true);
    assert.equal(frames[0].reason, 'overlay-simulated-only');
    assert.equal(calls, 0, 'Overlay 请求不得触发 llm.stream');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('Overlay 不支持 Follow（409），Desktop 模式不受影响', async t => {
  const { base } = await fixture(t, 'overlay');
  const response = await post(base, 'follow', { sessionId: 's1' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'overlay-unsupported');
});

test('Desktop 模式仍可走 Host（对照组）', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  let calls = 0;
  try {
    const { root, base } = await fixture(t, 'desktop');
    const host = await startHostBridge({
      configDir: root,
      sessionSource: { list: async () => [], subscribe: () => () => {} },
      llm: { stream: () => { calls++; return (async function* () { yield { type: 'text-delta', text: '真实后端示例' }; yield { type: 'finish', reason: { kind: 'ok' } }; })(); } },
      agentDefaultModel: { get: () => ({ provider: 'fake', model: 'm' }) },
    });
    t.after(() => host.close());
    const frames = parse(await (await post(base, 'chat', { text: 'Desktop 请求' })).text());
    assert.equal(frames[0].backend, 'host-llm');
    assert.equal(frames[0].simulated, false);
    assert.equal(calls, 1);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('未授权时服务端二次检查：backend=host 但没有许可也不转发 Host', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  let calls = 0;
  try {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-gate-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, 'Animation'));
    await Promise.all([
      writeFile(path.join(root, 't.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 't.moc3', Textures: ['t.png'] } })),
      writeFile(path.join(root, 't.moc3'), Buffer.from([77, 79, 67, 51, 5])),
      writeFile(path.join(root, 't.png'), 'x'),
      writeFile(path.join(root, 'core.js'), '// core'),
      writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
    ]);
    const chat = { enabled: true, mode: 'pet', backend: 'host', realConsent: false };
    await writeFile(path.join(root, 'preferences.json'), JSON.stringify({ version: 1, chat }));
    await writeFile(path.join(root, 'preferences.desktop.json'), JSON.stringify({ version: 1, chat }));
    const viewer = await startViewer({
      modelFile: path.join(root, 't.model3.json'),
      coreFile: path.join(root, 'core.js'),
      configDir: root,
      preferencesFile: path.join(root, 'preferences.json'),
      mode: 'desktop',
    });
    t.after(() => viewer.close());
    const host = await startHostBridge({
      configDir: root,
      llm: { stream: () => { calls++; return (async function* () { yield { type: 'text-delta', text: '不该调用' }; yield { type: 'finish', reason: { kind: 'ok' } }; })(); } },
      agentDefaultModel: { get: () => ({ provider: 'fake', model: 'm' }) },
    });
    t.after(() => host.close());
    const frames = parse(await (await post(new URL('.', viewer.url), 'chat', { text: '无许可请求' })).text());
    assert.equal(frames[0].simulated, true);
    assert.equal(frames[0].degraded, true);
    assert.equal(frames[0].reason, 'not-authorized');
    assert.equal(calls, 0);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('canUseHostBackend 只在 enabled + host + consent 同时满足时为真', () => {
  assert.equal(canUseHostBackend({ enabled: true, backend: 'host', realConsent: true }), true);
  assert.equal(canUseHostBackend({ enabled: false, backend: 'host', realConsent: true }), false);
  assert.equal(canUseHostBackend({ enabled: true, backend: 'simulated', realConsent: true }), false);
  assert.equal(canUseHostBackend({ enabled: true, backend: 'host', realConsent: false }), false);
  assert.equal(canUseHostBackend(null), false);
});
