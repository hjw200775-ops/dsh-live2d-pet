import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DESKTOP_PREFERENCES_FILE,
  OVERLAY_PREFERENCES_FILE,
  migrateLegacyPreferences,
  resolvePreferencesFile,
} from '../../src/features/preferences-store.mjs';
import { createPreferences } from '../../src/preferences.js';
import { defaultInteractionPreferences } from '../../src/features/interaction-preferences.mjs';

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-prefs-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('两种模式使用不同存档文件', () => {
  assert.equal(resolvePreferencesFile({ mode: 'overlay', configDir: 'C:/x' }).endsWith(OVERLAY_PREFERENCES_FILE), true);
  assert.equal(resolvePreferencesFile({ mode: 'desktop', configDir: 'C:/x' }).endsWith(DESKTOP_PREFERENCES_FILE), true);
  assert.notEqual(
    resolvePreferencesFile({ mode: 'overlay', configDir: 'C:/x' }),
    resolvePreferencesFile({ mode: 'desktop', configDir: 'C:/x' }),
  );
  assert.equal(resolvePreferencesFile({ mode: 'desktop', configDir: 'C:/x', override: 'D:/tmp/p.json' }), 'D:/tmp/p.json');
});

test('desktop 首次启动把旧 preferences.json 迁移到新文件，旧文件保持原样', async t => {
  const dir = await tempDir(t);
  const legacy = path.join(dir, OVERLAY_PREFERENCES_FILE);
  const target = path.join(dir, DESKTOP_PREFERENCES_FILE);
  const legacyValue = {
    version: 1,
    overlay: { left: 120, top: 80 },
    model: { zoom: 1.4, x: 12, y: -8 },
    interaction: { enabled: { head: false }, cooldownMs: 900, bubbles: { head: ['喵'] } },
  };
  await writeFile(legacy, JSON.stringify(legacyValue), 'utf8');

  const result = await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target });
  assert.deepEqual(result, { migrated: true, reason: 'copied' });

  const migrated = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(migrated.model.zoom, 1.4);
  assert.deepEqual(migrated.overlay, { left: 120, top: 80 });
  assert.equal(migrated.interaction.cooldownMs, 900);
  assert.equal(migrated.interaction.enabled.head, false);
  assert.deepEqual(migrated.interaction.bubbles.head, ['喵']);

  // 旧文件逐字节不变
  assert.deepEqual(JSON.parse(await readFile(legacy, 'utf8')), legacyValue);
});

test('迁移幂等：目标已存在时绝不覆盖，也不影响旧文件', async t => {
  const dir = await tempDir(t);
  const legacy = path.join(dir, OVERLAY_PREFERENCES_FILE);
  const target = path.join(dir, DESKTOP_PREFERENCES_FILE);
  await writeFile(legacy, JSON.stringify({ version: 1, model: { zoom: 2, x: 0, y: 0 } }), 'utf8');
  await writeFile(target, JSON.stringify({ version: 1, model: { zoom: 1.1, x: 5, y: 5 } }), 'utf8');

  const first = await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target });
  const second = await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target });
  assert.deepEqual(first, { migrated: false, reason: 'target-exists' });
  assert.deepEqual(second, { migrated: false, reason: 'target-exists' });
  assert.equal(JSON.parse(await readFile(target, 'utf8')).model.zoom, 1.1);
  assert.equal(JSON.parse(await readFile(legacy, 'utf8')).model.zoom, 2);
});

test('迁移后用户改了 desktop 存档，再跑一次迁移不会回退成旧值', async t => {
  const dir = await tempDir(t);
  const legacy = path.join(dir, OVERLAY_PREFERENCES_FILE);
  const target = path.join(dir, DESKTOP_PREFERENCES_FILE);
  await writeFile(legacy, JSON.stringify({ version: 1, model: { zoom: 1, x: 0, y: 0 } }), 'utf8');

  assert.equal((await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target })).migrated, true);
  const store = await createPreferences(target);
  await store.update({ interaction: { cooldownMs: 1500 }, model: { zoom: 1.8, x: 2, y: 3 } });
  await store.flush();

  assert.deepEqual(await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target }), { migrated: false, reason: 'target-exists' });
  const onDisk = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(onDisk.interaction.cooldownMs, 1500);
  assert.equal(onDisk.model.zoom, 1.8);
});

test('旧文件缺失或损坏时不创建新文件，交给默认值并保留审计原因', async t => {
  const dir = await tempDir(t);
  const legacy = path.join(dir, OVERLAY_PREFERENCES_FILE);
  const target = path.join(dir, DESKTOP_PREFERENCES_FILE);

  assert.deepEqual(await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target }), { migrated: false, reason: 'no-legacy' });
  await assert.rejects(stat(target));

  await writeFile(legacy, '{ 这不是 JSON', 'utf8');
  assert.deepEqual(await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target }), { migrated: false, reason: 'invalid-legacy' });
  await assert.rejects(stat(target));
  // 坏文件也不能被删除或改写
  assert.equal(await readFile(legacy, 'utf8'), '{ 这不是 JSON');
});

test('同一进程中 overlay 与 desktop 两份存档互不覆盖', async t => {
  const dir = await tempDir(t);
  const overlay = await createPreferences(path.join(dir, OVERLAY_PREFERENCES_FILE));
  const desktop = await createPreferences(path.join(dir, DESKTOP_PREFERENCES_FILE));

  await overlay.update({ overlay: { left: 300, top: 200 }, model: { zoom: 1.2, x: 1, y: 2 } });
  await desktop.update({ interaction: { cooldownMs: 2000 }, model: { zoom: 1.9, x: 9, y: 9 } });
  await Promise.all([overlay.flush(), desktop.flush()]);

  const overlayDisk = JSON.parse(await readFile(path.join(dir, OVERLAY_PREFERENCES_FILE), 'utf8'));
  const desktopDisk = JSON.parse(await readFile(path.join(dir, DESKTOP_PREFERENCES_FILE), 'utf8'));

  assert.deepEqual(overlayDisk.overlay, { left: 300, top: 200 });
  assert.equal(overlayDisk.model.zoom, 1.2);
  assert.equal(desktopDisk.interaction.cooldownMs, 2000);
  assert.equal(desktopDisk.model.zoom, 1.9);
  // 各文件都保留完整的默认结构，互不污染
  assert.deepEqual(overlayDisk.interaction, defaultInteractionPreferences());
  assert.equal(desktopDisk.overlay, undefined);
});

test('回退方案：删除 desktop 存档后会重新从旧文件迁移', async t => {
  const dir = await tempDir(t);
  const legacy = path.join(dir, OVERLAY_PREFERENCES_FILE);
  const target = path.join(dir, DESKTOP_PREFERENCES_FILE);
  await writeFile(legacy, JSON.stringify({ version: 1, model: { zoom: 1.3, x: 0, y: 0 } }), 'utf8');

  await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target });
  await rm(target);
  const again = await migrateLegacyPreferences({ legacyFile: legacy, targetFile: target });
  assert.equal(again.migrated, true);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).model.zoom, 1.3);
});
