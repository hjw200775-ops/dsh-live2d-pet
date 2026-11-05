import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import {
  SHERPA_LIMITS,
  createFallbackTtsProvider,
  createProcessTransport,
  createSherpaTtsProvider,
} from '../../src/features/speech/sherpa-provider.mjs';
import { createMockTtsProvider, makeSilenceWav } from '../../src/features/speech/provider.mjs';
import { createSpeechQueue } from '../../src/features/speech/queue.mjs';
import { createSpeechState } from '../../src/features/speech/state.mjs';

const SIDECAR = fileURLToPath(new URL('../../src/features/speech/sidecar.mjs', import.meta.url));

function fakeTransport({ failPing = false } = {}) {
  const requests = [];
  return {
    requests,
    async request(message, options = {}) {
      requests.push(message);
      if (message.type === 'ping') {
        if (failPing) return { id: message.id, type: 'error', code: 'MODEL_MISSING' };
        return { id: message.id, type: 'ready', sampleRate: 16000, voices: ['zf_xiaoxiao'] };
      }
      if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'ABORTED' });
      const data = Buffer.alloc(320, 1);
      return { id: message.id, type: 'audio', format: 'pcm', sampleRate: 16000, data: data.toString('base64') };
    },
    cancel() {},
    async close() {},
  };
}

test('provider 正常合成 PCM，并校验文本/声线/语速', async () => {
  const transport = fakeTransport();
  const provider = createSherpaTtsProvider({ transport, voices: ['zf_xiaoxiao'], language: 'zh' });
  assert.deepEqual(await provider.load(), { ok: true });
  const audio = await provider.synthesize('你好', { voice: 'zf_xiaoxiao', speed: 9 });
  assert.equal(audio.format, 'pcm');
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.data.length, 320);
  const sent = transport.requests.at(-1);
  assert.equal(sent.text, '你好');
  assert.equal(sent.speed, 2, '语速被夹到上限');
  assert.equal(sent.voice, 'zf_xiaoxiao');

  await assert.rejects(() => provider.synthesize('   '), /empty text/);
  await assert.rejects(() => provider.synthesize('x'.repeat(SHERPA_LIMITS.maxChars + 1)), /too long/);
});

test('加载失败可重试：第一次 MODEL_MISSING，修好后可用', async () => {
  let failing = true;
  const transport = {
    async request(message) {
      if (message.type === 'ping') {
        if (failing) return { id: 1, type: 'error', code: 'MODEL_MISSING' };
        return { id: message.id, type: 'ready', sampleRate: 16000, voices: [] };
      }
      return { id: message.id, type: 'audio', format: 'pcm', sampleRate: 16000, data: Buffer.alloc(4).toString('base64') };
    },
    cancel() {},
  };
  const logs = [];
  const provider = createSherpaTtsProvider({ transport, log: line => logs.push(line) });
  const first = await provider.load();
  assert.equal(first.ok, false);
  assert.equal(first.code, 'MODEL_MISSING');
  failing = false;
  assert.deepEqual(await provider.load(), { ok: true });
  const audio = await provider.synthesize('恢复');
  assert.ok(audio.data.length > 0);
  assert.equal(logs.some(line => line.includes('MODEL_MISSING')), true);
});

test('取消正在合成的任务：抛出 ABORTED，且不泄漏正文', async () => {
  const controller = new AbortController();
  const transport = {
    request(message, options) {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORTED' })), { once: true });
      });
    },
    cancel(target) { this.cancelled = target; },
  };
  const provider = createSherpaTtsProvider({ transport });
  const pending = provider.synthesize('取消我', {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.code === 'ABORTED');
});

test('失败后回退 Mock，并保留 degraded 标记', async () => {
  const primary = {
    name: 'sherpa', languages: ['zh', 'en'],
    async load() { return { ok: false, code: 'SHERPA_UNAVAILABLE' }; },
    async synthesize() { throw Object.assign(new Error('no model'), { code: 'MODEL_MISSING' }); },
    async unload() {},
  };
  const fallback = createMockTtsProvider();
  const logs = [];
  const provider = createFallbackTtsProvider({ primary, fallback, log: line => logs.push(line) });
  await provider.load();
  assert.equal(provider.degraded, true);
  const audio = await provider.synthesize('回退测试');
  assert.equal(audio.format, 'wav');
  assert.ok(audio.data.length > 44);
  assert.equal(logs.some(line => line.includes('MODEL_MISSING')), true);
});

test('错误信息只保留白名单错误码', async () => {
  const transport = {
    async request(message) {
      if (message.type === 'ping') return { id: 1, type: 'ready', sampleRate: 16000, voices: [] };
      return { id: message.id, type: 'error', code: 'bad code with secret text' };
    },
  };
  const provider = createSherpaTtsProvider({ transport });
  await provider.load();
  await assert.rejects(() => provider.synthesize('秘密正文'), error => error.code === 'TTS_FAILED');
});

test('真实子进程 sidecar（fake 模式）：加载、合成、关闭与退出清理', async t => {
  const transport = createProcessTransport({
    nodePath: process.execPath,
    sidecarPath: SIDECAR,
    env: { DSH_LIVE2D_TTS_FAKE: '1', DSH_LIVE2D_TTS_MODEL_DIR: '' },
  });
  t.after(() => transport.close());
  const provider = createSherpaTtsProvider({ transport, voices: ['default'] });
  const loaded = await provider.load();
  assert.deepEqual(loaded, { ok: true });
  const audio = await provider.synthesize('子进程合成');
  assert.equal(audio.format, 'pcm');
  assert.equal(audio.sampleRate, 24000);
  assert.ok(audio.data.length > 100);
  assert.ok(audio.durationMs > 0);

  await transport.close();
  await assert.rejects(() => provider.synthesize('关闭后'), error => ['SIDECAR_CLOSED', 'SIDECAR_EXITED'].includes(error.code));
});

test('缺少 sherpa 原生库时明确返回 SHERPA_UNAVAILABLE，不下载', async t => {
  const transport = createProcessTransport({
    nodePath: process.execPath,
    sidecarPath: SIDECAR,
    env: { DSH_LIVE2D_TTS_FAKE: '0', DSH_LIVE2D_TTS_MODEL_DIR: 'C:/nonexistent-live2d-model' },
  });
  t.after(() => transport.close());
  const provider = createSherpaTtsProvider({ transport });
  const result = await provider.load();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SHERPA_UNAVAILABLE');
  await transport.close();
});

test('sidecar 协议：ping/合成/cancel/shutdown', async t => {
  const child = spawn(process.execPath, [SIDECAR], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DSH_LIVE2D_TTS_FAKE: '1' },
    windowsHide: true,
  });
  t.after(() => { try { child.kill(); } catch { /* 忽略 */ } });
  const rl = createInterface({ input: child.stdout });
  const waiters = new Map();
  rl.on('line', line => { const message = JSON.parse(line); waiters.get(message.id)?.(message); });
  const send = (message, id) => new Promise(resolve => { waiters.set(id, resolve); child.stdin.write(JSON.stringify({ ...message, id }) + '\n'); });

  const ready = await send({ type: 'ping' }, 1);
  assert.equal(ready.type, 'ready');
  assert.equal(ready.sampleRate, 24000);
  const audio = await send({ type: 'synthesize', text: '协议测试' }, 2);
  assert.equal(audio.type, 'audio');
  assert.ok(audio.data.length > 0);
  child.stdin.write(JSON.stringify({ type: 'cancel', target: 2 }) + '\n');
  const bye = await send({ type: 'shutdown' }, 3);
  assert.equal(bye.type, 'bye');
});

test('队列 + Sherpa provider：串行、停止后 RMS 归零', async () => {
  const state = createSpeechState();
  const rms = [];
  state.on('rms', event => rms.push(event.rms));
  const provider = createSherpaTtsProvider({ transport: fakeTransport() });
  await provider.load();
  const played = [];
  const player = {
    play(audio) { played.push(audio); return new Promise(resolve => setTimeout(resolve, 5)); },
    stop() {}, dispose() {},
  };
  const queue = createSpeechQueue({ provider, player, state });
  queue.enqueue('第一条', { id: 1, source: 'pet' });
  queue.enqueue('第二条', { id: 2, source: 'pet' });
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(played.length, 2);
  queue.stop();
  assert.equal(queue.state, 'stopped');
  assert.equal(rms.at(-1), 0);
});
