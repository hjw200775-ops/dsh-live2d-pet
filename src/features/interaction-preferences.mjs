/**
 * 交互反馈配置：默认值、边界与校验。
 *
 * 这里只有纯数据与纯函数，服务端（src/preferences.js）和渲染器（renderer/viewer.js）
 * 共用同一份规则，避免出现「面板能填、存档拒收」这类两端不一致。
 * 默认值刻意等于 v0.7.3 的硬编码行为：摸头/身体单击/双击全开、冷却 650 毫秒、
 * 摸头三句气泡、双击一句、身体单击不弹气泡。
 */

export const INTERACTION_VERSION = 1;

export const INTERACTION_LIMITS = Object.freeze({
  cooldownMs: Object.freeze({ min: 0, max: 10000, defaultValue: 650, step: 50 }),
  bubbles: Object.freeze({ maxItems: 12, maxLength: 40 }),
});

const KINDS = Object.freeze(['head', 'body', 'double']);

export const INTERACTION_KINDS = KINDS;

const DEFAULT_ENABLED = Object.freeze({ head: true, body: true, double: true });
const DEFAULT_BUBBLES = Object.freeze({
  head: Object.freeze(['嗯？', '在的', '嘿嘿']),
  body: Object.freeze([]),
  double: Object.freeze(['嘿嘿！']),
});

export function defaultInteractionPreferences() {
  return {
    version: INTERACTION_VERSION,
    enabled: { ...DEFAULT_ENABLED },
    bubbles: { head: [...DEFAULT_BUBBLES.head], body: [...DEFAULT_BUBBLES.body], double: [...DEFAULT_BUBBLES.double] },
    cooldownMs: INTERACTION_LIMITS.cooldownMs.defaultValue,
  };
}

function clone(value) {
  return {
    version: INTERACTION_VERSION,
    enabled: { ...value.enabled },
    bubbles: { head: [...value.bubbles.head], body: [...value.bubbles.body], double: [...value.bubbles.double] },
    cooldownMs: value.cooldownMs,
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把一段来电配置归一成合法值：
 * - 布尔开关只接受 boolean，其余保留旧值；
 * - 冷却只接受 0…10000 的有限数字，四舍五入到整数，越界保留旧值；
 * - 气泡必须是字符串数组，逐条 trim、丢弃空串、截断到 40 字、最多 12 条；
 * - 未知字段直接丢弃，返回值永远是完整结构。
 */
export function sanitizeInteractionPreferences(input, previous = defaultInteractionPreferences()) {
  const base = clone(previous);
  if (!isPlainObject(input)) return base;

  if (isPlainObject(input.enabled)) {
    for (const kind of KINDS) {
      if (typeof input.enabled[kind] === 'boolean') base.enabled[kind] = input.enabled[kind];
    }
  }

  if (isPlainObject(input.bubbles)) {
    for (const kind of KINDS) {
      const list = input.bubbles[kind];
      if (!Array.isArray(list)) continue;
      const cleaned = [];
      for (const item of list) {
        if (typeof item !== 'string') continue;
        const text = item.trim().slice(0, INTERACTION_LIMITS.bubbles.maxLength);
        if (!text) continue;
        cleaned.push(text);
        if (cleaned.length >= INTERACTION_LIMITS.bubbles.maxItems) break;
      }
      base.bubbles[kind] = cleaned;
    }
  }

  const cooldown = input.cooldownMs;
  if (typeof cooldown === 'number' && Number.isFinite(cooldown)
    && cooldown >= INTERACTION_LIMITS.cooldownMs.min && cooldown <= INTERACTION_LIMITS.cooldownMs.max) {
    base.cooldownMs = Math.round(cooldown);
  }

  return base;
}

/** 恢复默认：返回一份全新的默认值，调用方改它不会污染常量。 */
export function resetInteractionPreferences() {
  return defaultInteractionPreferences();
}

/** 从一组候选气泡里取一条；空列表返回 null，表示这一次不弹气泡。 */
export function pickBubble(texts, random = Math.random) {
  if (!Array.isArray(texts) || texts.length === 0) return null;
  const index = Math.min(texts.length - 1, Math.floor(random() * texts.length));
  return texts[Math.max(0, index)];
}

/** 面板文本 ↔ 配置数组：用逗号、中文逗号或竖线分隔，落盘时仍走 sanitize。 */
export function parseBubbleText(text) {
  return String(text ?? '')
    .split(/[,，|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function formatBubbleText(texts) {
  return Array.isArray(texts) ? texts.join('，') : '';
}
