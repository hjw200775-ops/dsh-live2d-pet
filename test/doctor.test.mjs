import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { formatReport, runDoctor } from '../src/doctor.mjs';
import { electronBinaryPath, electronCacheDir, ELECTRON_VERSION } from '../src/electron-binary.mjs';

const CORE_ENTRY = 'live2dcubismcore.min.js';

async function temp() {
  return await mkdtemp(path.join(tmpdir(), 'live2d-doctor-'));
}

/** 搭一个"装好了"的假环境：插件、模型、Core、Electron 缓存、运行中的 bridge。 */
async function healthyHome() {
  const home = await temp();
  const pluginDir = path.join(home, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-deepseek-live2d');
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'dsh-deepseek-live2d', version: '9.9.9' }));

  const dir = path.join(home, '.dsh', 'live2d');
  const modelDir = path.join(dir, 'DeepSeek-chan');
  await mkdir(modelDir, { recursive: true });
  await writeFile(path.join(modelDir, '大肥鱼.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: { Moc: '大肥鱼.moc3', Textures: ['tex.png'] },
  }));
  await writeFile(path.join(modelDir, '大肥鱼.moc3'), Buffer.from('MOC3xxxx'));
  await writeFile(path.join(modelDir, 'tex.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const core = Buffer.concat([Buffer.from('/* Live2DCubismCore */'), Buffer.alloc(60 * 1024, 0x20)]);
  await writeFile(path.join(dir, CORE_ENTRY), core);

  const electron = electronBinaryPath(electronCacheDir({ home, version: ELECTRON_VERSION }));
  await mkdir(path.dirname(electron), { recursive: true });
  await writeFile(electron, 'binary');

  const bridge = path.join(dir, 'desktop-bridge.json');
  await writeFile(bridge, JSON.stringify({ port: 1, token: 'x', pid: 1 }));

  return { home, dir, pluginDir, electron };
}

test('环境完整时自检全绿', async () => {
  const { home, dir } = await healthyHome();
  try {
    const report = await runDoctor({ home, env: {} });
    const failed = report.checks.filter(check => !check.ok);
    assert.deepEqual(failed.map(f => f.id), [], `不该有失败项：${failed.map(f => f.label + ':' + f.detail).join(' / ')}`);
    assert.equal(report.ok, true);
    assert.equal(report.summary.version, '9.9.9');
    assert.equal(report.summary.configDir, dir);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('缺 Core / 缺模型 / 缺插件时逐条点名，并给出下一步', async () => {
  const home = await temp();
  try {
    const report = await runDoctor({ home, env: {} });
    assert.equal(report.ok, false);
    const ids = report.checks.filter(check => !check.ok).map(check => check.id);
    assert.ok(ids.includes('plugin'), '应报告插件缺失');
    assert.ok(ids.includes('model'), '应报告模型缺失');
    assert.ok(ids.includes('core'), '应报告 Core 缺失');

    const core = report.checks.find(check => check.id === 'core');
    assert.match(core.hint, /live2d\.com/, 'Core 缺失要给官方下载页');
    const text = formatReport(report);
    assert.match(text, /✖ Cubism Core/);
    assert.match(text, /把下面这段整个复制过去/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Core 放错文件会被识别出来（不是只判断存在）', async () => {
  const { home, dir } = await healthyHome();
  try {
    await writeFile(path.join(dir, CORE_ENTRY), '<html>404</html>');
    const report = await runDoctor({ home, env: {} });
    const core = report.checks.find(check => check.id === 'core');
    assert.equal(core.ok, false);
    assert.match(core.detail, /KB|Live2DCubismCore/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('窗口不在运行时提示怎么拉起', async () => {
  const { home, dir } = await healthyHome();
  try {
    const old = new Date(Date.now() - 30 * 60 * 1000);
    await utimes(path.join(dir, 'desktop-bridge.json'), old, old);
    const report = await runDoctor({ home, env: {} });
    const win = report.checks.find(check => check.id === 'window');
    assert.equal(win.ok, false);
    assert.match(win.hint, /dsh-live2d-desktop|日志/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('报告里带上可直接粘贴的摘要', async () => {
  const { home } = await healthyHome();
  try {
    const report = await runDoctor({ home, env: {} });
    const text = formatReport(report);
    assert.match(text, /插件版本：9\.9\.9/);
    assert.match(text, /资源目录：/);
    assert.match(text, /问题项：无/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
