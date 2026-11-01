#!/usr/bin/env node
/**
 * 把用户手里已有的 Live2D Cubism Core 导入到约定目录。
 *
 *   npx dsh-live2d-import-core "C:\下载\live2dcubismcore.min.js"
 *   npx dsh-live2d-import-core "C:\下载\core解压目录"
 *
 * 会先校验文件大小和特征字符串，避免把浏览器下载到的 HTML 错误页当成 Core。
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { CORE_DOWNLOAD_PAGE, importCore } from '../src/core.mjs';

const source = process.argv[2];
const destDir = path.join(homedir(), '.dsh', 'live2d');

if (!source) {
  console.log('用法：npx dsh-live2d-import-core <live2dcubismcore.min.js 的路径，或包含它的目录>');
  console.log(`没有这个文件的话，去 Live2D 官网下载（免费）：${CORE_DOWNLOAD_PAGE}`);
  process.exitCode = 1;
} else {
  const result = await importCore({ source, destDir });
  if (result.ok) {
    if (result.same) {
      console.log(`这个文件已经在约定位置了，不用搬：${result.dest}`);
    } else {
      console.log(`已导入：${result.dest}`);
      console.log(`大小：${(result.size / 1024).toFixed(0)} KB`);
      if (result.backedUp) console.log(`原文件已备份：${result.backedUp}`);
    }
    console.log('\n下一步：完全退出 DSH（应用 → 退出）再重新打开。');
  } else {
    console.error(`导入失败：${result.reason}`);
    if (result.source) console.error(`来源：${result.source}`);
    console.error(`\n请从 Live2D 官网重新下载：${CORE_DOWNLOAD_PAGE}`);
    process.exitCode = 1;
  }
}
