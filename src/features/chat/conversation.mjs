/**
 * Pet 短期记忆：只存在 Host 内存里，按实例隔离，绝不写盘。
 *
 * 规则：
 * - 只有「助手成功完成」的一轮才提交；取消/超时/错误/空流一律丢弃；
 * - 每轮记录 backend（simulated / host-llm），构建真实请求时只取同一后端的轮次，
 *   避免模拟演示内容污染真实计费对话；
 * - 同时受轮数、单条长度、总字符数三重上限约束，超限从最旧开始丢。
 */
export const CONVERSATION_LIMITS = Object.freeze({
  maxTurns: 20,
  maxMessageChars: 4000,
  maxTotalChars: 12000,
  pendingTimeoutMs: 120000,
});

export function createPetConversation(options = {}) {
  const maxTurns = clampInt(options.maxTurns, 1, CONVERSATION_LIMITS.maxTurns, CONVERSATION_LIMITS.maxTurns);
  const maxMessageChars = clampInt(options.maxMessageChars, 1, 20000, CONVERSATION_LIMITS.maxMessageChars);
  const maxTotalChars = clampInt(options.maxTotalChars, 1, 100000, CONVERSATION_LIMITS.maxTotalChars);

  const turns = [];
  let pending = null;

  const totalChars = () => turns.reduce((sum, turn) => sum + turn.user.length + turn.assistant.length, 0);
  const trim = () => {
    while (turns.length > maxTurns) turns.shift();
    while (turns.length && totalChars() > maxTotalChars) turns.shift();
  };

  return {
    /** 开始一轮；返回句柄，只有 commit 时才真正入历史。 */
    begin(text, backend = 'simulated') {
      const user = String(text ?? '').slice(0, maxMessageChars);
      pending = { user, backend, startedAt: Date.now() };
      return pending;
    },

    /** 只有助手成功完成、且有可见文本时才提交。 */
    commit(handle, assistantText) {
      if (!handle || handle !== pending) return false;
      if (typeof assistantText !== 'string' || !assistantText.trim()) return false;
      const assistant = assistantText.slice(0, maxMessageChars);
      turns.push({ user: handle.user, assistant, backend: handle.backend, at: Date.now() });
      pending = null;
      trim();
      return true;
    },

    /** 取消/失败：丢弃未完成的轮次，不写历史。 */
    abort(handle) {
      if (handle && handle === pending) pending = null;
    },

    /** 按后端取最近 N 轮（N 由调用方按 historyTurns 决定）。 */
    history(backend, limit = maxTurns) {
      const count = clampInt(limit, 0, maxTurns, maxTurns);
      if (count === 0) return [];
      const pool = turns.filter(turn => !backend || turn.backend === backend);
      return pool.slice(-count).map(turn => ({ user: turn.user, assistant: turn.assistant }));
    },

    clear() {
      turns.length = 0;
      pending = null;
    },

    snapshot() {
      return { turns: turns.length, pending: pending !== null, chars: totalChars() };
    },
  };
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
