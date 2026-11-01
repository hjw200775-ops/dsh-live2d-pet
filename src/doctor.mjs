import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { checkCore, validateCoreFile, CORE_DOWNLOAD_PAGE } from './core.mjs';
import { electronBinaryPath, electronCacheDir, ELECTRON_VERSION } from './electron-binary.mjs';
import { logsDir } from './log-file.mjs';
import { findElectron } from './launch-desktop.mjs';
import { findInstalledPluginRoot } from './provision.mjs';
import { inspectModel } from './model.js';
import { resolveModelConfig } from './index.js';

async function packageVersion(root) {
  try {
    return JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version ?? null;
  } catch { return null; }
}

async function mtimeOf(file) {
  try { return (await stat(file)).mtimeMs; } catch { return 0; }
}

/**
 * 一条命令把「装没装好、缺哪一步」查清楚，输出可直接粘贴给作者的文本。
 * 用户发帖求助时只要能跑这个，就不用再来回猜。
 */
export async function runDoctor({ home = homedir(), pluginRoot, env = process.env, deps = {} } = {}) {
  const checks = [];
  const add = (id, label, ok, detail, hint) => checks.push({ id, label, ok, detail, hint: ok ? undefined : hint });

  add('platform', '运行环境', true, `${process.platform}-${process.arch} · node ${process.versions.node}${process.versions.electron ? ` · electron ${process.versions.electron}` : ''}`);

  const findRoot = deps.findInstalledPluginRoot || findInstalledPluginRoot;
  const root = pluginRoot || (await findRoot({ home }));
  const version = root ? await packageVersion(root) : null;
  if (root && version) add('plugin', '插件', true, `${version}  ${root}`);
  else add('plugin', '插件', false, root ? '安装目录里没有有效的 package.json' : '没在 ~/.dsh/profiles/* 下找到已安装的插件', '安装：dsh plugin --profile desktop add dsh-deepseek-live2d');

  let resolved;
  try {
    resolved = await resolveModelConfig({}, { home, env });
  } catch (error) {
    add('config', '配置', false, error.message, '检查 ~/.dsh/live2d/config.json 是不是坏的 JSON');
    resolved = { configDir: path.join(home, '.dsh', 'live2d'), configFile: path.join(home, '.dsh', 'live2d', 'config.json'), local: {} };
  }
  const { configDir, configFile, local } = resolved;
  const hasConfig = await mtimeOf(configFile) > 0;
  add('config', '配置文件', true, hasConfig ? configFile : `${configFile}（没有，走约定路径，正常）`);

  if (local.modelFile) {
    let detail = local.modelFile;
    try {
      const report = await inspectModel(local.modelFile);
      detail += `  ·  ${report.report.textures} 张纹理 / ${report.report.motions} 个动作 / ${report.report.expressions} 个表情`;
      add('model', '模型', true, detail);
    } catch (error) {
      add('model', '模型', false, `${local.modelFile}（${error.message}）`, '文件可能被移动或损坏，可删掉后重跑 dsh-live2d-setup 重新下载');
    }
  } else {
    add('model', '模型', false, `没有在 ${configDir} 找到模型`, '首次启动会自动下载；也可以手动下载 Release 里的模型 zip 解压到该目录');
  }

  const core = await checkCore({ coreFile: local.coreFile, configDir });
  if (core.ready) {
    const valid = await validateCoreFile(core.coreFile);
    add('core', 'Cubism Core', valid.ok, valid.ok ? `${core.coreFile}（${(valid.size / 1024).toFixed(0)} KB）` : `${core.coreFile}（${valid.reason}）`,
      valid.ok ? undefined : `重新下载一个替换掉：${CORE_DOWNLOAD_PAGE}`);
  } else {
    add('core', 'Cubism Core', false, `没有 ${path.join(configDir, 'live2dcubismcore.min.js')}`, `从官方页面下载后放进去，或用 dsh-live2d-import-core 导入：${CORE_DOWNLOAD_PAGE}`);
  }

  const legacyElectron = root ? findElectron(root) : null;
  const cachedElectron = electronBinaryPath(electronCacheDir({ home, version: ELECTRON_VERSION }));
  const electronReady = Boolean(legacyElectron) || (await mtimeOf(cachedElectron) > 0);
  add('electron', 'Electron 运行时', electronReady,
    legacyElectron || (electronReady ? `${cachedElectron}（v${ELECTRON_VERSION}）` : `没有 v${ELECTRON_VERSION}`),
    '首次启动会自动下载；国内网络会自动切镜像');

  const bridge = path.join(configDir, 'desktop-bridge.json');
  const bridgeAge = Date.now() - (await mtimeOf(bridge));
  const windowUp = bridgeAge < 120000;
  add('window', '桌面窗口', windowUp, windowUp ? `运行中（bridge 更新于 ${Math.round(bridgeAge / 1000)} 秒前）` : '没检测到运行中的窗口', '启动 DSH 后会自动出现；也可以手动跑 npx dsh-live2d-desktop，或打开日志看 APP_FAIL');

  const dir = logsDir(home);
  const logFile = path.join(dir, `host-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.log`);
  add('logs', '日志目录', true, dir, undefined);

  const failures = checks.filter(check => !check.ok);
  return {
    checks,
    ok: failures.length === 0,
    summary: {
      version,
      pluginRoot: root,
      configDir,
      logsDir: dir,
      logFile,
      platform: `${process.platform}-${process.arch}`,
      node: process.versions.node,
      electron: process.versions.electron ?? null,
      failures: failures.map(f => f.id),
    },
  };
}

export function formatReport(report) {
  const lines = [];
  lines.push(`DSH 桌宠自检 · ${report.ok ? '全部通过' : `${report.checks.filter(c => !c.ok).length} 项有问题`}`);
  lines.push('');
  for (const check of report.checks) {
    lines.push(`${check.ok ? '✔' : '✖'} ${check.label}：${check.detail}`);
    if (check.hint) lines.push(`    → ${check.hint}`);
  }
  lines.push('');
  lines.push('—— 需要作者帮忙时，把下面这段整个复制过去 ——');
  lines.push(`插件版本：${report.summary.version ?? '未知'}`);
  lines.push(`插件目录：${report.summary.pluginRoot ?? '未找到'}`);
  lines.push(`资源目录：${report.summary.configDir}`);
  lines.push(`平台：${report.summary.platform} · node ${report.summary.node}${report.summary.electron ? ` · electron ${report.summary.electron}` : ''}`);
  lines.push(`问题项：${report.summary.failures.length ? report.summary.failures.join(', ') : '无'}`);
  lines.push(`日志目录：${report.summary.logsDir}`);
  return lines.join('\n');
}
