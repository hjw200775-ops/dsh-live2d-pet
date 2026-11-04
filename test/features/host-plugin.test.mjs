import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { createSseParser } from '../../src/features/chat/sse.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

test('插件不把 llm 设为强制依赖，桥接启动失败也不影响其他功能', async () => {
  const source = await readFile(path.resolve('src/index.js'), 'utf8');
  assert.match(source, /export const inject = \['webServer', 'credentials'\]/);
  assert.doesNotMatch(source, /inject\s*=\s*\[[^\]]*'llm'/);
  // 桥接启动被 try/catch 包住，失败只记日志
  assert.match(source, /try\{[\s\S]{0,200}startHostBridge/);
  assert.match(source, /host bridge 未启动/);
  // 卸载时关闭桥接
  assert.match(source, /hostBridge\?\.close/);
});

test('聊天模块不包含任何真实 API 直连（不新建第二套 DeepSeek 客户端）', async () => {
  const files = ['config.mjs', 'simulator.mjs', 'sse.mjs', 'stream.mjs', 'host-adapter.mjs', 'host-bridge.mjs'];
  for (const file of files) {
    const source = await readFile(path.resolve('src/features/chat', file), 'utf8');
    assert.equal(/api\.deepseek\.com|api\.openai\.com|https:\/\/api\./.test(source), false, file);
  }
});

test('没有 llm 服务时桥接仍可启动并以模拟后端工作', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-no-llm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bridge = await startHostBridge({ configDir: dir }); // 不传 llm
  t.after(() => bridge.close());
  const response = await fetch(`${bridge.url}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridge.info.token}` },
    body: JSON.stringify({ text: '没有模型也要能回' }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  const frames = [];
  const parser = createSseParser({ onFrame: frame => frames.push(JSON.parse(frame.data)) });
  parser.push(body);
  parser.end();
  assert.equal(frames[0].type, 'meta');
  assert.equal(frames[0].simulated, true);
  assert.ok(frames.filter(f => f.type === 'delta').map(f => f.text).join('').includes('没有模型也要能回'));
});
