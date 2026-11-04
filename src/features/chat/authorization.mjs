import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultChatPreferences, sanitizeChatPreferences, defaultFollowPreferences, sanitizeFollowPreferences } from './config.mjs';
import { resolveHostModel } from './host-adapter.mjs';

export const REAL_CHAT_ENV = 'DSH_LIVE2D_CHAT_REAL';

/**
 * 真实调用只认 **Desktop 窗口** 的存档。
 *
 * 本阶段 overlay（页面内浮层）继续只模拟：两种运行模式共享一个模糊的授权入口
 * 会让"在浮层里点亮开关"变成一条绕过 Desktop 侧确认的路径，因此这里刻意
 * 只读 preferences.desktop.json，不再回退到 preferences.json。
 */
export const DESKTOP_CHAT_FILE = 'preferences.desktop.json';

export async function readStoredChat(configDir) {
  if (!configDir) return defaultChatPreferences();
  try {
    const parsed = JSON.parse(await readFile(path.join(configDir, DESKTOP_CHAT_FILE), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.chat) return sanitizeChatPreferences(parsed.chat, defaultChatPreferences());
  } catch { /* 文件缺失/损坏一律按未授权处理 */ }
  return defaultChatPreferences();
}

/**
 * 真实调用的唯一准入判定。不读取请求正文：backend/mode 一律以 Desktop 存档为准，
 * 因此直接请求 Host 桥接也无法绕过开关。
 *
 * 必须同时满足：
 *  1. 用户启用了聊天（chat.enabled === true）；
 *  2. Desktop 存档里 backend 为 host；
 *  3. 用户显式勾选 realConsent；
 *  4. 模式为 pet；
 *  5. 环境变量 DSH_LIVE2D_CHAT_REAL=1；
 *  6. 桥接文件的 Windows ACL 收紧成功（aclRestricted）；
 *  7. Host 能解析出可用模型且 llm.stream 存在。
 */
export async function authorizeRealChat({ configDir, llm, agentDefaultModel, env = process.env, aclRestricted = true } = {}) {
  const chat = await readStoredChat(configDir);
  const reasons = [];
  if (chat.enabled !== true) reasons.push('chat-disabled');
  if (chat.backend !== 'host') reasons.push('backend-not-host');
  if (chat.realConsent !== true) reasons.push('no-user-consent');
  if (chat.mode !== 'pet') reasons.push('mode-not-pet');
  if (env?.[REAL_CHAT_ENV] !== '1') reasons.push('env-disabled');
  if (aclRestricted !== true) reasons.push('acl-unavailable');

  let model = null;
  if (reasons.length === 0) {
    model = await resolveHostModel({ llm, agentDefaultModel });
    if (!model) reasons.push('model-unavailable');
    else if (typeof llm?.stream !== 'function') reasons.push('llm-unavailable');
  }
  return { ok: reasons.length === 0, reasons, chat, model };
}

/** 读取 Desktop 存档里的 follow 段；缺失或损坏按未启用处理。 */
export async function readStoredFollow(configDir) {
  if (!configDir) return defaultFollowPreferences();
  try {
    const parsed = JSON.parse(await readFile(path.join(configDir, DESKTOP_CHAT_FILE), 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.follow) return sanitizeFollowPreferences(parsed.follow, defaultFollowPreferences());
  } catch { /* 未授权 */ }
  return defaultFollowPreferences();
}

/**
 * Follow 授权：必须由用户在 Desktop 里显式开启并选定同一个会话。
 * 不允许服务端自动挑选、也不允许请求正文指定一个未保存的会话。
 */
export async function authorizeFollow({ configDir, sessionId } = {}) {
  const follow = await readStoredFollow(configDir);
  if (follow.enabled !== true) return { ok: false, reason: 'follow-disabled', follow };
  if (!sessionId || follow.sessionId !== sessionId) return { ok: false, reason: 'session-mismatch', follow };
  return { ok: true, reason: 'ok', follow };
}