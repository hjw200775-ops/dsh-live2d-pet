import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function logsDir(home = homedir()) {
  return path.join(home, '.dsh', 'live2d', 'logs');
}

export function dayStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function rotate(dir, keep) {
  try {
    const files = readdirSync(dir)
      .filter(name => name.endsWith('.log'))
      .map(name => path.join(dir, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    for (const old of files.slice(keep)) rmSync(old, { force: true });
  } catch { /* 轮转失败不影响写日志 */ }
}

/**
 * 落盘日志：出问题时用户能直接把文件发过来，而不是复述"闪一下就没了"。
 * 按天分文件，只保留最近几份。
 */
export function createFileLogger({ home = homedir(), name = 'desktop', keep = 5, alsoConsole = true, file: explicit } = {}) {
  const dir = logsDir(home);
  let file = explicit || null;
  try {
    mkdirSync(dir, { recursive: true });
    if (!file) file = path.join(dir, `${name}-${dayStamp()}.log`);
    rotate(dir, keep);
  } catch {
    file = file || path.join(dir, `${name}-${dayStamp()}.log`);
  }
  const log = line => {
    try { appendFileSync(file, `${new Date().toISOString()} ${line}\n`); } catch { /* 目录不可写就只打控制台 */ }
    if (alsoConsole) console.log(line);
  };
  return { file, dir, log };
}
