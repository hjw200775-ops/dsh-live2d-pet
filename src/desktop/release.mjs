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

export function blockedPackEntries(entries) {
  return entries.filter(entry => BLOCKED.some(pattern => pattern.test(String(entry).replaceAll('\\', '/'))));
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
