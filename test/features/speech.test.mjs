import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechState } from '../../src/features/speech/state.mjs';
import { createMockTtsProvider, makeSilenceWav, assertTtsProvider } from '../../src/features/speech/provider.mjs';
import { createAudioPlayer } from '../../src/features/speech/player.mjs';
import { createSpeechQueue } from '../../src/features/speech/queue.mjs';

function fakePlayer({ autoEnd = true } = {}) {
  const played = [];
  const ends = [];
  let stopped = 0;
  return {
    played,
    get stopped() { return stopped; },
    play(audio, meta) {
      played.push({ audio, meta });
      return new Promise(resolve => {
        if (autoEnd) setTimeout(resolve, 0);
        else ends.push(resolve);
      });
    },
    stop() { stopped++; },
    dispose() {},
    endNext() { ends.shift()?.(); },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 20));

test('SpeechState 状态与 RMS 契约：0..1 且事件不含正文', () => {
  const state = createSpeechState({ now: () => 42 });
  const events = [];
  state.on('rms', event => events.push(event));
  state.set('speaking');
  state.publishRms(0.42);
  state.publishRms(2);
  state.publishRms(-1);
  assert.equal(state.state, 'speaking');
  assert.deepEqual(events.map(e => e.rms), [0.42, 1, 0]);
  assert.deepEqual(Object.keys(events[0]).sort(), ['at', 'rms']);
  assert.throws(() => state.set('nope'));
});

test('WAV 生成合法 RIFF 头，mock provider 不联网', async () => {
  const wav = makeSilenceWav({ durationMs: 100, sampleRate: 8000 });
  assert.equal(String.fromCharCode(...wav.data.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.data.slice(8, 12)), 'WAVE');
  assert.equal(wav.format, 'wav');
  const provider = createMockTtsProvider();
  const audio = await provider.synthesize('你好');
  assert.ok(audio.data.length > 44);
  await assert.rejects(() => provider.synthesize('   '), /empty-text/);
  assert.throws(() => assertTtsProvider({ name: 'x' }), /synthesize/);
});

test('队列按顺序播放，且不会同时播放两条', async () => {
  const player = fakePlayer({ autoEnd: false });
  const queue = createSpeechQueue({ provider: createMockTtsProvider(), player, state: createSpeechState() });
  queue.enqueue('第一条', { id: 1, source: 'pet' });
  queue.enqueue('第二条', { id: 2, source: 'pet' });
  await flush();
  assert.equal(player.played.length, 1, '第二条必须等第一条结束');
  assert.equal(queue.currentId, 1);
  player.endNext();
  await flush();
  assert.equal(player.played.length, 2);
  assert.equal(queue.currentId, 2);
  player.endNext();
  await flush();
  assert.equal(queue.state, 'idle');
});

test('停止会取消当前与排队任务，并停止播放器', async () => {
  const player = fakePlayer({ autoEnd: false });
  const queue = createSpeechQueue({ provider: createMockTtsProvider(), player, state: createSpeechState() });
  queue.enqueue('a', { id: 1 });
  queue.enqueue('b', { id: 2 });
  await flush();
  queue.stop();
  assert.equal(player.stopped, 1);
  assert.equal(queue.state, 'stopped');
  player.endNext();
  await flush();
  assert.equal(player.played.length, 1, '停止后不再播放第二条');
});

test('按 id 取消当前任务', async () => {
  const player = fakePlayer({ autoEnd: false });
  const queue = createSpeechQueue({ provider: createMockTtsProvider(), player, state: createSpeechState() });
  queue.enqueue('要取消', { id: 'turn-9' });
  await flush();
  assert.equal(queue.cancel('turn-9'), true);
  assert.equal(queue.state, 'stopped');
  assert.equal(queue.cancel('不存在'), false);
});

test('合成失败进入 error，且原因不含正文', async () => {
  const state = createSpeechState();
  const provider = { name: 'bad', languages: ['zh'], synthesize: async () => { throw new Error('泄露：聊天正文 secret words'); } };
  const queue = createSpeechQueue({ provider, player: fakePlayer(), state });
  queue.enqueue('包含秘密的正文', { id: 1 });
  await flush();
  assert.equal(state.state, 'error');
  assert.equal(state.reason, 'synthesis-failed');
  assert.equal(String(state.reason).includes('secret'), false);
});

test('失败后队列继续处理后续任务', async () => {
  let first = true;
  const provider = { name: 'flaky', languages: ['zh'], synthesize: async () => { if (first) { first = false; throw new Error('boom'); } return makeSilenceWav(); } };
  const player = fakePlayer({ autoEnd: false });
  const queue = createSpeechQueue({ provider, player, state: createSpeechState() });
  queue.enqueue('first', { id: 1 });
  queue.enqueue('second', { id: 2 });
  await flush();
  assert.equal(queue.currentId, 2);
  player.endNext();
  await flush();
  assert.equal(player.played.length, 1);
});

test('去重：短时间内相同来源与文本只播放一次', async () => {
  const player = fakePlayer();
  const queue = createSpeechQueue({ provider: createMockTtsProvider(), player, state: createSpeechState(), dedupeWindowMs: 5000 });
  assert.equal(queue.enqueue('重复', { source: 'pet' }), true);
  assert.equal(queue.enqueue('重复', { source: 'pet' }), false);
  assert.equal(queue.enqueue('重复', { source: 'follow' }), true, '不同来源不互相去重');
  await flush();
});

test('AudioPlayer：静音与音量映射到 sink', async () => {
  const calls = [];
  const sink = {
    play(audio, meta) { calls.push(meta); meta.onEnded(); },
    stop() { calls.push({ stopped: true }); },
    dispose() {},
  };
  const state = createSpeechState();
  const player = createAudioPlayer({ sink, state, volume: 0.5 });
  player.setVolume(2);
  player.setMuted(true);
  await player.play(makeSilenceWav());
  assert.equal(calls[0].volume, 0);
  assert.equal(calls[0].muted, true);
  player.setMuted(false);
  player.setVolume(0.3);
  await player.play(makeSilenceWav());
  assert.equal(calls[1].volume, 0.3);
  assert.equal(player.volume, 0.3);
});

test('dispose 释放播放器与监听器', async () => {
  const player = fakePlayer();
  const state = createSpeechState();
  const queue = createSpeechQueue({ provider: createMockTtsProvider(), player, state });
  queue.enqueue('清理', { id: 1 });
  await flush();
  queue.dispose();
  assert.equal(player.stopped >= 1, true);
  assert.equal(queue.enqueue('之后', { id: 2 }), false);
  state.publishRms(0.5); // 不再抛错
});

test('Follow 与 Pet 隔离：Follow 不经过语音队列（源码契约）', async () => {
  const { readFile } = await import('node:fs/promises');
  const viewer = await readFile(new URL('../../renderer/viewer.js', import.meta.url), 'utf8');
  const followBlock = viewer.slice(viewer.indexOf('// —— 跟随开发会话'), viewer.indexOf('if(desktopApi?.getWardrobe)'));
  assert.equal(followBlock.includes('speechQueue'), false, 'Follow 不得调用语音队列');
  assert.match(viewer, /speechQueue\.enqueue\(full,\{id:Date\.now\(\),source:'pet'\}\)/);
});
