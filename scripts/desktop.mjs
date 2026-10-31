#!/usr/bin/env node
/**
 * 启动独立桌面窗口版桌宠（透明、置顶、覆盖整个桌面）。
 *
 *   npx dsh-live2d-desktop
 *
 * 需要本机有 Electron。没有的话先装：
 *   npm i -g electron@33
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(here, '..', 'desktop', 'main.mjs');
const require = createRequire(path.join(here, '..', 'package.json'));

let electron;
try {
  electron = require('electron');
} catch {
  console.error('没有找到 Electron。请先安装：npm i -g electron@33，然后重新运行 npx dsh-live2d-desktop');
  process.exit(1);
}

const child = spawn(electron, [main], { stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code ?? 0));
