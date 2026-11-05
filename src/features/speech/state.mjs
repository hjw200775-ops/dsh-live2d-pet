/**
 * SpeechState：语音管线的唯一状态源（不依赖 Node API，浏览器与测试通用）。
 *
 * 状态：idle / synthesizing / speaking / stopped / error
 * 事件：statechange({state, reason})、rms({rms, at})
 *
 * 口型同步契约（供主机 Codex 消费，本轮只定义不消费）：
 *   - 订阅 `rms` 事件即可得到 0..1 的响度包络（频率取决于播放器，约 30–60 Hz）；
 *   - 负载固定为 { rms:number, at:number }，不含文本、路径或会话信息；
 *   - 停止/出错/空闲时 rms 归零，保证嘴部参数自然闭合。
 */
export const SPEECH_STATES = Object.freeze(['idle', 'synthesizing', 'speaking', 'stopped', 'error']);

export function createSpeechState({ now = () => Date.now() } = {}) {
  const listeners = new Map();
  let state = 'idle';
  let reason = null;

  const emit = (event, payload) => {
    for (const handler of listeners.get(event) ?? []) {
      try { handler(payload); } catch { /* 单个订阅者出错不影响其它订阅者 */ }
    }
  };
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
  };

  const set = (next, why = null) => {
    if (!SPEECH_STATES.includes(next)) throw new Error(`未知语音状态：${next}`);
    if (state === next && reason === why) return;
    state = next;
    reason = why;
    emit('statechange', { state, reason });
  };

  return {
    get state() { return state; },
    get reason() { return reason; },
    set,
    publishRms(rms) {
      const value = Number.isFinite(rms) ? Math.min(1, Math.max(0, rms)) : 0;
      emit('rms', { rms: value, at: now() });
    },
    on,
    off(event, handler) { listeners.get(event)?.delete(handler); },
    dispose() { listeners.clear(); state = 'idle'; reason = null; },
  };
}
