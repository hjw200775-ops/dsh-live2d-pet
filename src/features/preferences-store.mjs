import { access, readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { sanitizePreferences } from '../preferences.js';

/** overlay（页面内浮层）继续用旧的单文件；desktop（独立窗口）改用独立文件，避免两边整份回写互相覆盖。 */
export const OVERLAY_PREFERENCES_FILE = 'preferences.json';
export const DESKTOP_PREFERENCES_FILE = 'preferences.desktop.json';

const exists = async file => access(file).then(() => true, () => false);

/**
 * 决定某种模式该用哪份存档。
 * 允许 DSH_LIVE2D_PREFERENCES_FILE 强制覆盖，用于回退或排障。
 */
export function resolvePreferencesFile({ mode, configDir, override }) {
  if (override) return override;
  if (mode === 'desktop') return path.join(configDir, DESKTOP_PREFERENCES_FILE);
  return path.join(configDir, OVERLAY_PREFERENCES_FILE);
}

/**
 * desktop 第一次启动时，从旧的 preferences.json 复制一份到新文件。
 *
 * 约定（缺一不可）：
 * - 目标文件已存在就完全不动（绝不覆盖已有 desktop 存档）；
 * - 旧文件缺失或损坏时不创建目标文件，交给 createPreferences 用默认值；
 * - 只读旧文件，**从不删除或修改**它，回退只需删掉新文件；
 * - 写入走临时文件 + rename，避免半截文件。
 */
export async function migrateLegacyPreferences({ legacyFile, targetFile }) {
  if (path.resolve(legacyFile) === path.resolve(targetFile)) return { migrated: false, reason: 'same-file' };
  if (await exists(targetFile)) return { migrated: false, reason: 'target-exists' };
  if (!(await exists(legacyFile))) return { migrated: false, reason: 'no-legacy' };

  let raw;
  try {
    raw = await readFile(legacyFile, 'utf8');
  } catch {
    return { migrated: false, reason: 'unreadable-legacy' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { migrated: false, reason: 'invalid-legacy' };
  }
  // 用与运行时相同的清洗规则，保证迁移出来的内容一定可读、可继续写。
  const value = sanitizePreferences(parsed);
  await mkdir(path.dirname(targetFile), { recursive: true });
  const temporary = `${targetFile}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, targetFile);
  return { migrated: true, reason: 'copied' };
}
