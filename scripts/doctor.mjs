#!/usr/bin/env node
/**
 * 一条命令做自检：插件 / 配置 / 模型 / Core / Electron / 桌面窗口 / 日志。
 *
 *   npx dsh-live2d-doctor
 *   npx dsh-live2d-doctor --json    # 给脚本或 CI 用
 *
 * 有问题时会把「要复制给作者的那段」一起打出来，省得用户复述不清。
 */
import { formatReport, runDoctor } from '../src/doctor.mjs';

const wantJson = process.argv.slice(2).includes('--json');

try {
  const report = await runDoctor({});
  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }
  // 自检本身不算失败：真的抛异常才用非零退出码
  process.exitCode = 0;
} catch (error) {
  console.error(`自检失败：${error?.message || error}`);
  process.exitCode = 1;
}
