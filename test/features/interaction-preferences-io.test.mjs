import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPreferences, sanitizePreferences } from '../../src/preferences.js';
import { defaultInteractionPreferences } from '../../src/features/interaction-preferences.mjs';

async function withTempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-live2d-interaction-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('老存档没有 interaction 段时补默认值，且保留原字段', () => {
  const legacy = { version: 1, overlay: { left: 12, top: 34 }, model: { zoom: 1.2, x: 5, y: 6 } };
  const next = sanitizePreferences({}, legacy);
  assert.deepEqual(next.overlay, { left: 12, top: 34 });
  assert.deepEqual(next.model, { zoom: 1.2, x: 5, y: 6 });
  assert.deepEqual(next.interaction, defaultInteractionPreferences());
});

test('互动配置可随存档持久化，重启后仍然有效', async t => {
  const dir = await withTempDir(t);
  const file = path.join(dir, 'preferences.json');
  const p = await createPreferences(file);
  await p.update({
    interaction: {
      enabled: { head: false, body: true, double: false },
      bubbles: { head: ['摸头？'], body: ['别戳啦'], double: [] },
      cooldownMs: 1200,
    },
  });
  await p.flush();
  const reopened = await createPreferences(file);
  assert.deepEqual(reopened.get().interaction, {
    version: 1,
    enabled: { head: false, body: true, double: false },
    bubbles: { head: ['摸头？'], body: ['别戳啦'], double: [] },
    cooldownMs: 1200,
  });
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.interaction.cooldownMs, 1200);
});

test('非法互动配置被拒绝并保留上一份，文件不被写坏', async t => {
  const dir = await withTempDir(t);
  const file = path.join(dir, 'preferences.json');
  const p = await createPreferences(file);
  await p.update({ interaction: { cooldownMs: 900, enabled: { head: false } } });
  await p.flush();
  await p.update({
    interaction: {
      cooldownMs: 999999,
      enabled: { head: 'yes', body: 0 },
      bubbles: { head: '不是数组' },
    },
  });
  await p.flush();
  const value = p.get().interaction;
  assert.equal(value.cooldownMs, 900);
  assert.equal(value.enabled.head, false);
  assert.equal(value.enabled.body, true);
  assert.deepEqual(value.bubbles.head, ['嗯？', '在的', '嘿嘿']);
  const raw = await readFile(file, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});

test('恢复默认后落盘仍然是默认值，且不影响位置与缩放', async t => {
  const dir = await withTempDir(t);
  const file = path.join(dir, 'preferences.json');
  const p = await createPreferences(file);
  await p.update({ model: { zoom: 1.5, x: 20, y: 30 }, interaction: { cooldownMs: 100, enabled: { double: false } } });
  await p.update({ interaction: defaultInteractionPreferences() });
  await p.flush();
  const reopened = await createPreferences(file);
  assert.deepEqual(reopened.get().interaction, defaultInteractionPreferences());
  assert.deepEqual(reopened.get().model, { zoom: 1.5, x: 20, y: 30 });
});

test('存档文件损坏的 interaction 段会被就地修正，不影响启动', async t => {
  const dir = await withTempDir(t);
  const file = path.join(dir, 'preferences.json');
  await writeFile(file, JSON.stringify({ version: 1, interaction: { cooldownMs: -5, enabled: { head: 1 } } }), 'utf8');
  const p = await createPreferences(file);
  const value = p.get().interaction;
  assert.equal(value.cooldownMs, 650);
  assert.equal(value.enabled.head, true);
});

test('服务端把 src/features 整目录暴露给渲染器，新模块不必逐条登记路由', async () => {
  const source = await readFile(path.resolve('src/viewer-server.js'), 'utf8');
  assert.match(source, /features\/\$\{name\}/);
  assert.match(source, /readdir\(featuresDir\)/);
});

test('渲染器引用互动配置模块并渲染出全部面板控件', async () => {
  const viewer = await readFile(path.resolve('renderer/viewer.js'), 'utf8');
  assert.match(viewer, /from '\.\/features\/interaction-preferences\.mjs'/);
  assert.match(viewer, /shouldFireFeedback\(\{kind,enabled:interaction\.enabled/);
  assert.match(viewer, /interaction\.cooldownMs/);
  assert.match(viewer, /pickBubble\(interaction\.bubbles\[kind\]\)/);
  assert.match(viewer, /interactionUI\.reset\.addEventListener\('click'/);

  const html = await readFile(path.resolve('renderer/index.html'), 'utf8');
  for (const id of [
    'interaction-head',
    'interaction-body',
    'interaction-double',
    'interaction-cooldown',
    'interaction-bubble-head',
    'interaction-bubble-body',
    'interaction-bubble-double',
    'interaction-reset',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `缺少控件 ${id}`);
  }
  assert.ok(html.indexOf('id="interaction-head"') < html.indexOf('<p class="section">装扮</p>'), '互动设置应位于装扮之前');
});
