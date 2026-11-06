import { homedir } from 'node:os';
import path from 'node:path';

const home = homedir();

const BLOCKED = [
  /\.moc3$/i,
  /\.png$/i,
  /\.psd$/i,
  /\.env$/i,
  /(^|\/)config\.json$/i,
  /desktop-preferences/i,
  /desktop-bridge/i,
  /live2dcubismcore/i,
  /credential/i,
  /api[_-]?key/i,
];

export const LOCAL_KEEPS = [
  path.join(home, '.dsh', 'live2d', 'config.json'),
  path.join(home, '.dsh', 'live2d', 'deepseek-chan'),
  path.join(home, '.dsh', 'live2d', 'live2dcubismcore.min.js'),
  path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'),
];

// 托盘图标是程序自带的 UI 资源，不属于「模型/截图」，放行。
const ALLOWED = [/desktop\/tray\.png$/i, /renderer\/assets\/petpat\.png$/i];

export function blockedPackEntries(entries) {
  return entries.filter(entry => {
    const normalized = String(entry).replaceAll('\\', '/');
    if (ALLOWED.some(pattern => pattern.test(normalized))) return false;
    return BLOCKED.some(pattern => pattern.test(normalized));
  });
}

export function rollbackPlan({ tarball, cli = 'dsh' }) {
  const name = String(tarball).split(/[/\\]/).pop();
  if (!/^dsh-deepseek-live2d-[\w.-]+\.tgz$/i.test(name)) throw new Error('回滚包必须是 dsh-deepseek-live2d 的 tgz');
  return {
    tarball,
    install: [cli, 'plugin', '--profile', 'desktop', 'add', tarball],
    keeps: LOCAL_KEEPS,
  };
}
