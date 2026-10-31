#!/usr/bin/env node
/**
 * 一次性准备脚本：补 Electron 运行时、下载模型、检查 Cubism Core。
 *
 *   node <插件目录>/scripts/setup.mjs
 *   npx dsh-live2d-setup        # 建议在 profile 目录里执行，见下
 *
 * 插件启动时也会自动做同样的事；这个命令用于「不想重启 DSH，先手动装好」或者排查问题。
 *
 * 注意：如果在没有本地安装的目录里跑 npx，npx 会临时下载一份副本，那份副本不是 DSH
 * 实际加载的插件；这里的逻辑会自己回去 ~/.dsh/profiles/* 找已安装的那份补。
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_DOWNLOAD_PAGE, findInstalledPluginRoot, provisionDesktopPet } from '../src/provision.mjs';

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

const selfRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const explicitRoot = argValue('--plugin');
const installedRoot = explicitRoot || (selfRoot.includes(`${path.sep}.dsh${path.sep}profiles`) ? null : await findInstalledPluginRoot());
const pluginRoot = installedRoot ? path.resolve(installedRoot) : selfRoot;

const configDir = path.join(homedir(), '.dsh', 'live2d');
const configFile = path.join(configDir, 'config.json');
const log = message => console.log(message);

console.log(`插件目录：${pluginRoot}`);
if (pluginRoot !== selfRoot) {
  console.log(`（当前脚本运行在临时副本 ${selfRoot}，已自动切到 DSH 实际安装的那份）`);
}
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
  console.log(`模型    ：${result.assets?.model?.ready ? '就绪' : '缺失'}`);
  console.log(`Electron：${result.electron?.ready ? result.electron.electron : '缺失'}`);
  console.log(`Core    ：${result.assets?.core?.ready ? result.assets.core.coreFile : '缺失'}`);
  console.log(`桌宠窗口：${result.started ? '已拉起' : `未启动（${result.reason ?? '未知原因'}）`}`);

  if (!result.assets?.core?.ready) {
    console.log('\n还差最后一步：Live2D Cubism Core 有独立授权，不能随包分发。');
    console.log(`请从官方页面下载 live2dcubismcore.min.js 后放到：${configDir}`);
    console.log(CORE_DOWNLOAD_PAGE);
  }
} catch (error) {
  console.error(`\n准备失败：${error?.message || error}`);
  process.exitCode = 1;
}
