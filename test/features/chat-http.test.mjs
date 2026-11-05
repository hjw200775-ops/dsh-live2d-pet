import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REQUEST_LIMITS, startViewer } from '../../src/viewer-server.js';
import { createSseParser } from '../../src/features/chat/sse.mjs';

async function fixture(t, { chat = { enabled: true, mode: 'pet' } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-chat-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  await Promise.all([
    writeFile(path.join(root, 't.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 't.moc3', Textures: ['t.png'] } })),
    writeFile(path.join(root, 't.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(root, 't.png'), 'x'),
    writeFile(path.join(root, 'core.js'), '// core'),
    writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
  ]);
  const preferencesFile = path.join(root, 'preferences.json');
  await writeFile(preferencesFile, JSON.stringify({ version: 1, chat }), 'utf8');
  const config = { modelFile: path.join(root, 't.model3.json'), coreFile: path.join(root, 'core.js'), configDir: root, preferencesFile };
  const viewer = await startViewer(config);
  t.after(() => viewer.close());
  return { root, preferencesFile, viewer, base: new URL('.', viewer.url) };
}

function post(base, body, { origin = base.origin, raw, signal } = {}) {
  return fetch(new URL('chat', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: raw ?? JSON.stringify(body),
    signal,
  });
}

function parseSse(text) {
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push({ event: frame.event, data: JSON.parse(frame.data) }) });
  parser.push(text);
  parser.end();
  return frames;
}

test('对话未启用时返回 409，且不产生任何流', async t => {
  const { base } = await fixture(t, { chat: { enabled: false } });
  const response = await post(base, { text: '你好' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'chat-disabled');
});

test('启用后返回 SSE：meta 标记模拟、delta 分片、end 收尾', async t => {
  const { base } = await fixture(t);
  const response = await post(base, { text: '晚上好' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const frames = parseSse(await response.text());

  const meta = frames.find(frame => frame.data.type === 'meta');
  assert.equal(meta?.data.simulated, true);
  assert.equal(meta?.data.model, 'local-simulator');

  const text = frames.filter(frame => frame.data.type === 'delta').map(frame => frame.data.text).join('');
  assert.ok(text.startsWith('【模拟】'));
  assert.ok(text.includes('晚上好'));
  assert.ok(text.includes('没有调用任何真实 API'));

  const end = frames.find(frame => frame.data.type === 'end');
  assert.equal(end?.data.reason, 'ok');
  assert.equal(end?.data.simulated, true);
  assert.equal(frames.some(frame => frame.data.type === 'error'), false);
});

test('follow 模式回放示例消息而不是回显输入', async t => {
  const { base } = await fixture(t, { chat: { enabled: true, mode: 'follow' } });
  const text = parseSse(await (await post(base, { text: '不该出现的输入' })).text())
    .filter(frame => frame.data.type === 'delta').map(frame => frame.data.text).join('');
  assert.ok(text.includes('开发会话'));
  assert.equal(text.includes('不该出现的输入'), false);
});

test('空消息与超长消息被拒绝', async t => {
  const { base } = await fixture(t);
  assert.equal((await post(base, { text: '   ' })).status, 400);
  assert.equal((await (await post(base, { text: '   ' })).json()).error, 'empty-text');
  const tooLong = await post(base, { text: '字'.repeat(501) });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, 'text-too-long');
});

test('请求体超限返回 413，跨域来源返回 403', async t => {
  const { base } = await fixture(t);
  const oversized = JSON.stringify({ text: 'x'.repeat(REQUEST_LIMITS.chat) });
  assert.equal((await post(base, null, { raw: oversized })).status, 413);
  assert.equal((await post(base, { text: '你好' }, { origin: 'http://evil.example' })).status, 403);
});

test('并发限制为 1：第二条请求返回 429，结束后恢复', async t => {
  const { base } = await fixture(t);
  const first = await post(base, { text: '第一条' });
  assert.equal(first.status, 200);
  const second = await post(base, { text: '第二条' });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).error, 'chat-busy');
  await first.text();
  const third = await post(base, { text: '第三条' });
  assert.equal(third.status, 200);
  await third.text();
});

test('正文不落盘：存档里没有 prompt，也没有新增日志文件', async t => {
  const { base, preferencesFile, root } = await fixture(t);
  const secret = '这是一段不该落盘的正文';
  await (await post(base, { text: secret })).text();

  const preferences = await readFile(preferencesFile, 'utf8');
  assert.equal(preferences.includes(secret), false);
  const entries = await readdir(root);
  assert.equal(entries.some(name => name.endsWith('.log')), false);
  for (const name of entries) {
    if (!name.endsWith('.json') && !name.endsWith('.js')) continue;
    const content = await readFile(path.join(root, name), 'utf8').catch(() => '');
    assert.equal(content.includes(secret), false, name);
  }
});

test('渲染器接线：fetch + ReadableStream 解析、停止按钮、500 字上限、模拟标识', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /from '\.\/features\/chat\/sse\.mjs'/);
  assert.match(viewer, /createSseParser\(/);
  assert.match(viewer, /response\.body\?\.getReader\(\)/);
  assert.match(viewer, /chatAbort\?\.abort\(\)/);
  assert.match(viewer, /CHAT_LIMITS\.messageChars/);
  assert.match(viewer, /本地模拟/);
  assert.match(viewer, /chat-backend/);
  assert.match(viewer, /realConsent/);

  const html = await readFile(path.resolve('renderer/index.html'), 'utf8');
  for (const id of ['chat-enabled', 'chat-mode', 'chat-backend', 'chat-consent', 'chat-input', 'chat-send', 'chat-stop', 'chat-state']) {
    assert.ok(html.includes(`id="${id}"`), `缺少控件 ${id}`);
  }
  assert.match(html, /对话（模拟）/);
});

test('限流：每分钟最多 6 次，第 7 次返回 429 rate-limited', async t => {
  const { base } = await fixture(t);
  for (let i = 0; i < 6; i++) {
    const response = await post(base, { text: `第${i}条` });
    assert.equal(response.status, 200, `第 ${i + 1} 次应通过`);
    await response.text();
  }
  const blocked = await post(base, { text: '第七条' });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error, 'rate-limited');
  assert.equal(body.limit, 6);
  assert.equal(blocked.headers.get('retry-after') !== null, true);
});

test('上游挂起：超时返回 error{timeout}，且 chatBusy 必然释放', async t => {
  process.env.DSH_LIVE2D_CHAT_SCENARIO = 'hang';
  process.env.DSH_LIVE2D_CHAT_TIMEOUT_MS = '300';
  try {
    const { base } = await fixture(t);
    const response = await post(base, { text: '会超时' });
    assert.equal(response.status, 200);
    const frames = parseSse(await response.text());
    const error = frames.find(frame => frame.data.type === 'error');
    assert.equal(error?.data.code, 'timeout');
    assert.equal(frames.some(frame => frame.data.type === 'end'), false);

    // 超时后必须已经释放 busy：下一条请求应正常开始
    delete process.env.DSH_LIVE2D_CHAT_SCENARIO;
    const next = await post(base, { text: '下一条' });
    assert.equal(next.status, 200);
    assert.ok((await next.text()).includes('data:'));
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_SCENARIO;
    delete process.env.DSH_LIVE2D_CHAT_TIMEOUT_MS;
  }
});

test('客户端中途断开：服务端释放 busy，后续请求仍可开始', async t => {
  const { base } = await fixture(t);
  const controller = new AbortController();
  const response = await post(base, { text: '会被中断' }, { signal: controller.signal }).catch(() => null);
  const reader = response?.body?.getReader();
  await reader?.read();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 400));
  const next = await post(base, { text: '断开之后' });
  assert.equal(next.status, 200);
  await next.text();
});

test('渲染器区分 end.reason，异常结束不会被当成成功', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /payload\.reason==='ok'/);
  assert.match(viewer, /payload\.reason==='aborted'/);
  assert.match(viewer, /failure=payload\.reason\|\|'bad-end'/);
  assert.match(viewer, /if\(failure==='aborted'\)setChatState\('已停止生成'\)/);
  assert.match(viewer, /!ended\)setChatState\('流意外结束/);
});

test('渲染器在卸载/禁用/切换模式时取消未结束请求并清理定时器', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /disposed=true;chatAbort\?\.abort\(\);followAbort\?\.abort\(\);clearTimeout\(chatBubbleTimer\)/);
  assert.match(viewer, /if\(!chatUI\.enabled\.checked\)stopChat\(\)/);
  assert.match(viewer, /chatUI\.mode\.addEventListener\('change',async\(\)=>\{\s*stopChat\(\)/);
});
test('真实后端不再误判：host-llm 合法、降级明确、取消/错误不显示成功', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /backend!=='host-llm'/);
  assert.equal(/if\(payload\.simulated!==true\)failure='unexpected-model'/.test(viewer), false);
  assert.match(viewer, /已降级为本地模拟/);
  assert.match(viewer, /DSH 模型（真实后端）/);
  assert.match(viewer, /本地模拟（无上下文记忆）/);
  assert.match(viewer, /failure==='aborted'\).*已停止生成/);
});

test('Pet 设置先保存再请求：失败回滚、取消许可立即中止在途真实请求', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /const applyChat=patch=>\{[^}]*return persist\(\);\}/);
  assert.match(viewer, /const ok=await applyChat\(\{enabled:chatUI\.enabled\.checked\}\)/);
  assert.match(viewer, /设置保存失败，聊天状态未改变/);
  assert.match(viewer, /设置保存失败，后端未改变/);
  assert.match(viewer, /if\(!chatUI\.consent\.checked\)chatAbort\?\.abort\(\)/);
  assert.match(viewer, /真实调用许可未开启，未发送/);
  assert.match(viewer, /if\(!ok\)\{chatUI\.consent\.checked=previous/);
});
