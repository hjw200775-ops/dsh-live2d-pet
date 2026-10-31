import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkCore,
  ensureElectron,
  ensureModel,
  findInstalledPluginRoot,
  nodeHostEnv,
  prepareAssets,
  provisionDesktopPet,
  MODEL_ENTRY,
} from '../src/provision.mjs';

async function tempRoot() {
  return await mkdtemp(path.join(tmpdir(), 'dsh-live2d-prov-'));
}

/** 造一个「装好了 electron 包、但没有 dist」的插件根目录，用来验证自动补装。 */
async function fakePluginRoot({ withElectronPackage = true } = {}) {
  const root = await tempRoot();
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fake-plugin', version: '0.0.0' }));
  if (withElectronPackage) {
    const pkg = path.join(root, 'node_modules', 'electron');
    await mkdir(pkg, { recursive: true });
    await writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name: 'electron', version: '33.0.0', main: 'index.js' }));
    await writeFile(path.join(pkg, 'install.js'), '// installer');
  }
  return root;
}

test('Electron 宿主里跑脚本要补 ELECTRON_RUN_AS_NODE，其它环境不动环境变量', () => {
  const base = { PATH: 'kept' };
  const asElectron = nodeHostEnv(base, { isElectron: true });
  assert.equal(asElectron.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(asElectron.PATH, 'kept');
  assert.equal(base.ELECTRON_RUN_AS_NODE, undefined, '不能改到调用方的 env 对象');

  const asNode = nodeHostEnv({ PATH: 'kept' }, { isElectron: false });
  assert.equal(asNode.ELECTRON_RUN_AS_NODE, undefined);
});

test('Electron 已就绪时不再跑安装脚本', async () => {
  const root = await fakePluginRoot();
  let ran = 0;
  try {
    const result = await ensureElectron({
      pluginRoot: root,
      deps: {
        findElectron: () => 'C:/electron/electron.exe',
        runNodeScript: async () => { ran++; return { ok: true }; },
      },
    });
    assert.deepEqual(result, { ready: true, electron: 'C:/electron/electron.exe', installed: false });
    assert.equal(ran, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron 二进制缺失时自动补跑 install.js 并重新解析', async () => {
  const root = await fakePluginRoot();
  const calls = [];
  let installed = false;
  try {
    const result = await ensureElectron({
      pluginRoot: root,
      deps: {
        findElectron: () => (installed ? 'C:/electron/electron.exe' : null),
        runNodeScript: async options => {
          calls.push(options);
          installed = true;
          return { ok: true, code: 0 };
        },
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.installed, true);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].script.endsWith('install.js'));
    // 安装脚本必须在 electron 包目录里跑，才能解析它自己的依赖
    assert.ok(calls[0].cwd.endsWith(path.join('node_modules', 'electron')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('安装脚本失败时给出可读原因，不抛异常', async () => {
  const root = await fakePluginRoot();
  const lines = [];
  try {
    const result = await ensureElectron({
      pluginRoot: root,
      log: line => lines.push(line),
      deps: {
        findElectron: () => null,
        runNodeScript: async () => ({ ok: false, code: 1 }),
      },
    });
    assert.equal(result.ready, false);
    assert.match(result.reason, /electron-install-failed/);
    assert.ok(lines.some(line => line.includes('ELECTRON_MIRROR')), '失败时要提示镜像方案');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('连 electron 包都没有时报告 electron-package-missing', async () => {
  const root = await fakePluginRoot({ withElectronPackage: false });
  try {
    const result = await ensureElectron({ pluginRoot: root, deps: { findElectron: () => null } });
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'electron-package-missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模型已存在时不会重复下载', async () => {
  const root = await fakePluginRoot();
  const dest = path.join(root, 'live2d');
  await mkdir(path.dirname(path.join(dest, MODEL_ENTRY)), { recursive: true });
  await writeFile(path.join(dest, MODEL_ENTRY), '{}');
  let ran = 0;
  try {
    const result = await ensureModel({
      pluginRoot: root,
      dest,
      deps: { runNodeScript: async () => { ran++; return { ok: true }; } },
    });
    assert.deepEqual(result, { ready: true, fetched: false });
    assert.equal(ran, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模型缺失时调用下载脚本，落盘后报告 fetched', async () => {
  const root = await fakePluginRoot();
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'scripts', 'fetch-model.mjs'), '// fetch');
  const dest = path.join(root, 'live2d');
  const calls = [];
  try {
    const result = await ensureModel({
      pluginRoot: root,
      dest,
      deps: {
        runNodeScript: async options => {
          calls.push(options);
          await mkdir(path.dirname(path.join(dest, MODEL_ENTRY)), { recursive: true });
          await writeFile(path.join(dest, MODEL_ENTRY), '{}');
          return { ok: true, code: 0 };
        },
      },
    });
    assert.deepEqual(result, { ready: true, fetched: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['--dest', dest]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模型下载失败时给出可读原因', async () => {
  const root = await fakePluginRoot();
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'scripts', 'fetch-model.mjs'), '// fetch');
  try {
    const result = await ensureModel({
      pluginRoot: root,
      dest: path.join(root, 'live2d'),
      deps: { runNodeScript: async () => ({ ok: false, code: 2 }) },
    });
    assert.equal(result.ready, false);
    assert.match(result.reason, /model-fetch-failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Core 检查认得约定文件名，缺失时给出目标路径', async () => {
  const dir = await tempRoot();
  try {
    const missing = await checkCore({ configDir: dir });
    assert.equal(missing.ready, false);
    assert.equal(missing.expected, path.join(dir, 'live2dcubismcore.min.js'));

    await writeFile(path.join(dir, 'live2dcubismcore.min.js'), '// core');
    const found = await checkCore({ configDir: dir });
    assert.equal(found.ready, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('关闭自动下载时不去碰网络', async () => {
  const root = await fakePluginRoot();
  let ran = 0;
  try {
    const assets = await prepareAssets({
      pluginRoot: root,
      configDir: path.join(root, 'live2d'),
      local: {},
      config: { autoFetchModel: false },
      log: () => {},
      deps: { model: { runNodeScript: async () => { ran++; return { ok: true }; } } },
    });
    assert.equal(assets.model.ready, false);
    assert.equal(assets.model.reason, 'auto-fetch-disabled');
    assert.equal(ran, 0);
    assert.equal(assets.fetched, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('全流程把拿到的模型和 Core 报告出来，并拉起窗口', async () => {
  const root = await fakePluginRoot();
  const configDir = path.join(root, 'live2d');
  await mkdir(path.dirname(path.join(configDir, MODEL_ENTRY)), { recursive: true });
  await writeFile(path.join(configDir, MODEL_ENTRY), '{}');
  let launched = 0;
  try {
    const result = await provisionDesktopPet({
      pluginRoot: root,
      configFile: path.join(configDir, 'config.json'),
      configDir,
      local: {},
      log: () => {},
      deps: {
        startDesktopPet: () => { launched++; return { started: true, pid: 42 }; },
        spawnProcess: () => ({}),
        electron: { findElectron: () => 'C:/electron/electron.exe' },
      },
    });
    assert.equal(result.started, true);
    assert.equal(result.pid, 42);
    assert.equal(result.assets.model.ready, true);
    assert.equal(launched, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron 拉不起来时不假装已启动', async () => {
  const root = await fakePluginRoot({ withElectronPackage: false });
  try {
    const result = await provisionDesktopPet({
      pluginRoot: root,
      configFile: path.join(root, 'config.json'),
      configDir: path.join(root, 'live2d'),
      local: { modelFile: 'x.model3.json' },
      log: () => {},
      deps: { electron: { findElectron: () => null } },
    });
    assert.equal(result.started, false);
    assert.equal(result.reason, 'electron-package-missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('临时副本（npx 缓存）运行时能找回真正装进 profile 的那份插件', async () => {
  const home = await tempRoot();
  const profiles = path.join(home, '.dsh', 'profiles');
  const older = path.join(profiles, 'web', 'node_modules', 'dsh-deepseek-live2d');
  const newer = path.join(profiles, 'desktop', 'node_modules', 'dsh-deepseek-live2d');
  await mkdir(older, { recursive: true });
  await mkdir(newer, { recursive: true });
  await writeFile(path.join(older, 'package.json'), '{}');
  await writeFile(path.join(newer, 'package.json'), '{}');
  const future = new Date(Date.now() + 60_000);
  await utimes(newer, future, future);
  try {
    const found = await findInstalledPluginRoot({ home });
    assert.ok(found, '应该找到已安装的插件');
    assert.equal(path.resolve(found), path.resolve(newer), '应该挑最新的那份');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('没有任何 profile 时返回 null，交给调用方用自身目录', async () => {
  const home = await tempRoot();
  try {
    assert.equal(await findInstalledPluginRoot({ home }), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
