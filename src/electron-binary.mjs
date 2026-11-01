import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { extractZip } from '../scripts/fetch-model.mjs';

/**
 * Electron 运行时由插件自己下载并缓存。
 *
 * 为什么不放进 dependencies：electron 的 postinstall 会下载二进制，pnpm 默认拦这类构建脚本，
 * 于是 `dsh plugin add` 永远以退出码 1 结束，而 DSH 只在退出码 0 时才把插件登记进
 * dsh.profile.bundles —— 结果是包装了、层没挂上、桌宠永远不出现。
 * 依赖里不放 electron、也不写 postinstall，安装就干净地返回 0。
 */
export const ELECTRON_VERSION = '33.4.11';
export const DEFAULT_MIRROR = 'https://github.com/electron/electron/releases/download/';
export const CORE_DOWNLOAD_PAGE = 'https://www.live2d.com/en/sdk/download/web/';

export function electronArchiveName({ version = ELECTRON_VERSION, platform = process.platform, arch = process.arch } = {}) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

export function electronDownloadUrl({ version = ELECTRON_VERSION, platform = process.platform, arch = process.arch, mirror = DEFAULT_MIRROR } = {}) {
  const base = String(mirror).replace(/\/+$/, '');
  return `${base}/v${version}/${electronArchiveName({ version, platform, arch })}`;
}

/** 解压后真正的可执行文件位置（三个平台布局不同）。 */
export function electronBinaryPath(dir, platform = process.platform) {
  if (platform === 'win32') return path.join(dir, 'electron.exe');
  if (platform === 'darwin') return path.join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dir, 'electron');
}

/** 缓存目录：~/.dsh/live2d/electron/v33.4.11/，多个 profile 共用，不再每个 profile 存一份。 */
export function electronCacheDir({ home = homedir(), version = ELECTRON_VERSION } = {}) {
  return path.join(home, '.dsh', 'live2d', 'electron', `v${version}`);
}

export function resolveMirror(env = process.env) {
  return env.DSH_LIVE2D_ELECTRON_MIRROR || env.ELECTRON_MIRROR || DEFAULT_MIRROR;
}

/**
 * 下载尝试顺序：用户显式指定就只试它；否则先 GitHub，再回退国内镜像。
 * 实测国内直连 GitHub 的 release 附件经常直接失败或只有几十 KB/s，只写"可以换镜像"是不够的——
 * 得让它自动换，否则用户看到的就是"卡在那儿不动"。
 */
export function resolveMirrors(env = process.env) {
  if (env.DSH_LIVE2D_ELECTRON_MIRROR || env.ELECTRON_MIRROR) return [resolveMirror(env)];
  return [DEFAULT_MIRROR, 'https://npmmirror.com/mirrors/electron/'];
}

async function downloadBuffer(url, { log = () => {}, timeoutMs = 30 * 60 * 1000, ua = 'dsh-deepseek-live2d', stallMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let stallTimer = null;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), stallMs);
  };
  try {
    armStall();
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': ua }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const chunks = [];
    let got = 0;
    let lastLog = 0;
    for await (const chunk of res.body) {
      armStall();
      chunks.push(chunk);
      got += chunk.length;
      const now = Date.now();
      if (now - lastLog > 3000) {
        lastLog = now;
        const pct = total ? ` ${((got / total) * 100).toFixed(0)}%` : '';
        log(`[live2d]   已下载 ${(got / 1048576).toFixed(1)} MB${pct}`);
      }
    }
    if (total && got < total) throw new Error(`下载不完整（${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB）`);
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    clearTimeout(stallTimer);
  }
}

async function expectedSha(url, archiveName, log) {
  try {
    const text = Buffer.from(await downloadBuffer(url, { log, timeoutMs: 20000 })).toString('utf8');
    for (const line of text.split('\n')) {
      const [hash, name] = line.trim().split(/\s+\*?/);
      if (name === archiveName && /^[0-9a-f]{64}$/i.test(hash)) return hash.toLowerCase();
    }
  } catch { /* 摘要文件拿不到就跳过校验，不阻塞安装 */ }
  return null;
}

/**
 * 确保 Electron 可用。已缓存则零成本返回；否则下载、校验、解压。
 * 全部失败时抛错，由调用方决定怎么提示。
 */
export async function ensureElectronBinary({
  home = homedir(),
  version = ELECTRON_VERSION,
  env = process.env,
  log = () => {},
  platform = process.platform,
  arch = process.arch,
  deps = {},
} = {}) {
  const dir = electronCacheDir({ home, version });
  const binary = electronBinaryPath(dir, platform);
  if (existsSync(binary)) return { ready: true, electron: binary, downloaded: false, dir };

  const mirrors = deps.mirrors || resolveMirrors(env);
  const archive = electronArchiveName({ version, platform, arch });
  const fetchBuffer = deps.downloadBuffer || downloadBuffer;
  const sha = deps.expectedSha || expectedSha;
  const unpack = deps.extractZip || extractZip;

  log('[live2d] 首次启动：正在下载 Electron 运行时（约 100 MB，只需一次）…');

  const failures = [];
  let buffer = null;
  let usedMirror = mirrors[0];
  for (const [index, mirror] of mirrors.entries()) {
    const url = electronDownloadUrl({ version, platform, arch, mirror });
    log(`[live2d]   来源 ${index + 1}/${mirrors.length}：${url}`);
    try {
      buffer = await fetchBuffer(url, { log, ua: `dsh-deepseek-live2d/${version}` });
      usedMirror = mirror;
      break;
    } catch (error) {
      failures.push(`${mirror} → ${error?.message || error}`);
      log(`[live2d]   这个源不行（${error?.message || error}），换下一个…`);
    }
  }
  if (!buffer) throw new Error(`所有下载源都失败：\n  ${failures.join('\n  ')}`);

  const sumUrl = `${String(usedMirror).replace(/\/+$/, '')}/v${version}/SHASUMS256.txt`;
  const want = await sha(sumUrl, archive, log);
  if (want) {
    const got = createHash('sha256').update(buffer).digest('hex');
    if (got !== want) throw new Error(`Electron 归档校验失败（期望 ${want.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）`);
    log('[live2d]   sha256 校验通过。');
  }

  const staging = `${dir}.tmp-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await unpack(buffer, staging);
  if (platform === 'darwin') {
    // 应用包里有一堆可执行文件，统一补上执行位
    const { readdir } = await import('node:fs/promises');
    const walk = async (current) => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.includes('.')) await chmod(full, 0o755).catch(() => {});
      }
    };
    await walk(path.join(staging, 'Electron.app', 'Contents', 'MacOS')).catch(() => {});
  } else if (platform !== 'win32') {
    await chmod(electronBinaryPath(staging, platform), 0o755).catch(() => {});
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(path.dirname(dir), { recursive: true });
  await rename(staging, dir);
  if (!existsSync(binary)) throw new Error('Electron 解压完成但找不到可执行文件');
  log('[live2d] Electron 运行时已就绪。');
  return { ready: true, electron: binary, downloaded: true, dir };
}
