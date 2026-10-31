#!/usr/bin/env node
/**
 * npm 的 postinstall 钩子：尽力把 Electron 二进制准备好。
 *
 * pnpm 默认会拦依赖的构建脚本，所以这里失败也不算安装失败——插件首次启动时
 * 还会再补一次（见 src/provision.mjs 的 ensureElectron）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureElectron } from '../src/provision.mjs';

const pluginRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  const result = await ensureElectron({ pluginRoot });
  if (!result.ready) {
    console.log(`[live2d] Electron 暂未就绪（${result.reason}），首次启动 DSH 时会自动补装。`);
  }
} catch {
  // 安装阶段永不失败：真正的兜底在插件启动时。
}
