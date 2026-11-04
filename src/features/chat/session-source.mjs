import { sanitizeSessionList } from './follow.mjs';

/**
 * 把 DSH 的 sessionController / ctx 事件包装成 Follow 需要的只读数据源。
 * - list(): 只调用官方 sessionController.list()，不直接读会话数据库；
 * - subscribe(): 订阅 session/event 与 api-session/status，返回退订函数；
 * - dispose(): 释放所有已注册监听器（插件卸载时调用）。
 */
export function createSessionSource({ ctx, sessionController, timeoutMs = 3000 } = {}) {
  const disposers = new Set();

  return {
    async list() {
      if (typeof sessionController?.list !== 'function') return [];
      try {
        const value = await sessionController.list({}, AbortSignal.timeout(timeoutMs));
        return sanitizeSessionList(value);
      } catch {
        return [];
      }
    },

    subscribe(onFrame) {
      if (typeof ctx?.on !== 'function') return () => {};
      const offs = [];
      try {
        offs.push(ctx.on('session/event', (session, event) => onFrame({ session, event })));
      } catch { /* 事件不存在时忽略 */ }
      try {
        offs.push(ctx.on('api-session/status', (sessionId, running) => onFrame({ status: { sessionId, running } })));
      } catch { /* 事件不存在时忽略 */ }
      const off = () => { for (const fn of offs) { try { fn?.(); } catch { /* 忽略 */ } } };
      disposers.add(off);
      return () => { off(); disposers.delete(off); };
    },

    dispose() {
      for (const off of disposers) { try { off(); } catch { /* 忽略 */ } }
      disposers.clear();
    },
  };
}
