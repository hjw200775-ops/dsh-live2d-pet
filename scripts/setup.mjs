#!/usr/bin/env node
/**
 * 一次性准备脚本：补 Electron 运行时、下载模型、检查 Cubism Core。
 *
 *   npx dsh-live2d-setup
 *
 * 插件启动时也会自动做同样的事；这个命令用于「不想重启 DSH，先手动装好」或者排查问题。
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_DOWNLOAD_PAGE, provisionDesktopPet } from '../src/provision.mjs';

const pluginRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const configDir = path.join(homedir(), '.dsh', 'live2d');
const configFile = path.join(configDir, 'config.json');

const log = message => console.log(message);

console.log(`插件目录：${pluginRoot}`);
console.log(`资源目录：${configDir}\n`);

try {
  const result = await provisionDesktopPet({
    pluginRoot,
    configFile,
    configDir,
    env: { ...process.env, DSH_LIVE2D_NO_AUTOFETCH: '' },
    log,
  });

  console.log('');
  console.log(`模型  ：${result.assets?.model?.ready ? '就绪' : '缺失'}`);
  console.log(`Electron：${result.electron?.ready ? result.electron.electron : '缺失'}`);
  console.log(`Core  ：${result.assets?.core?.ready ? result.assets.core.coreFile : '缺失'}`);
  console.log(`桌宠窗口：${result.started ? '已拉起' : `未启动（${result.reason ?? '未知原因'}）`}`);

  if (!result.assets?.core?.ready) {
    console.log(`\n还差最后一步：Live2D Cubism Core 有独立授权，不能随包分发。`);
    console.log(`请从官方页面下载 live2dcubismcore.min.js 后放到：${configDir}`);
    console.log(CORE_DOWNLOAD_PAGE);
  }
} catch (error) {
  console.error(`\n准备失败：${error?.message || error}`);
  process.exitCode = 1;
}
