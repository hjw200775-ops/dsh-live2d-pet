import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

export function findElectron(pluginRoot) {
  try {
    const resolved = createRequire(path.join(pluginRoot, 'package.json'))('electron');
    if (typeof resolved === 'string' && existsSync(resolved)) return resolved;
  } catch { /* Electron is optional until the desktop package is installed. */ }
  return null;
}

export function desktopLaunchEnv(env, configFile) {
  const childEnv = { ...env, DSH_LIVE2D_CONFIG: configFile };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return childEnv;
}

/** Open the current desktop pet. A second launch exits because the window locks a single instance. */
export function startDesktopPet({ pluginRoot, configFile, env = process.env, spawnProcess = spawn }) {
  const electron = findElectron(pluginRoot);
  const main = path.join(pluginRoot, 'desktop', 'main.mjs');
  if (!electron || !existsSync(main)) return { started: false, reason: electron ? 'desktop-missing' : 'electron-missing' };
  const child = spawnProcess(electron, [main], {
    cwd: pluginRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: desktopLaunchEnv(env, configFile),
  });
  child.unref?.();
  return { started: true, pid: child.pid };
}
