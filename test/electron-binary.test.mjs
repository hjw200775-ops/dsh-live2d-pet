import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  electronArchiveName,
  electronBinaryPath,
  electronCacheDir,
  electronDownloadUrl,
  ensureElectronBinary,
  resolveMirror,
  resolveMirrors,
} from '../src/electron-binary.mjs';

const VERSION = '33.4.11';

test('下载地址按平台/架构拼，镜像末尾斜杠可有可无', () => {
  assert.equal(electronArchiveName({ version: VERSION, platform: 'win32', arch: 'x64' }), 'electron-v33.4.11-win32-x64.zip');
  assert.equal(
    electronDownloadUrl({ version: VERSION, platform: 'win32', arch: 'x64' }),
    'https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-win32-x64.zip',
  );
  assert.equal(
    electronDownloadUrl({ version: VERSION, platform: 'win32', arch: 'x64', mirror: 'https://npmmirror.com/mirrors/electron/' }),
    'https://npmmirror.com/mirrors/electron/v33.4.11/electron-v33.4.11-win32-x64.zip',
  );
  assert.equal(
    electronDownloadUrl({ version: VERSION, platform: 'win32', arch: 'x64', mirror: 'https://npmmirror.com/mirrors/electron' }),
    'https://npmmirror.com/mirrors/electron/v33.4.11/electron-v33.4.11-win32-x64.zip',
  );
});

test('镜像优先取插件自己的变量，其次才认 ELECTRON_MIRROR', () => {
  assert.equal(resolveMirror({ ELECTRON_MIRROR: 'https://a/' }), 'https://a/');
  assert.equal(resolveMirror({ DSH_LIVE2D_ELECTRON_MIRROR: 'https://b/', ELECTRON_MIRROR: 'https://a/' }), 'https://b/');
  assert.match(resolveMirror({}), /^https:\/\/github\.com/);
});

test('默认先 GitHub 再回退国内镜像；显式指定时只用指定的那个', () => {
  const def = resolveMirrors({});
  assert.equal(def.length, 2);
  assert.match(def[0], /^https:\/\/github\.com/);
  assert.match(def[1], /npmmirror\.com/);
  assert.deepEqual(resolveMirrors({ ELECTRON_MIRROR: 'https://only/' }), ['https://only/']);
});

test('第一个源失败时自动换下一个', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  const tried = [];
  try {
    const result = await ensureElectronBinary({
      home,
      version: VERSION,
      platform: process.platform,
      log: () => {},
      deps: {
        mirrors: ['https://broken/', 'https://mirror/'],
        downloadBuffer: async (url) => {
          tried.push(url);
          if (url.startsWith('https://broken/')) throw new Error('fetch failed');
          return Buffer.from('zip');
        },
        expectedSha: async () => null,
        extractZip: async (_buf, staging) => {
          await mkdir(staging, { recursive: true });
          await writeFile(electronBinaryPath(staging, process.platform), 'binary');
          return 1;
        },
      },
    });
    assert.equal(result.ready, true);
    assert.equal(tried.length, 2);
    assert.ok(tried[1].startsWith('https://mirror/'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('所有源都失败时报出每个源的原因', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  try {
    await assert.rejects(
      ensureElectronBinary({
        home,
        version: VERSION,
        platform: process.platform,
        deps: {
          mirrors: ['https://a/', 'https://b/'],
          downloadBuffer: async () => { throw new Error('boom'); },
        },
      }),
      /所有下载源都失败[\s\S]*https:\/\/a\/[\s\S]*https:\/\/b\//,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('缓存目录按版本分，多个 profile 共用一份', () => {
  const dir = electronCacheDir({ home: 'C:/Users/x', version: VERSION });
  assert.equal(dir, path.join('C:/Users/x', '.dsh', 'live2d', 'electron', 'v33.4.11'));
});

test('三个平台的可执行文件位置', () => {
  assert.equal(electronBinaryPath('D:/e', 'win32'), path.join('D:/e', 'electron.exe'));
  assert.equal(electronBinaryPath('D:/e', 'linux'), path.join('D:/e', 'electron'));
  assert.equal(electronBinaryPath('D:/e', 'darwin'), path.join('D:/e', 'Electron.app', 'Contents', 'MacOS', 'Electron'));
});

test('缓存命中时零下载', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  const dir = electronCacheDir({ home, version: VERSION });
  await mkdir(dir, { recursive: true });
  await writeFile(electronBinaryPath(dir, process.platform), 'binary');
  let downloads = 0;
  try {
    const result = await ensureElectronBinary({
      home,
      version: VERSION,
      platform: process.platform,
      deps: { downloadBuffer: async () => { downloads++; return Buffer.alloc(0); } },
    });
    assert.equal(result.ready, true);
    assert.equal(result.downloaded, false);
    assert.equal(downloads, 0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('缓存缺失时下载 + 解压，并落到版本目录', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  const logs = [];
  try {
    const result = await ensureElectronBinary({
      home,
      version: VERSION,
      platform: process.platform,
      log: line => logs.push(line),
      deps: {
        downloadBuffer: async (url) => {
          assert.match(url, /electron-v33\.4\.11-/);
          return Buffer.from('fake-zip');
        },
        expectedSha: async () => null,
        extractZip: async (_buf, staging) => {
          await mkdir(staging, { recursive: true });
          await writeFile(electronBinaryPath(staging, process.platform), 'binary');
          return 1;
        },
      },
    });
    assert.equal(result.ready, true);
    assert.equal(result.downloaded, true);
    assert.equal(result.electron, electronBinaryPath(electronCacheDir({ home, version: VERSION }), process.platform));
    assert.ok(logs.some(line => line.includes('Electron')), '下载过程要有日志');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('解压后没有可执行文件就报错，不留下半成品缓存', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  try {
    await assert.rejects(
      ensureElectronBinary({
        home,
        version: VERSION,
        platform: process.platform,
        deps: {
          downloadBuffer: async () => Buffer.from('fake-zip'),
          expectedSha: async () => null,
          extractZip: async (_buf, staging) => { await mkdir(staging, { recursive: true }); return 0; },
        },
      }),
      /找不到可执行文件/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('钩子版本与校验不匹配时中止', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'live2d-el-'));
  try {
    await assert.rejects(
      ensureElectronBinary({
        home,
        version: VERSION,
        platform: process.platform,
        deps: {
          downloadBuffer: async () => Buffer.from('fake-zip'),
          expectedSha: async () => 'a'.repeat(64),
          extractZip: async (_buf, staging) => {
            await mkdir(staging, { recursive: true });
            await writeFile(electronBinaryPath(staging, process.platform), 'binary');
            return 1;
          },
        },
      }),
      /校验失败/,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
