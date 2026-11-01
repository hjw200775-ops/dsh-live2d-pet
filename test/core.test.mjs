import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CORE_FILE, checkCore, importCore, validateCoreFile } from '../src/core.mjs';

async function temp() {
  return await mkdtemp(path.join(tmpdir(), 'live2d-core-'));
}

/** 造一个"像样"的 Core：体积过线 + 含特征字符串。 */
async function fakeCore(dir, name = CORE_FILE) {
  const body = Buffer.concat([Buffer.from('/* Live2DCubismCore */\n'), Buffer.alloc(60 * 1024, 0x20)]);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, body);
  return file;
}

test('正常 Core 能通过校验', async () => {
  const dir = await temp();
  try {
    const file = await fakeCore(dir);
    const result = await validateCoreFile(file);
    assert.equal(result.ok, true);
    assert.ok(result.size > 50 * 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('文件不存在 / 太小 / 内容不对都会被拦下，并说清原因', async () => {
  const dir = await temp();
  try {
    const missing = await validateCoreFile(path.join(dir, 'nope.js'));
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /不存在/);

    const tiny = path.join(dir, 'tiny.js');
    await writeFile(tiny, 'Live2DCubismCore');
    const small = await validateCoreFile(tiny);
    assert.equal(small.ok, false);
    assert.match(small.reason, /太小/);

    const wrong = path.join(dir, 'wrong.js');
    await writeFile(wrong, Buffer.alloc(60 * 1024, 0x20));
    const bad = await validateCoreFile(wrong);
    assert.equal(bad.ok, false);
    assert.match(bad.reason, /Live2DCubismCore/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('导入：给文件路径就复制，给目录就找里面的 Core', async () => {
  const root = await temp();
  try {
    const srcDir = path.join(root, 'download');
    const file = await fakeCore(srcDir);
    const destDir = path.join(root, 'live2d');

    const byFile = await importCore({ source: file, destDir });
    assert.equal(byFile.ok, true);
    assert.equal(byFile.dest, path.join(destDir, CORE_FILE));
    assert.ok((await readFile(byFile.dest)).length > 50 * 1024);

    const byDir = await importCore({ source: srcDir, destDir });
    assert.equal(byDir.ok, true);
    assert.equal(byDir.source, file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('导入时旧 Core 会先备份，不会悄悄覆盖', async () => {
  const root = await temp();
  try {
    const destDir = path.join(root, 'live2d');
    await fakeCore(destDir, 'live2dcubismcore.min.js');
    const older = await readFile(path.join(destDir, CORE_FILE));
    const source = await fakeCore(path.join(root, 'new'));

    const result = await importCore({ source, destDir });
    assert.equal(result.ok, true);
    assert.ok(result.backedUp, '应该有备份路径');
    const backup = await readFile(result.backedUp);
    assert.deepEqual(backup, older);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('导入失败时不留下半成品', async () => {
  const root = await temp();
  try {
    const destDir = path.join(root, 'live2d');
    const bad = path.join(root, 'bad.js');
    await writeFile(bad, 'not a core');
    const result = await importCore({ source: bad, destDir });
    assert.equal(result.ok, false);
    assert.equal(await readFile(path.join(destDir, CORE_FILE)).then(() => true, () => false), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('源文件就是目标文件时直接跳过，不会把源弄丢', async () => {
  const root = await temp();
  try {
    const destDir = path.join(root, 'live2d');
    const file = await fakeCore(destDir);
    const before = await readFile(file);
    const result = await importCore({ source: file, destDir });
    assert.equal(result.ok, true);
    assert.equal(result.same, true);
    assert.deepEqual(await readFile(file), before, '文件内容不能被改动或丢失');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkCore 认得约定文件名', async () => {
  const dir = await temp();
  try {
    const missing = await checkCore({ configDir: dir });
    assert.equal(missing.ready, false);
    assert.equal(missing.expected, path.join(dir, CORE_FILE));
    await fakeCore(dir);
    assert.equal((await checkCore({ configDir: dir })).ready, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
