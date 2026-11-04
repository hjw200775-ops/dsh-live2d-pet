import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REQUEST_LIMITS, startViewer } from '../../src/viewer-server.js';
import { defaultInteractionPreferences } from '../../src/features/interaction-preferences.mjs';

const KIND_LIMIT = { maxItems: 12, maxLength: 40 };

async function fixture(t, prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  await Promise.all([
    writeFile(path.join(root, 'test.model3.json'), JSON.stringify({ Version: 3, FileReferences: { Moc: 'test.moc3', Textures: ['texture.png'] } })),
    writeFile(path.join(root, 'test.moc3'), Buffer.from([77, 79, 67, 51, 5])),
    writeFile(path.join(root, 'texture.png'), 'test texture'),
    writeFile(path.join(root, 'core.js'), '// test only'),
    writeFile(path.join(root, 'Animation/IDLE.motion3.json'), '{}'),
  ]);
  return {
    root,
    config: {
      modelFile: path.join(root, 'test.model3.json'),
      coreFile: path.join(root, 'core.js'),
      configDir: root,
      preferencesFile: path.join(root, 'preferences.json'),
    },
  };
}

/** 一条“最大合法配置”：三类各 12 条 × 正好 40 个中文字（不被截断），压到校验上限。 */
function maximalInteraction() {
  const list = Array.from({ length: KIND_LIMIT.maxItems }, (_, index) => `${'摸'.repeat(KIND_LIMIT.maxLength - 1)}${index % 10}`);
  return {
    version: 1,
    enabled: { head: true, body: true, double: true },
    bubbles: { head: [...list], body: [...list], double: [...list] },
    cooldownMs: 10000,
  };
}

function post(base, store, body, { origin = base.origin, raw } = {}) {
  return fetch(new URL(store, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: raw ?? JSON.stringify(body),
  });
}

test('最大合法互动配置能通过 HTTP 保存、读回，并在重启后恢复', async t => {
  const { config } = await fixture(t, 'dsh-live2d-http-max-');
  const payload = { version: 1, model: { zoom: 1, x: 0, y: 0 }, interaction: maximalInteraction() };
  const serialized = JSON.stringify(payload);

  // 先证明这就是以前会被 2048 字节上限打回的体量，避免测试退化成“小请求也能过”。
  assert.ok(Buffer.byteLength(serialized, 'utf8') > 2048 * 2, `请求体只有 ${Buffer.byteLength(serialized)} 字节`);
  assert.ok(Buffer.byteLength(serialized, 'utf8') < REQUEST_LIMITS.preferences);

  const first = await startViewer(config);
  t.after(() => first.close().catch(() => {}));
  let base = new URL('.', first.url);
  const saved = await post(base, 'preferences.json', payload);
  assert.equal(saved.status, 204);

  const readBack = await fetch(new URL('preferences.json', base)).then(r => r.json());
  assert.deepEqual(readBack.interaction, maximalInteraction());
  assert.equal(readBack.interaction.bubbles.head.length, 12);
  assert.equal(readBack.interaction.bubbles.head[0].length, 40);
  await first.close();

  // “重启”＝同一份 preferences.json 交给新的 viewer 进程模型
  const second = await startViewer(config);
  t.after(() => second.close());
  base = new URL('.', second.url);
  const afterRestart = await fetch(new URL('preferences.json', base)).then(r => r.json());
  assert.deepEqual(afterRestart.interaction, maximalInteraction());

  const onDisk = JSON.parse(await readFile(config.preferencesFile, 'utf8'));
  assert.deepEqual(onDisk.interaction.bubbles.double, maximalInteraction().bubbles.double);
});

test('超过 preferences 上限的请求返回 413 JSON，原存档不被破坏', async t => {
  const { config } = await fixture(t, 'dsh-live2d-http-over-');
  const viewer = await startViewer(config);
  t.after(() => viewer.close());
  const base = new URL('.', viewer.url);

  const good = { version: 1, interaction: { cooldownMs: 900, bubbles: { head: ['在的'] } } };
  assert.equal((await post(base, 'preferences.json', good)).status, 204);
  const before = await readFile(config.preferencesFile, 'utf8');

  // 明显超过上限的原始请求体（不经过 sanitize，直接打 HTTP 层）
  const oversized = JSON.stringify({ version: 1, interaction: { bubbles: { head: ['摸'.repeat(60)] } } })
    + ' '.repeat(REQUEST_LIMITS.preferences + 1024);
  assert.ok(Buffer.byteLength(oversized, 'utf8') > REQUEST_LIMITS.preferences);

  const response = await post(base, 'preferences.json', null, { raw: oversized });
  assert.equal(response.status, 413);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json();
  assert.equal(body.error, 'payload-too-large');
  assert.equal(body.store, 'preferences');
  assert.equal(body.limit, REQUEST_LIMITS.preferences);

  // 原存档逐字节未变，且仍能读回上一份合法配置
  assert.equal(await readFile(config.preferencesFile, 'utf8'), before);
  const readBack = await fetch(new URL('preferences.json', base)).then(r => r.json());
  assert.equal(readBack.interaction.cooldownMs, 900);
  assert.deepEqual(readBack.interaction.bubbles.head, ['在的']);
});

test('telemetry 与 bridge 保持 2 KiB 紧边界，不被 preferences 的宽松上限带偏', async t => {
  const { config } = await fixture(t, 'dsh-live2d-http-telemetry-');
  const viewer = await startViewer(config);
  t.after(() => viewer.close());
  const base = new URL('.', viewer.url);

  assert.equal(REQUEST_LIMITS.telemetry, 2048);
  assert.equal(REQUEST_LIMITS.bridge, 2048);
  assert.ok(REQUEST_LIMITS.preferences >= 16 * 1024);

  const small = await post(base, 'telemetry.json', { mode: 'idle', frames: 12 });
  assert.equal(small.status, 204);

  const big = await post(base, 'telemetry.json', null, { raw: JSON.stringify({ mode: 'idle', pad: 'x'.repeat(3000) }) });
  assert.equal(big.status, 413);
  const body = await big.json();
  assert.equal(body.store, 'telemetry');
  assert.equal(body.limit, 2048);
});

test('写入仍要求同源 Origin，非法 JSON 回 400 且不写档', async t => {
  const { config } = await fixture(t, 'dsh-live2d-http-origin-');
  const viewer = await startViewer(config);
  t.after(() => viewer.close());
  const base = new URL('.', viewer.url);

  assert.equal((await post(base, 'preferences.json', { version: 1 }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post(base, 'preferences.json', null, { origin: null, raw: '{"version":1' })).status, 403);
  const response = await post(base, 'preferences.json', null, { raw: '{"version":1' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid-json');
  await assert.rejects(readFile(config.preferencesFile, 'utf8'), { code: 'ENOENT' });
});

test('渲染器把保存失败显式显示在面板里，而不是假装保存成功', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /paintSaveState/);
  assert.match(viewer, /r\.status===413/, '413 应给出专门提示');
  assert.match(viewer, /未保存：/);
  assert.match(viewer, /设置已保存/);

  const html = await readFile(path.resolve('renderer/index.html'), 'utf8');
  assert.match(html, /id="save-state"/);
});
