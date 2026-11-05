import { FOLLOW_LIMITS } from './config.mjs';

/**
 * Follow（只读陪伴）的纯逻辑：
 * - 只从 assistant/message 里取 **text** 块，忽略 reasoning / tool-call / 工具结果 / 系统提示词；
 * - 按事件 seq 去重（同一事件重复到达不会重复弹气泡）；
 * - 截断到固定长度并标注省略；
 * - 状态事件只做白名单映射（running / idle），不带任何正文。
 */

const STATUS_KINDS = new Set(['running', 'idle']);

/** 从 AssistantMessage 里拼出可展示文本；只认 type==='text' 的块。 */
export function assistantTextOf(message) {
  if (!message || typeof message !== 'object') return '';
  const blocks = Array.isArray(message.content) ? message.content : [];
  const parts = [];
  for (const block of blocks) {
    if (!block || block.type !== 'text') continue;
    if (typeof block.text !== 'string' || !block.text.trim()) continue;
    parts.push(block.text);
  }
  return parts.join('\n').trim();
}

/** 截断到 maxChars（按码点），超长时补省略号。 */
export function truncateFollowText(text, maxChars = FOLLOW_LIMITS.maxTextChars) {
  const chars = [...String(text ?? '')];
  if (chars.length <= maxChars) return { text: chars.join(''), truncated: false };
  return { text: chars.slice(0, Math.max(1, maxChars - 1)).join('') + '…', truncated: true };
}

/**
 * 把一个 session/event 归一成可发送的 follow 帧；不属于可展示类型时返回 null。
 * 只处理 assistant/message；user/message、tool/result、推理与工具都丢弃。
 */
export function followFrameFromEvent(session, event) {
  const sessionId = typeof session?.id === 'string' ? session.id : (typeof session === 'string' ? session : '');
  if (!sessionId || !event || event.type !== 'assistant/message') return null;
  const text = assistantTextOf(event.data?.message);
  if (!text) return null;
  const { text: clipped, truncated } = truncateFollowText(text);
  return {
    type: 'follow-message',
    sessionId,
    seq: Number.isInteger(event.seq) ? event.seq : null,
    turn: Number.isInteger(event.data?.turn) ? event.data.turn : null,
    interrupted: event.data?.interrupted === true,
    text: clipped,
    truncated,
    at: typeof event.time === 'number' ? event.time : Date.now(),
  };
}

/** 会话状态帧：只映射 running/idle，不携带会话标题或正文。 */
export function followStatusFrame(sessionId, running) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const kind = running ? 'running' : 'idle';
  if (!STATUS_KINDS.has(kind)) return null;
  return { type: 'follow-status', sessionId, status: kind };
}

/** 去重器：只保留最近 N 个 seq。 */
export function createFollowDeduper(limit = 200) {
  const seen = new Set();
  const order = [];
  return {
    accept(seq) {
      if (!Number.isInteger(seq)) return true;
      if (seen.has(seq)) return false;
      seen.add(seq);
      order.push(seq);
      if (order.length > limit) seen.delete(order.shift());
      return true;
    },
  };
}

/** 会话列表项的展示裁剪：标题可能含敏感信息，限制长度并交给用户判断是否选择。 */
export function sanitizeSessionList(value) {
  const raw = Array.isArray(value) ? value : (value?.sessions || value?.items || []);
  const list = [];
  for (const item of raw.slice(0, FOLLOW_LIMITS.maxSessions)) {
    const id = typeof item?.id === 'string' ? item.id : (typeof item === 'string' ? item : '');
    if (!id) continue;
    const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : id;
    list.push({ id, title: [...title].slice(0, FOLLOW_LIMITS.maxTitleChars).join('') });
  }
  return list;
}

/** 连接持续这么久才算稳定，允许把连续失败计数清零。 */
export const FOLLOW_STABLE_MS = 60000;

/**
 * 断线后的重连决策：
 * - 稳定连接（≥60s）后清零失败计数，再按第 1 次算；
 * - 未稳定就断开，累加失败次数，不会因为"连上又立刻断"无限重试；
 * - 达到上限返回 giveUp。
 */
export function followRetryAfterDisconnect({ connectedMs = 0, retries = 0, maxRetries = 5 } = {}) {
  const stable = connectedMs >= FOLLOW_STABLE_MS;
  const base = stable ? 0 : Math.max(0, Number(retries) || 0);
  if (base >= maxRetries) return { retries: base, giveUp: true, delayMs: 0, stable };
  return { retries: base + 1, giveUp: false, delayMs: Math.min(15000, 1000 * 2 ** base), stable };
}