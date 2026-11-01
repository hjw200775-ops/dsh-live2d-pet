import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { ensureElectronBinary } from './electron-binary.mjs';
import { findElectron, startDesktopPet } from './launch-desktop.mjs';

/** 模型入口（与 fetch-model 解压后的目录一致）。 */
export const MODEL_ENTRY = path.join('DeepSeek-chan', '大肥鱼.model3.json');
/** 大小写不敏感文件系统上的历史目录名，两种都要认。 */
export const MODEL_ENTRY_LEGACY = path.join('deepseek-chan', '大肥鱼.model3.json');
export const CORE_FILE = 'live2dcubismcore.min.js';
export const CORE_DOWNLOAD_PAGE = 'https://www.live2d.com/en/sdk/download/web/';

export async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/**
 * 找到「真正装进 profile 的那份插件」。
 *
 * 为什么需要：`npx dsh-live2d-setup` 在没有本地安装的目录里执行时，npx 会把包临时下载到
 * 自己的缓存目录再跑，那份副本的 node_modules 不是 DSH 实际加载的那份 —— 往它里面补
 * Electron 等于白补。所以在临时副本里运行时，回头去 ~/.dsh/profiles/* 下找已安装的那份。
 */
export async function findInstalledPluginRoot({ home = homedir(), profilesRoot } = {}) {
  const root = profilesRoot || path.join(home, '.dsh', 'profiles');
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return null; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name, 'node_modules', 'dsh-deepseek-live2d');
    if (!(await exists(path.join(dir, 'package.json')))) continue;
    const info = await stat(dir).catch(() => null);
    candidates.push({ dir, mtime: info?.mtimeMs ?? 0 });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.dir ?? null;
}

/**
 * DSH 宿主本身就是 Electron 时，它的可执行文件加上 ELECTRON_RUN_AS_NODE=1 就是一个 node，
 * 这样自动补装 Electron / 下载模型都不依赖用户机器上有没有单独装 node。
 */
export function nodeHostEnv(env = process.env, { isElectron = Boolean(process.versions?.electron) } = {}) {
  const out = { ...env };
  if (isElectron) out.ELECTRON_RUN_AS_NODE = '1';
  return out;
}

function cleanLog(chunk) {
  return String(chunk).replace(/\r/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

/** 用 node（或带 ELECTRON_RUN_AS_NODE 的 Electron）跑一段脚本，流式把输出转给调用方的 log。 */
export async function runNodeScript({
  script,
  args = [],
  cwd,
  env = process.env,
  timeoutMs = 30 * 60 * 1000,
  log = () => {},
  spawnProcess = spawn,
  nodePath = process.execPath,
  isElectron,
  onChild = () => {},
}) {
  return await new Promise(resolve => {
    let child;
    try {
      child = spawnProcess(nodePath, [script, ...args], {
        cwd,
        env: nodeHostEnv(env, isElectron === undefined ? {} : { isElectron }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, code: null, error });
      return;
    }
    onChild(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已经退出 */ } }, timeoutMs);
    const finish = (payload) => { clearTimeout(timer); resolve(payload); };
    child.stdout?.on('data', chunk => {
      stdout += chunk;
      const text = cleanLog(chunk);
      if (text) log(text);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
      const text = cleanLog(chunk);
      if (text) log(text);
    });
    child.once('error', error => finish({ ok: false, code: null, error, stdout, stderr }));
    child.once('exit', code => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

/**
 * 确保 Electron 可用。
 *
 * 优先用 node_modules 里现成的（老版本装过的机器，避免重复下载约 100 MB）；
 * 没有就由插件自己下载解压到 ~/.dsh/live2d/electron/v<版本>/（多个 profile 共用一份）。
 * 依赖里不再放 electron，安装才不会因为 pnpm 拦构建脚本而返回非零退出码。
 */
export async function ensureElectron({ pluginRoot, env = process.env, home, log = () => {}, deps = {} }) {
  const finder = deps.findElectron || findElectron;
  const legacy = finder(pluginRoot);
  if (legacy) return { ready: true, electron: legacy, installed: false, legacy: true };

  const ensureBinary = deps.ensureElectronBinary || ensureElectronBinary;
  try {
    const result = await ensureBinary({ home, env, log, deps: deps.binary || {} });
    return { ready: true, electron: result.electron, installed: true };
  } catch (error) {
    log('[live2d] Electron 下载/安装失败。');
    log('[live2d]   国内网络可以换镜像后重试：$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"');
    log(`[live2d]   原因：${error?.message || error}`);
    return { ready: false, reason: `electron-download-failed(${error?.message || error})` };
  }
}

/** 模型包不随 npm 包下发，首次启动时自动从 Release 下载并校验 sha256。 */
export async function ensureModel({ pluginRoot, dest, env = process.env, log = () => {}, timeoutMs, deps = {} }) {
  const entry = path.join(dest, MODEL_ENTRY);
  if (await exists(entry) || await exists(path.join(dest, MODEL_ENTRY_LEGACY))) return { ready: true, fetched: false };

  const script = path.join(pluginRoot, 'scripts', 'fetch-model.mjs');
  if (!(await exists(script))) return { ready: false, reason: 'fetch-script-missing' };

  const run = deps.runNodeScript || runNodeScript;
  log('[live2d] 首次启动：正在下载 DeepSeek-chan 模型（约 48 MB，只需一次，请稍候）…');
  const result = await run({ script, args: ['--dest', dest], cwd: pluginRoot, env, timeoutMs, log, spawnProcess: deps.spawnProcess, isElectron: deps.isElectron });
  const ok = await exists(entry) || await exists(path.join(dest, MODEL_ENTRY_LEGACY));
  if (ok) {
    log('[live2d] 模型已就绪。');
    return { ready: true, fetched: true };
  }
  return { ready: false, reason: `model-fetch-failed(${result?.code ?? result?.error?.message ?? 'error'})` };
}

/** Cubism Core 有独立授权，不能随包分发也不能替用户自动下载，只能检查并给出明确指引。 */
export async function checkCore({ coreFile, configDir }) {
  if (coreFile && (await exists(coreFile))) return { ready: true, coreFile };
  const fallback = path.join(configDir, CORE_FILE);
  if (await exists(fallback)) return { ready: true, coreFile: fallback };
  return { ready: false, expected: fallback, hint: `把 ${CORE_FILE} 放到 ${configDir}` };
}

function autoFetchDisabled(config, local, env) {
  return config?.autoFetchModel === false || local?.autoFetchModel === false || env?.DSH_LIVE2D_NO_AUTOFETCH === '1';
}

/** 启动前把「模型 + Core」准备好；已经存在的机器上只做两次文件检查。 */
export async function prepareAssets({ pluginRoot, configDir, local = {}, config = {}, env = process.env, log = () => {}, deps = {} }) {
  const core = await checkCore({ coreFile: local.coreFile, configDir });
  if (!core.ready) {
    log(`[live2d] 还没找到 Live2D Cubism Core：${core.hint}`);
    log(`[live2d] Core 有独立授权、不随包分发，请从官方页面下载（免费）：${CORE_DOWNLOAD_PAGE}`);
  }

  let model;
  if (local.modelFile) model = { ready: true, fetched: false, modelFile: local.modelFile };
  else if (autoFetchDisabled(config, local, env)) model = { ready: false, reason: 'auto-fetch-disabled' };
  else model = await ensureModel({ pluginRoot, dest: configDir, env, log, deps: deps.model || {} });
  if (!model.ready && model.reason !== 'auto-fetch-disabled') log(`[live2d] 模型准备失败：${model.reason}`);

  return { core, model, fetched: model.fetched === true };
}

/** 只负责「Electron 就绪 + 拉起窗口」，供插件启动和 CLI 共用。 */
export async function launchDesktopPet({ pluginRoot, configFile, env = process.env, log = () => {}, deps = {} }) {
  const electron = await ensureElectron({ pluginRoot, env, log, deps: deps.electron || {} });
  if (!electron.ready) {
    log(`[live2d] Electron 运行时不可用（${electron.reason}），桌宠窗口无法打开。`);
    return { started: false, reason: electron.reason, electron };
  }
  const launch = deps.startDesktopPet || startDesktopPet;
  const launched = launch({ pluginRoot, configFile, env, electron: electron.electron, ...(deps.spawnProcess ? { spawnProcess: deps.spawnProcess } : {}) });
  if (launched.started) log('[live2d] 桌宠窗口已拉起。');
  else log(`[live2d] 桌宠窗口没有启动：${launched.reason}`);
  return { ...launched, electron };
}

/** 全流程：准备资源 → 补 Electron → 拉窗口。CLI 与测试用这个入口。 */
export async function provisionDesktopPet({ pluginRoot, configFile, configDir, local = {}, config = {}, env = process.env, log = () => {}, deps = {} }) {
  const assets = await prepareAssets({ pluginRoot, configDir, local, config, env, log, deps });
  const launched = await launchDesktopPet({ pluginRoot, configFile, env, log, deps });
  return { ...launched, assets };
}
