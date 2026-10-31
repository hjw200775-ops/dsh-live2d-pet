import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { blockedPackEntries, rollbackPlan } from '../src/desktop/release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a plugin pack cannot carry the model, core, or local config', () => {
  assert.deepEqual(blockedPackEntries(['package/src/index.js', 'package/renderer/viewer.js']), []);
  const blocked = blockedPackEntries([
    'package/src/index.js',
    'package/texture.png',
    'package/大肥鱼.moc3',
    'package/live2dcubismcore.min.js',
    'package/config.json',
    'package/desktop-preferences.json',
  ]);
  assert.equal(blocked.length, 5);
});

test('rollback only reinstalls a plugin tarball and names the files it must leave alone', () => {
  const tarball = path.join(homedir(), '.dsh', 'live2d', 'dsh-deepseek-live2d-0.4.1.tgz');
  const plan = rollbackPlan({ tarball, cli: 'dsh.cmd' });
  assert.deepEqual(plan.install.slice(1, 5), ['plugin', '--profile', 'desktop', 'add']);
  assert.equal(plan.install.at(-1).endsWith('dsh-deepseek-live2d-0.4.1.tgz'), true);
  assert.equal(plan.keeps.some(file => file.endsWith('config.json')), true);
  assert.equal(plan.keeps.some(file => file.endsWith('live2dcubismcore.min.js')), true);
  assert.equal(plan.install.some(part => /deepseek-chan|moc3|credential/i.test(part)), false);
  assert.throws(() => rollbackPlan({ tarball: 'C:\\secret\\config.json' }), /tgz/);
});

test('the dry-run package from this tree stays clear of private assets', async () => {
  const stdout = await new Promise((resolve, reject) => {
    exec('npm pack --dry-run --json', { cwd: root }, (error, out) => error ? reject(error) : resolve(out));
  });
  const packs = JSON.parse(stdout.slice(stdout.indexOf('[')));
  const names = packs[0].files.map(file => file.path);
  assert.deepEqual(blockedPackEntries(names), []);
  assert.equal(names.some(name => name.endsWith('LICENSE')), true);
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /MIT/);
  assert.match(license, /神宫凉子/);
  assert.match(license, /霓虹猫_NeonNeko/);
  assert.match(license, /Cubism Core/);
});
