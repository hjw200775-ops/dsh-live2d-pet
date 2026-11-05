import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function bridge(t, { chat = {}, captured = [] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-pet-memory-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({
    version: 1,
    chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true, persona: '温和一点', historyTurns: 6, ...chat },
  }), 'utf8');
  const llm = {
    stream: options => {
      captured.push(options);
      return (async function* () {
        yield { type: 'text-delta', text: `回复${captured.length}` };
        yield { type: 'finish', reason: { kind: 'ok' } };
      })();
    },
  };
  const b = await startHostBridge({ configDir: dir, llm, agentDefaultModel: { get: () => ({ provider: 'fake', model: 'fake-model' }) } });
  t.after(() => b.close());
  return { bridge: b, captured };
}

const post = (b, pathName, body) => fetch(`${b.url}${pathName}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.info.token}` },
  body: JSON.stringify(body ?? {}),
});

function parse(text) {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
  parser.push(text);
  parser.end();
  return frames;
}

test('Fake LLM 收到正确的历史顺序：第二轮包含第一轮的 user/assistant', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const { bridge: b, captured } = await bridge(t);
    await (await post(b, '/chat', { text: '第一问' })).text();
    await (await post(b, '/chat', { text: '第二问' })).text();

    assert.equal(captured.length, 2);
    const second = captured[1];
    assert.deepEqual(second.messages.map(m => m.role), ['user', 'assistant', 'user']);
    assert.equal(second.messages[0].content[0].text, '第一问');
    assert.equal(second.messages[1].content[0].text, '回复1');
    assert.equal(second.messages[2].content[0].text, '第二问');
    assert.match(second.system, /角色设定/);
    assert.match(second.system, /温和一点/);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('失败回复不写入历史：错误后下一轮的 messages 不含失败轮', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-pet-fail-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({
      version: 1, chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true, historyTurns: 6 },
    }), 'utf8');
    const captured = [];
    let call = 0;
    const llm = {
      stream: options => {
        captured.push(options); call++;
        if (call === 1) return (async function* () { yield { type: 'text-delta', text: '半截' }; yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH' } } }; })();
        return (async function* () { yield { type: 'text-delta', text: '正常' }; yield { type: 'finish', reason: { kind: 'ok' } }; })();
      },
    };
    const b = await startHostBridge({ configDir: dir, llm, agentDefaultModel: { get: () => ({ provider: 'fake', model: 'm' }) } });
    t.after(() => b.close());
    await (await post(b, '/chat', { text: '会失败' })).text();
    await (await post(b, '/chat', { text: '再来' })).text();
    assert.equal(captured.length, 2);
    assert.deepEqual(captured[1].messages.map(m => m.role), ['user']);
    assert.equal(captured[1].messages[0].content[0].text, '再来');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('清空上下文后，下一轮只发送当前消息', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const { bridge: b, captured } = await bridge(t);
    await (await post(b, '/chat', { text: '记住这句' })).text();
    const cleared = await post(b, '/chat/context/clear', {});
    assert.equal(cleared.status, 204);
    await (await post(b, '/chat', { text: '清空后' })).text();
    assert.equal(captured.length, 2);
    assert.deepEqual(captured[1].messages.map(m => m.role), ['user']);
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('模拟后端不写入真实历史：切到 host 后 messages 不含模拟轮次', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const { bridge: b, captured } = await bridge(t, { chat: { backend: 'simulated' } });
    await (await post(b, '/chat', { text: '模拟轮' })).text();
    assert.equal(captured.length, 0, '模拟后端不应调用 llm.stream');
    // 改成 host 后端后，历史里不应有"模拟轮"
    const dir = path.dirname(b.bridgeFile);
    await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({
      version: 1, chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true, historyTurns: 6 },
    }), 'utf8');
    await (await post(b, '/chat', { text: '真实轮' })).text();
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].messages.map(m => m.role), ['user']);
    assert.equal(captured[0].messages[0].content[0].text, '真实轮');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});

test('取消的回复不写入历史', async t => {
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-pet-cancel-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({
      version: 1, chat: { enabled: true, mode: 'pet', backend: 'host', realConsent: true, historyTurns: 6 },
    }), 'utf8');
    const captured = [];
    let call = 0;
    const llm = {
      stream: options => {
        captured.push(options); call++;
        if (call === 1) return (async function* () { yield { type: 'text-delta', text: '开始' }; await new Promise(resolve => setTimeout(resolve, 5000)); })();
        return (async function* () { yield { type: 'text-delta', text: 'ok' }; yield { type: 'finish', reason: { kind: 'ok' } }; })();
      },
    };
    const b = await startHostBridge({ configDir: dir, llm, agentDefaultModel: { get: () => ({ provider: 'fake', model: 'm' }) } });
    t.after(() => b.close());
    const controller = new AbortController();
    const response = await fetch(`${b.url}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b.info.token}` },
      body: JSON.stringify({ text: '会被取消' }),
      signal: controller.signal,
    });
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 300));
    await (await post(b, '/chat', { text: '取消后' })).text();
    assert.deepEqual(captured[1].messages.map(m => m.role), ['user']);
    assert.equal(captured[1].messages[0].content[0].text, '取消后');
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
  }
});
