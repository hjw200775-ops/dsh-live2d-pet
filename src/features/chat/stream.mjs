import { streamSimulatedReply } from './simulator.mjs';
import { encodeSseFrame } from './sse.mjs';

/**
 * 把一次对话写成 SSE 响应（调用方已完成鉴权、限额校验；必要时已写过头）。
 *
 * 帧序列：meta -> delta* -> end{reason} | error{code}
 *
 * 成功判定是严格的：
 * - 只有上游明确给出 finish{reason:'ok'} 才算成功（自定义 produce 由适配器给终止帧）；
 * - 内置模拟器没有终止帧，按其"正常走完"视为成功；
 * - 缺少 finish、未知 finish、aborted、空流都不得显示为成功。
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
  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
  }

  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const onOuterAbort = () => abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  const heartbeat = setInterval(() => { write(': keepalive\n\n'); }, 10000);

  function write(frame) {
    try {
      if (!res.writableEnded) res.write(typeof frame === 'string' ? frame : encodeSseFrame(frame));
    } catch { /* 客户端已断开 */ }
  }

  const custom = typeof produce === 'function';
  let emitted = 0;
  let finish = null;

  try {
    write({ event: 'meta', data: { type: 'meta', simulated: backend === 'simulated', backend, model, ...(degraded ? { degraded: true, reason: degradedReason || 'host-unavailable' } : {}) } });

    const upstream = custom
      ? produce({ signal: controller.signal })
      : plainChunks(streamSimulatedReply({ prompt, mode, signal: controller.signal, scenario }));

    const iterator = upstream[Symbol.asyncIterator]();
    let exhausted = false;
    try {
      for (;;) {
        const step = await nextOrAbort(iterator, controller.signal);
        if (step.aborted) break;
        const { done, value } = step.value;
        if (done) { exhausted = true; break; }
        if (value?.kind === 'finish') { finish = value; break; }
        if (value?.kind === 'delta' && typeof value.text === 'string') {
          emitted += value.text.length;
          write({ event: 'delta', data: { type: 'delta', text: value.text } });
        }
      }
    } finally {
      if (!exhausted) {
        try { await Promise.race([Promise.resolve(iterator.return?.()), delay(200)]); } catch { /* 忽略收尾失败 */ }
      }
    }

    return settle({ timedOut, aborted: controller.signal.aborted, custom, finish, emitted, write, simulated: backend === 'simulated' });
  } catch (error) {
    const code = safeCode(error);
    write({ event: 'error', data: { type: 'error', code } });
    return { emitted, outcome: 'error', code };
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    signal?.removeEventListener('abort', onOuterAbort);
    try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
  }
}

function settle({ timedOut, aborted, custom, finish, emitted, write, simulated }) {
  if (timedOut) {
    write({ event: 'error', data: { type: 'error', code: 'timeout' } });
    return { emitted, outcome: 'timeout' };
  }
  if (finish?.reason === 'aborted' || (!finish && aborted)) {
    write({ event: 'end', data: { type: 'end', reason: 'aborted' } });
    return { emitted, outcome: 'aborted' };
  }
  if (finish?.reason === 'error') {
    const code = finish.code || 'UPSTREAM_ERROR';
    write({ event: 'error', data: { type: 'error', code } });
    return { emitted, outcome: 'error', code };
  }
  if (custom && !finish) {
    write({ event: 'error', data: { type: 'error', code: 'no-finish' } });
    return { emitted, outcome: 'error', code: 'no-finish' };
  }
  if (emitted === 0) {
    write({ event: 'error', data: { type: 'error', code: 'empty-stream' } });
    return { emitted, outcome: 'empty' };
  }
  write({ event: 'end', data: { type: 'end', reason: 'ok', simulated } });
  return { emitted, outcome: 'ok' };
}

/** 只记录白名单形状的错误码，避免把原始 error.message（可能含请求内容）写进日志。 */
export function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : 'UPSTREAM_ERROR';
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** 等待 next()，但对取消立即返回，避免上游不理取消时把请求拖死。 */
function nextOrAbort(iterator, signal) {
  if (signal?.aborted) return Promise.resolve({ aborted: true });
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => { if (!settled) { settled = true; resolve({ aborted: true }); } };
    signal?.addEventListener('abort', onAbort, { once: true });
    iterator.next().then(
      value => { if (!settled) { settled = true; signal?.removeEventListener('abort', onAbort); resolve({ value }); } },
      error => { if (!settled) { settled = true; signal?.removeEventListener('abort', onAbort); reject(error); } },
    );
  });
}

/** 把纯文本分片适配成 {kind:'delta'} 形状。 */
async function* plainChunks(source) {
  for await (const text of source) yield { kind: 'delta', text };
}
