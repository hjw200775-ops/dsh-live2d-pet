import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 老版本把 electron 装在 node_modules 里；新版本改为插件自己下载，这里只做兼容。 */
export function findElectron(pluginRoot) {
  try {
    const resolved = createRequire(path.join(pluginRoot, 'package.json'))('electron');
    if (typeof resolved === 'string' && existsSync(resolved)) return resolved;
  } catch { /* 没装 electron 依赖是常态：运行时会由 electron-binary.mjs 下载 */ }
  return null;
}

export function desktopLaunchEnv(env, configFile) {
  const childEnv = { ...env, DSH_LIVE2D_CONFIG: configFile };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

/** Open the current desktop pet. A second launch exits because the window locks a single instance. */
export function startDesktopPet({ pluginRoot, configFile, env = process.env, spawnProcess = spawn, electron = null }) {
  const binary = electron || findElectron(pluginRoot);
  const main = path.join(pluginRoot, 'desktop', 'main.mjs');
  if (!binary || !existsSync(main)) return { started: false, reason: binary ? 'desktop-missing' : 'electron-missing' };
  const child = spawnProcess(binary, [main], {
    cwd: pluginRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: desktopLaunchEnv(env, configFile),
  });
  child.unref?.();
  return { started: true, pid: child.pid };
}
