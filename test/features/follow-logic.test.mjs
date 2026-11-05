import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantTextOf,
  createFollowDeduper,
  followFrameFromEvent,
  followStatusFrame,
  sanitizeSessionList,
  truncateFollowText,
  followRetryAfterDisconnect,
  FOLLOW_STABLE_MS,
} from '../../src/features/chat/follow.mjs';
import { defaultFollowPreferences, sanitizeFollowPreferences } from '../../src/features/chat/config.mjs';

const event = (seq, blocks, extra = {}) => ({
  type: 'assistant/message',
  seq,
  time: 1_700_000_000_000 + seq,
  data: { turn: 1, step: 1, message: { role: 'assistant', content: blocks }, ...extra },
});

test('只提取 text 块：推理、工具调用、工具结果都不进入展示文本', () => {
  const message = {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: '内部推理不应出现' },
      { type: 'text', text: '可见回复' },
      { type: 'tool-call', name: 'shell', arguments: '{"cmd":"rm -rf"}' },
      { type: 'tool-result', content: 'TOOL OUTPUT' },
    ],
  };
  const text = assistantTextOf(message);
  assert.equal(text, '可见回复');
  assert.equal(text.includes('内部推理'), false);
  assert.equal(text.includes('rm -rf'), false);
});

test('截断按码点计算并标注省略号', () => {
  const short = truncateFollowText('你好', 10);
  assert.deepEqual(short, { text: '你好', truncated: false });
  const long = truncateFollowText('字'.repeat(20), 10);
  assert.equal(long.truncated, true);
  assert.equal([...long.text].length, 10);
  assert.ok(long.text.endsWith('…'));
  // emoji 不会被截成半个代理对
  const emoji = truncateFollowText('🙂'.repeat(20), 5);
  assert.equal([...emoji.text].length, 5);
});

test('follow 帧只来自 assistant/message，且带 seq 与截断标记', () => {
  const frame = followFrameFromEvent({ id: 's1' }, event(7, [{ type: 'text', text: '回复' }]));
  assert.equal(frame.type, 'follow-message');
  assert.equal(frame.sessionId, 's1');
  assert.equal(frame.seq, 7);
  assert.equal(frame.text, '回复');
  assert.equal(frame.truncated, false);

  assert.equal(followFrameFromEvent({ id: 's1' }, { type: 'tool/result', seq: 8, data: {} }), null);
  assert.equal(followFrameFromEvent({ id: 's1' }, { type: 'user/message', seq: 9, data: {} }), null);
  assert.equal(followFrameFromEvent({ id: 's1' }, event(10, [{ type: 'reasoning', text: 'x' }])), null);
});

test('状态帧只映射 running/idle，不携带标题或正文', () => {
  assert.deepEqual(followStatusFrame('s1', true), { type: 'follow-status', sessionId: 's1', status: 'running' });
  assert.deepEqual(followStatusFrame('s1', false), { type: 'follow-status', sessionId: 's1', status: 'idle' });
  assert.equal(followStatusFrame('', true), null);
});

test('去重器对相同 seq 只放行一次，并有上限', () => {
  const dedupe = createFollowDeduper(3);
  assert.equal(dedupe.accept(1), true);
  assert.equal(dedupe.accept(1), false);
  assert.equal(dedupe.accept(2), true);
  assert.equal(dedupe.accept(3), true);
  assert.equal(dedupe.accept(4), true); // 挤掉 1
  assert.equal(dedupe.accept(1), true); // 1 已过期，可以再次接受
  assert.equal(dedupe.accept(null), true);
});

test('会话列表裁剪：限制数量、截断标题、丢弃空 id', () => {
  const list = sanitizeSessionList({ sessions: [
    { id: 's1', title: '标题'.repeat(100) },
    { id: '', title: 'no id' },
    { id: 's2' },
  ] });
  assert.equal(list.length, 2);
  assert.equal([...list[0].title].length, 60);
  assert.equal(list[1].title, 's2');
});

test('follow 配置默认关闭且会话 id 受长度限制', () => {
  assert.deepEqual(defaultFollowPreferences(), { enabled: false, sessionId: '', hideContent: false });
  const next = sanitizeFollowPreferences({ enabled: true, sessionId: '  s1  ' });
  assert.deepEqual(next, { enabled: true, sessionId: 's1', hideContent: false });
  assert.equal(sanitizeFollowPreferences({ hideContent: true }).hideContent, true);
  assert.equal(sanitizeFollowPreferences({ hideContent: 'yes' }).hideContent, false);
  assert.equal(sanitizeFollowPreferences({ enabled: 'yes' }).enabled, false);
  assert.equal(sanitizeFollowPreferences({ sessionId: 'x'.repeat(500) }).sessionId.length, 120);
});

test('只有稳定连接 ≥60s 才清零重试计数；短连接断开只累加', () => {
  assert.equal(FOLLOW_STABLE_MS, 60000);
  assert.deepEqual(followRetryAfterDisconnect({ connectedMs: 1000, retries: 0 }), { retries: 1, giveUp: false, delayMs: 1000, stable: false });
  assert.deepEqual(followRetryAfterDisconnect({ connectedMs: 3000, retries: 2 }), { retries: 3, giveUp: false, delayMs: 4000, stable: false });
  // 稳定连接后即使之前失败 4 次，也回到第 1 次
  assert.deepEqual(followRetryAfterDisconnect({ connectedMs: 61000, retries: 4 }), { retries: 1, giveUp: false, delayMs: 1000, stable: true });
  // 达到上限
  assert.equal(followRetryAfterDisconnect({ connectedMs: 1000, retries: 5 }).giveUp, true);
  // 上限后给出退避 0
  assert.equal(followRetryAfterDisconnect({ connectedMs: 1000, retries: 9 }).delayMs, 0);
});