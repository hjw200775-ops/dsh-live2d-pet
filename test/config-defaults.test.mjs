import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveModelConfig } from '../src/index.js';

test('零配置时从 ~/.dsh/live2d 的约定位置找到模型与 Core', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-live2d-'));
  const dir = path.join(home, '.dsh', 'live2d');
  await mkdir(path.join(dir, 'deepseek-chan'), { recursive: true });
  await writeFile(path.join(dir, 'deepseek-chan', '大肥鱼.model3.json'), '{"Version":3}');
  await writeFile(path.join(dir, 'live2dcubismcore.min.js'), '// core');
  try {
    const { configFile, configDir, local } = await resolveModelConfig({}, { home, env: {} });
    assert.equal(configDir, dir);
    assert.equal(configFile, path.join(dir, 'config.json'));
    assert.equal(local.modelFile, path.join(dir, 'deepseek-chan', '大肥鱼.model3.json'));
    assert.equal(local.coreFile, path.join(dir, 'live2dcubismcore.min.js'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('显式配置优先于约定路径', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-live2d-'));
  try {
    const { local } = await resolveModelConfig(
      { modelFile: 'D:/x/model.model3.json', coreFile: 'D:/x/core.js' },
      { home, env: {} },
    );
    assert.equal(local.modelFile, 'D:/x/model.model3.json');
    assert.equal(local.coreFile, 'D:/x/core.js');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('没有模型时保持未设置，交给启动流程给出提示', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-live2d-'));
  try {
    const { local } = await resolveModelConfig({}, { home, env: {} });
    assert.equal(local.modelFile, undefined);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
