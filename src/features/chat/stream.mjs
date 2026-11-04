import { streamSimulatedReply } from './simulator.mjs';
import { encodeSseFrame } from './sse.mjs';

/**
 * 把一次对话写成 SSE 响应（调用方已完成鉴权、限额校验与 writeHead）。
 *
 * 统一 host-bridge 与 viewer-server 的帧序列，保证 Electron 拿到的内容
 * 与本地模拟完全同构：
 *   meta -> delta* -> end{reason}        正常
 *   meta -> delta* -> error{code}        超时/空流/上游失败
 *
 * @param {object} options
 * @param {import('node:http').ServerResponse} options.res
 * @param {string} options.prompt
 * @param {'pet'|'follow'} [options.mode]
 * @param {AbortSignal} [options.signal]
 * @param {'ok'|'empty'|'error'|'stall'|'hang'} [options.scenario]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.backend] 用于 meta 帧
 * @param {string} [options.model]
 * @param {boolean} [options.degraded] host 不可用时为 true
 * @param {string} [options.degradedReason]
 * @param {() => AsyncIterable<{kind:string,text?:string,reason?:string}>} [options.produce] 自定义上游（适配器）
 */
export async function writeChatStream({
  res,
  prompt,
  mode = 'pet',
  signal,
  scenario = 'ok',
  timeoutMs = 30000,
  backend = 'simulated',
  model = 'local-simulator',
  degraded = false,
  degradedReason,
  produce,
}) {
  const controller = new AbortController();
  // 调用方可能已经写过 SSE 头（host-bridge / 代理路径），没写就补上，避免响应缺 content-type。
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
  }
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const onOuterAbort = () => abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  const heartbeat = setInterval(() => { write(': keepalive\n\n'); }, 10000);

  const write = frame => {
    try {
      if (!res.writableEnded) res.write(typeof frame === 'string' ? frame : encodeSseFrame(frame));
    } catch { /* 客户端已断开 */ }
  };

  let emitted = 0;
  try {
    write({ event: 'meta', data: { type: 'meta', simulated: backend === 'simulated', backend, model, ...(degraded ? { degraded: true, reason: degradedReason || 'host-unavailable' } : {}) } });

    const upstream = produce
      ? produce({ signal: controller.signal })
      : plainChunks(streamSimulatedReply({ prompt, mode, signal: controller.signal, scenario }));

    for await (const chunk of upstream) {
      if (chunk?.kind === 'finish') break;
      if (chunk?.kind === 'delta' && typeof chunk.text === 'string') {
        emitted += chunk.text.length;
        write({ event: 'delta', data: { type: 'delta', text: chunk.text } });
      }
    }

    if (timedOut) write({ event: 'error', data: { type: 'error', code: 'timeout' } });
    else if (controller.signal.aborted) write({ event: 'end', data: { type: 'end', reason: 'aborted' } });
    else if (emitted === 0) write({ event: 'error', data: { type: 'error', code: 'empty-stream' } });
    else write({ event: 'end', data: { type: 'end', reason: 'ok', simulated: backend === 'simulated' } });
    return { emitted, outcome: timedOut ? 'timeout' : controller.signal.aborted ? 'aborted' : emitted === 0 ? 'empty' : 'ok' };
  } catch (error) {
    write({ event: 'error', data: { type: 'error', code: error?.code || 'upstream-error' } });
    return { emitted, outcome: 'error', code: error?.code || 'upstream-error' };
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    signal?.removeEventListener('abort', onOuterAbort);
    try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
  }
}

/** 把纯文本分片适配成 {kind:'delta'} 形状。 */
async function* plainChunks(source) {
  for await (const text of source) yield { kind: 'delta', text };
}
