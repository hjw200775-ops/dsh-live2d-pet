import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCode, writeChatStream } from '../../src/features/chat/stream.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';

function fakeRes() {
  const frames = [];
  return {
    frames,
    headersSent: false,
    writableEnded: false,
    writeHead() { this.headersSent = true; },
    flushHeaders() {},
    write(chunk) { frames.push(String(chunk)); },
    end() { this.writableEnded = true; },
    parse() {
      const text = frames.filter(item => typeof item === 'string').join('');
      const out = [];
      const parser = createSseParser({ onFrame: frame => out.push(JSON.parse(frame.data)) });
      parser.push(text);
      parser.end();
      return out;
    },
  };
}

const produceFrom = chunks => () => (async function* () { for (const chunk of chunks) yield chunk; })();

async function run(t, chunks, extra = {}) {
  const res = fakeRes();
  const result = await writeChatStream({ res, prompt: '你好', produce: produceFrom(chunks), timeoutMs: 2000, ...extra });
  return { frames: res.parse(), result };
}

test('produce 给出 finish.ok：end.reason=ok', async t => {
  const { frames } = await run(t, [{ kind: 'delta', text: '你' }, { kind: 'delta', text: '好' }, { kind: 'finish', reason: 'ok' }]);
  assert.equal(frames.at(-1).type, 'end');
  assert.equal(frames.at(-1).reason, 'ok');
  assert.equal(frames.filter(f => f.type === 'delta').map(f => f.text).join(''), '你好');
});

test('produce 给出 finish.aborted：end.reason=aborted，不算成功', async t => {
  const { frames } = await run(t, [{ kind: 'delta', text: '半' }, { kind: 'finish', reason: 'aborted' }]);
  assert.equal(frames.at(-1).type, 'end');
  assert.equal(frames.at(-1).reason, 'aborted');
});

test('produce 给出 finish.error：输出 error{code}', async t => {
  const { frames } = await run(t, [{ kind: 'delta', text: 'x' }, { kind: 'finish', reason: 'error', code: 'AUTH' }]);
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'AUTH' });
});

test('produce 没有 finish 就结束：error{no-finish}，绝不显示成功', async t => {
  const { frames } = await run(t, [{ kind: 'delta', text: '有内容但没有收尾' }]);
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'no-finish' });
});

test('produce 空流：同样判失败', async t => {
  const { frames } = await run(t, []);
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).code, 'no-finish');
});

test('produce 抛错：只输出白名单错误码', async t => {
  const res = fakeRes();
  await writeChatStream({ res, prompt: 'x', timeoutMs: 2000, produce: () => (async function* () { const error = new Error('secret prompt text'); error.code = 'RATE_LIMIT'; throw error; })() });
  const frames = res.parse();
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'RATE_LIMIT' });
});

test('模拟路径（无 produce）仍以 end.ok 收尾', async t => {
  const res = fakeRes();
  await writeChatStream({ res, prompt: '你好', timeoutMs: 2000 });
  const frames = res.parse();
  assert.equal(frames.at(-1).type, 'end');
  assert.equal(frames.at(-1).reason, 'ok');
});

test('上游忽略取消：客户端 abort 后有界结束并输出 aborted', async t => {
  const controller = new AbortController();
  const res = fakeRes();
  const task = writeChatStream({
    res, prompt: 'x', signal: controller.signal, timeoutMs: 5000,
    produce: () => (async function* () { yield { kind: 'delta', text: 'a' }; await new Promise(() => {}); })(),
  });
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  await task;
  assert.ok(Date.now() - started < 2000);
  const frames = res.parse();
  assert.equal(frames.at(-1).type, 'end');
  assert.equal(frames.at(-1).reason, 'aborted');
});

test('safeCode 只放行白名单形状的错误码', () => {
  assert.equal(safeCode({ code: 'AUTH' }), 'AUTH');
  assert.equal(safeCode({ code: 'bad code with spaces' }), 'UPSTREAM_ERROR');
  assert.equal(safeCode(new Error('secret')), 'UPSTREAM_ERROR');
});
