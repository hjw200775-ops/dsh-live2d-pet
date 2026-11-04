import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultChatPreferences, sanitizeChatPreferences } from './config.mjs';
import { resolveHostModel } from './host-adapter.mjs';

export const REAL_CHAT_ENV = 'DSH_LIVE2D_CHAT_REAL';

const CANDIDATES = ['preferences.desktop.json', 'preferences.json'];

/**
 * 读取用户当前保存的聊天配置（桌面存档优先，其次 overlay）。
 * 只读、失败就退回默认值——授权判断永远不会因为文件缺失而"放行"。
 */
export async function readStoredChat(configDir) {
  if (!configDir) return defaultChatPreferences();
  for (const name of CANDIDATES) {
    try {
      const parsed = JSON.parse(await readFile(path.join(configDir, name), 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.chat) return sanitizeChatPreferences(parsed.chat, defaultChatPreferences());
    } catch { /* 继续尝试下一个文件 */ }
  }
  return defaultChatPreferences();
}

/**
 * 真实调用的唯一准入判定。**不读取请求正文**：backend/mode 一律以用户保存的配置为准，
 * 因此直接请求 Host 桥接也无法绕过开关。
 *
 * 必须同时满足：
 *  1. 用户保存的 backend 为 host；
 *  2. 用户显式勾选 realConsent（"我知道会产生费用"）；
 *  3. 模式为 pet；
 *  4. 环境变量 DSH_LIVE2D_CHAT_REAL=1；
 *  5. Host 能解析出可用模型且 llm.stream 存在。
 */
export async function authorizeRealChat({ configDir, llm, agentDefaultModel, env = process.env } = {}) {
  const chat = await readStoredChat(configDir);
  const reasons = [];
  if (chat.backend !== 'host') reasons.push('backend-not-host');
  if (chat.realConsent !== true) reasons.push('no-user-consent');
  if (chat.mode !== 'pet') reasons.push('mode-not-pet');
  if (env?.[REAL_CHAT_ENV] !== '1') reasons.push('env-disabled');

  let model = null;
  if (reasons.length === 0) {
    model = await resolveHostModel({ llm, agentDefaultModel });
    if (!model) reasons.push('model-unavailable');
    else if (typeof llm?.stream !== 'function') reasons.push('llm-unavailable');
  }
  return { ok: reasons.length === 0, reasons, chat, model };
}
