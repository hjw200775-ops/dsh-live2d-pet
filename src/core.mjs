import { access, copyFile, mkdir, readFile, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export const CORE_FILE = 'live2dcubismcore.min.js';
export const CORE_DOWNLOAD_PAGE = 'https://www.live2d.com/en/sdk/download/web/';
/** Core 压缩后正常在 100 KB 以上；太小的基本是下载了一半或者根本不是它。 */
export const CORE_MIN_BYTES = 50 * 1024;

export async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/** Cubism Core 有独立授权，不能随包分发也不能替用户下载，只能检查。 */
export async function checkCore({ coreFile, configDir }) {
  if (coreFile && (await exists(coreFile))) return { ready: true, coreFile };
  const fallback = path.join(configDir, CORE_FILE);
  if (await exists(fallback)) return { ready: true, coreFile: fallback };
  return { ready: false, expected: fallback, hint: `把 ${CORE_FILE} 放到 ${configDir}` };
}

/** 确认拿到的文件真的是 Cubism Core（大小 + 特征字符串），避免用户放错文件还一头雾水。 */
export async function validateCoreFile(file) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, reason: '不是文件' };
    if (info.size < CORE_MIN_BYTES) {
      return { ok: false, reason: `文件只有 ${(info.size / 1024).toFixed(1)} KB，太小了，不是完整的 Core（正常 100 KB 以上）` };
    }
    const buf = await readFile(file);
    const text = buf.toString('utf8');
    if (!text.includes('Live2DCubismCore')) {
      return { ok: false, reason: '内容里找不到 Live2DCubismCore，可能不是 Cubism Core 文件' };
    }
    return { ok: true, size: info.size };
  } catch (error) {
    return { ok: false, reason: error.code === 'ENOENT' ? '文件不存在' : error.message };
  }
}

/**
 * 把用户手里已有的 Core 搬进约定目录。
 * 来源可以是文件本身，也可以是包含它的目录（很多人是解压出一个文件夹）。
 */
export async function importCore({ source, destDir, env = process.env }) {
  const fromEnv = source || env.DSH_LIVE2D_CORE;
  if (!fromEnv) return { ok: false, reason: '没有指定 Core 文件路径' };

  let file = path.resolve(fromEnv);
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, CORE_FILE);
  } catch {
    return { ok: false, reason: `找不到这个路径：${file}` };
  }

  const check = await validateCoreFile(file);
  if (!check.ok) return { ok: false, reason: check.reason, source: file };

  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, CORE_FILE);

  // 源和目标本来就是同一个文件：直接算成功。
  // （否则会先把目标改名备份，源也就跟着不见了，复制必然失败）
  try {
    const [from, to] = [await realpath(file), await realpath(dest)];
    if (from === to) return { ok: true, source: file, dest, size: check.size, same: true };
  } catch { /* 目标还不存在，走正常流程 */ }

  let backedUp = null;
  if (await exists(dest)) {
    backedUp = `${dest}.bak-${Date.now()}`;
    await rename(dest, backedUp);
  }
  try {
    await copyFile(file, dest);
  } catch (error) {
    if (backedUp) await rename(backedUp, dest).catch(() => {});
    return { ok: false, reason: `复制失败：${error.message}`, source: file };
  }
  return { ok: true, source: file, dest, size: check.size, backedUp };
}
