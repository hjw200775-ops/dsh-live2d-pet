#!/usr/bin/env node
/**
 * 手动启动一次独立桌面窗口（不随 DSH 自动启动）。
 *
 *   npx dsh-live2d-desktop
 *
 * Electron 运行时会自动准备（缓存于 ~/.dsh/live2d/electron/v<版本>，只需一次）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureElectronBinary } from '../src/electron-binary.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..');
const main = path.join(pluginRoot, 'desktop', 'main.mjs');
const log = message => console.log(message);

let electron;
try {
  ({ electron } = await ensureElectronBinary({ log }));
} catch (error) {
  console.error(`Electron 准备失败：${error?.message || error}`);
  console.error('国内网络可以设 $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/" 后重试。');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [main], { stdio: 'inherit', cwd: pluginRoot, env });
child.on('exit', code => process.exit(code ?? 0));
