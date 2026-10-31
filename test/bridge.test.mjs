import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createActivity, createDesktopLink } from '../src/activity.js';
import { startBridgePublisher } from '../src/bridge.mjs';
import { startViewer } from '../src/viewer-server.js';

test('desktop link follows a reduced DSH snapshot and drops to idle when the host goes quiet', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-live2d-bridge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'Animation'));
  await Promise.all([
    writeFile(path.join(dir, 'test.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 'test.moc3', Textures: ['texture.png'] } })),
    writeFile(path.join(dir, 'test.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(dir, 'texture.png'), 'test texture'),
    writeFile(path.join(dir, 'core.js'), '// test only'),
    writeFile(path.join(dir, 'Animation/IDLE.motion3.json'), '{}'),
  ]);
  const link = createDesktopLink({ staleMs: 80 });
  const source = createActivity();
  t.after(() => { source.dispose(); link.dispose(); });
  const bridgeFile = path.join(dir, 'desktop-bridge.json');
  const viewer = await startViewer({ modelFile: path.join(dir, 'test.model3.json'), coreFile: path.join(dir, 'core.js'), activity: link, bridgeFile });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await viewer.close(); };
  t.after(close);
  assert.equal(link.snapshot().connected, false);
  const info = JSON.parse(await readFile(bridgeFile, 'utf8'));
  const post = (body, token = info.token) => fetch(`http://127.0.0.1:${info.port}/bridge`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ mode: 'nope' })).status, 400);
  assert.equal((await post({ mode: 'thinking', activeCount: 1, text: 'secret prompt' }, 'wrong-token')).status, 403);
  assert.equal(JSON.stringify(link.snapshot()).includes('secret'), false);
  const stop = startBridgePublisher({ activity: source, bridgeFile, intervalMs: 1000 });
  t.after(stop);
  source.receive('agent/status', { agent: { id: 'one' }, status: 'running' });
  source.receive('agent/assistant-stream', { agent: { id: 'one' }, frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'private answer' } } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(link.snapshot().mode, 'answering');
  assert.equal(link.snapshot().connected, true);
  assert.equal(JSON.stringify(link.snapshot()).includes('private'), false);
  stop();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(link.snapshot().connected, false);
  assert.equal(link.snapshot().mode, 'idle');
  assert.equal(await readFile(bridgeFile, 'utf8').then(() => true, () => false), true);
  await close();
  assert.equal(await readFile(bridgeFile, 'utf8').then(() => true, () => false), false);
});
