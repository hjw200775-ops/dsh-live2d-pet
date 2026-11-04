/** 桌宠对话的配置：默认关闭、默认跟随模式；本轮全部是本地模拟，不接真实模型。 */
export const CHAT_MODES = Object.freeze(['follow', 'pet']);
export const CHAT_BACKENDS = Object.freeze(['simulated', 'host']);

export const CHAT_LIMITS = Object.freeze({
  messageChars: 500,
  bodyBytes: 8 * 1024,
  maxTokens: Object.freeze({ min: 16, max: 1024, defaultValue: 256 }),
  historyTurns: Object.freeze({ min: 0, max: 20, defaultValue: 6 }),
  persona: Object.freeze({ maxLength: 200 }),
});

export const DEFAULT_CHAT_PREFERENCES = Object.freeze({
  enabled: false,
  mode: 'follow',
  backend: 'simulated',
  realConsent: false,
  maxTokens: 256,
  historyTurns: 6,
  persona: '',
});

export function defaultChatPreferences() {
  return { ...DEFAULT_CHAT_PREFERENCES };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 校验 chat 段：未知字段丢弃，非法值保留旧值，返回永远是完整结构。 */
export function sanitizeChatPreferences(input, previous = defaultChatPreferences()) {
  const base = { ...defaultChatPreferences(), ...previous };
  if (!isPlainObject(input)) return base;

  if (typeof input.enabled === 'boolean') base.enabled = input.enabled;
  if (CHAT_MODES.includes(input.mode)) base.mode = input.mode;
  if (CHAT_BACKENDS.includes(input.backend)) base.backend = input.backend;
  if (typeof input.realConsent === 'boolean') base.realConsent = input.realConsent;
  if (Number.isFinite(input.maxTokens)) {
    const value = Math.round(input.maxTokens);
    if (value >= CHAT_LIMITS.maxTokens.min && value <= CHAT_LIMITS.maxTokens.max) base.maxTokens = value;
  }
  if (Number.isFinite(input.historyTurns)) {
    const value = Math.round(input.historyTurns);
    if (value >= CHAT_LIMITS.historyTurns.min && value <= CHAT_LIMITS.historyTurns.max) base.historyTurns = value;
  }
  if (typeof input.persona === 'string') base.persona = input.persona.trim().slice(0, CHAT_LIMITS.persona.maxLength);

  return {
    enabled: base.enabled,
    mode: base.mode,
    backend: base.backend,
    realConsent: base.realConsent,
    maxTokens: base.maxTokens,
    historyTurns: base.historyTurns,
    persona: base.persona,
  };
}

/** 单条消息校验：返回 { ok, text } 或 { ok:false, code }。 */
export function validateChatMessage(text) {
  if (typeof text !== 'string') return { ok: false, code: 'invalid-text' };
  const value = text.trim();
  if (!value) return { ok: false, code: 'empty-text' };
  if ([...value].length > CHAT_LIMITS.messageChars) return { ok: false, code: 'text-too-long' };
  return { ok: true, text: value };
}
