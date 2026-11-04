import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startViewer } from '../../src/viewer-server.js';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-follow-proxy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  await Promise.all([
    writeFile(path.join(root, 't.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 't.moc3', Textures: ['t.png'] } })),
    writeFile(path.join(root, 't.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(root, 't.png'), 'x'),
    writeFile(path.join(root, 'core.js'), '// core'),
    writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
    writeFile(path.join(root, 'preferences.desktop.json'), JSON.stringify({ version: 1, follow: { enabled: true, sessionId: 's1' } })),
  ]);
  const viewer = await startViewer({
    modelFile: path.join(root, 't.model3.json'),
    coreFile: path.join(root, 'core.js'),
    configDir: root,
    preferencesFile: path.join(root, 'preferences.json'),
  });
  t.after(() => viewer.close());
  return { root, base: new URL('.', viewer.url) };
}

const post = (base, pathName, body) => fetch(new URL(pathName, base), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base.origin },
  body: JSON.stringify(body),
});

test('Host 不在线：会话列表与跟随流都返回 503，桌宠其它功能不受影响', async t => {
  const { base } = await fixture(t);
  const sessions = await post(base, 'follow/sessions', {});
  assert.equal(sessions.status, 503);
  assert.equal((await sessions.json()).error, 'host-unavailable');
  const follow = await post(base, 'follow', { sessionId: 's1' });
  assert.equal(follow.status, 503);
});

test('Host 在线：会话列表与只读跟随流都能透传', async t => {
  const { root, base } = await fixture(t);
  const source = {
    list: async () => [{ id: 's1', title: '会话一' }, { id: 's2', title: '会话二' }],
    subscribe(fn) { source.handler = fn; return () => { source.handler = null; }; },
  };
  const host = await startHostBridge({ configDir: root, sessionSource: source });
  t.after(() => host.close());

  const sessions = await post(base, 'follow/sessions', {});
  assert.equal(sessions.status, 200);
  assert.deepEqual((await sessions.json()).sessions.map(item => item.id), ['s1', 's2']);

  const response = await post(base, 'follow', { sessionId: 's1' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch { /* 取消正常 */ }
  })();
  await new Promise(resolve => setTimeout(resolve, 200));
  source.handler?.({ session: { id: 's1' }, event: { type: 'assistant/message', seq: 3, time: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '透传的回复' }] } } } });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(frames.some(frame => frame.type === 'follow-message' && frame.text === '透传的回复'), JSON.stringify(frames));

  await reader.cancel();
  await pump;
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(source.handler, null, '断开后 Host 侧应退订');
});

test('渲染器接线：跟随控件、SSE 解析、去重、隐私提示与隐藏按钮', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /fetch\('follow\/sessions'/);
  assert.match(viewer, /fetch\('follow'/);
  assert.match(viewer, /followSeen\.has\(payload\.seq\)/);
  assert.match(viewer, /if\(chatAbort\)\{setFollowState\('Pet 对话进行中/);
  assert.match(viewer, /showChatBubble\(payload\.text/);
  assert.match(viewer, /followAbort\?\.abort\(\)/);

  const html = await readFile(path.resolve('renderer/index.html'), 'utf8');
  for (const id of ['follow-enabled', 'follow-session', 'follow-stop', 'follow-hide', 'follow-state']) {
    assert.ok(html.includes(`id="${id}"`), `缺少控件 ${id}`);
  }
  assert.match(html, /只读/);
  assert.match(html, /隐藏内容/);
  assert.match(html, /推理、工具结果与系统提示不会展示/);
});

test('Follow 长连接没有总时长上限：只有空闲阈值才会关闭', async t => {
  process.env.DSH_LIVE2D_FOLLOW_IDLE_MS = '400';
  try {
    const { root, base } = await fixture(t);
    const source = { list: async () => [{ id: 's1', title: '会话一' }], subscribe() { return () => {}; } };
    const host = await startHostBridge({ configDir: root, sessionSource: source });
    t.after(() => host.close());

    const started = Date.now();
    const response = await post(base, 'follow', { sessionId: 's1' });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let closed = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { done } = await reader.read();
      if (done) { closed = true; break; }
    }
    assert.equal(closed, true, '空闲超过阈值后应关闭连接，而不是挂 60 秒');
    assert.ok(Date.now() - started < 3000, '关闭应发生在空闲阈值附近');
  } finally {
    delete process.env.DSH_LIVE2D_FOLLOW_IDLE_MS;
  }
});

test('渲染器：先保存后订阅、代际防旧请求、有限退避重连、用户停止不重连、持续隐藏', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /const ok=await applyFollow\(\{enabled:true\}\)/);
  assert.match(viewer, /设置保存失败，未启动跟随/);
  assert.match(viewer, /if\(follow\.sessionId!==followUI\.session\.value\)return;/);
  assert.match(viewer, /const generation=\+\+followGeneration/);
  assert.match(viewer, /followGeneration\+\+;followAbort\?\.abort\(\)/);
  assert.match(viewer, /FOLLOW_MAX_RETRIES=5/);
  assert.match(viewer, /followBackoff/);
  assert.match(viewer, /followUserStopped\|\|generation!==followGeneration/);
  assert.match(viewer, /if\(follow\.hideContent\)\{setFollowState\('收到一条新回复（已按设置隐藏）'\)/);

  const html = await readFile(path.resolve('renderer/index.html'), 'utf8');
  assert.ok(html.includes('id="follow-persistent"'));
  assert.match(html, /持续隐藏新内容/);
});
