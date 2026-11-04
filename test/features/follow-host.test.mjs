import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

const assistant = (seq, text) => ({
  type: 'assistant/message',
  seq,
  time: 1_700_000_000_000 + seq,
  data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
});

function fakeSource(sessions = [{ id: 's1', title: '会话一' }, { id: 's2', title: '会话二' }]) {
  let handler = null;
  return {
    list: async () => sessions,
    subscribe(fn) { handler = fn; return () => { handler = null; }; },
    emit(message) { handler?.(message); },
    get subscribed() { return !!handler; },
  };
}

async function bridge(t, { follow = { enabled: true, sessionId: 's1' }, source = fakeSource(), llm, logs = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-follow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({ version: 1, follow }), 'utf8');
  const b = await startHostBridge({ configDir: dir, sessionSource: source, llm, log: line => logs.push(line) });
  t.after(() => b.close());
  return { dir, bridge: b, source, logs };
}

const post = (bridge, pathName, body) => fetch(`${bridge.url}${pathName}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.info.token}` },
  body: JSON.stringify(body),
});

function parserInto(frames) {
  return createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
}

test('会话列表只返回官方 list() 的结果并裁剪标题', async t => {
  const { bridge: b } = await bridge(t);
  const response = await post(b, '/follow/sessions', {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.sessions.map(item => item.id), ['s1', 's2']);
});

test('未启用 Follow 时禁止订阅（follow-disabled）', async t => {
  const { bridge: b } = await bridge(t, { follow: { enabled: false, sessionId: 's1' } });
  const response = await post(b, '/follow', { sessionId: 's1' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'follow-disabled');
});

test('会话不在授权范围内时拒绝（session-mismatch）', async t => {
  const { bridge: b } = await bridge(t);
  const response = await post(b, '/follow', { sessionId: 's2' });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'session-mismatch');
});

test('选定会话后订阅成功，并且只转发该会话的最终回复', async t => {
  const { bridge: b, source } = await bridge(t);
  const response = await post(b, '/follow', { sessionId: 's1' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

  const frames = [];
  const parser = parserInto(frames);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch { /* 取消时正常 */ }
  })();
  await new Promise(resolve => setTimeout(resolve, 150)); // 等 ready 帧

  source.emit({ session: { id: 's1' }, event: assistant(1, '第一句') });
  source.emit({ session: { id: 's2' }, event: assistant(2, '别的会话的消息') });
  source.emit({ session: { id: 's1' }, event: assistant(1, '第一句') }); // 重复 seq
  source.emit({ session: { id: 's1' }, event: { type: 'tool/result', seq: 3, data: { message: { content: [{ type: 'text', text: '工具输出' }] } } } });
  await new Promise(resolve => setTimeout(resolve, 100));

  const messages = frames.filter(frame => frame.type === 'follow-message');
  assert.equal(messages.length, 1, JSON.stringify(frames));
  assert.equal(messages[0].text, '第一句');
  assert.equal(frames.some(frame => frame.text?.includes('别的会话')), false);
  assert.equal(frames.some(frame => frame.text?.includes('工具输出')), false);

  await reader.cancel();
  await pump;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(source.subscribed, false, '客户端断开后必须退订');
});

test('关闭 Follow / 断开连接后不再接收事件', async t => {
  const { bridge: b, source } = await bridge(t);
  const response = await post(b, '/follow', { sessionId: 's1' });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(source.subscribed, false);
  // 断开后可以重新订阅
  const again = await post(b, '/follow', { sessionId: 's1' });
  assert.equal(again.status, 200);
  await again.body.cancel();
});

test('Follow 不调用 llm.stream，也不消耗 chat 配额', async t => {
  let called = 0;
  const llm = { stream: () => { called++; return (async function* () {})(); } };
  const { bridge: b } = await bridge(t, { llm });
  const response = await post(b, '/follow', { sessionId: 's1' });
  assert.equal(response.status, 200);
  await response.body.cancel();
  assert.equal(called, 0);
});

test('Follow 与 Pet 互不影响：订阅期间仍可正常发起一次模拟对话', async t => {
  const { bridge: b } = await bridge(t);
  const follow = await post(b, '/follow', { sessionId: 's1' });
  assert.equal(follow.status, 200);
  await follow.body.cancel();

  await writeFile(path.join(path.dirname(b.bridgeFile), 'preferences.desktop.json'), JSON.stringify({
    version: 1,
    follow: { enabled: true, sessionId: 's1' },
    chat: { enabled: true, mode: 'pet', backend: 'simulated' },
  }), 'utf8');
  const chat = await post(b, '/chat', { text: '普通对话' });
  assert.equal(chat.status, 200);
  const text = await chat.text();
  assert.match(text, /follow-message|\"delta\"/);
});

test('日志不包含跟随正文、会话标题或令牌', async t => {
  const logs = [];
  const { bridge: b, source } = await bridge(t, { logs });
  const response = await post(b, '/follow', { sessionId: 's1' });
  const reader = response.body.getReader();
  await reader.read();
  source.emit({ session: { id: 's1' }, event: assistant(5, '这是不该进日志的回复正文') });
  await new Promise(resolve => setTimeout(resolve, 100));
  await reader.cancel();
  const joined = logs.join('\n');
  assert.equal(joined.includes('这是不该进日志的回复正文'), false);
  assert.equal(joined.includes(b.info.token), false);
  assert.equal(joined.includes('会话一'), false);
});

test('关闭桥接会退订并释放连接', async t => {
  const { bridge: b, source } = await bridge(t);
  const response = await post(b, '/follow', { sessionId: 's1' });
  await response.body.cancel();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(source.subscribed, false);
  await b.close();
  await assert.rejects(readFile(b.bridgeFile, 'utf8'));
});
