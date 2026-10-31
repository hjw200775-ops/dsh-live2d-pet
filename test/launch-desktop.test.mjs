import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopLaunchEnv, findElectron, startDesktopPet } from '../src/launch-desktop.mjs';

test('desktop launch strips the host electron flag and reports a missing runtime', () => {
  const env = desktopLaunchEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: 'kept' }, 'C:\\cfg.json');
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.DSH_LIVE2D_CONFIG, 'C:\\cfg.json');
  assert.equal(env.PATH, 'kept');
  assert.equal(findElectron('D:\\missing-plugin'), null);
  const calls = [];
  const result = startDesktopPet({
    pluginRoot: 'D:\\missing-plugin',
    configFile: 'C:\\cfg.json',
    spawnProcess(...args) { calls.push(args); return { pid: 1, unref() {} }; },
  });
  assert.equal(result.started, false);
  assert.equal(calls.length, 0);
});
