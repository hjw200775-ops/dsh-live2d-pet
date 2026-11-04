/**
 * Host 侧真实模型适配器（本轮只用假 llm 验证契约，不发起真实推理）。
 *
 * 设计目标：
 * - 不写死 provider/model：优先用 agentDefaultModel 的解析结果，其次 llm.listProviders()/listModels()；
 * - 不把 llm 变成插件启动依赖：所有失败都返回 null/抛具名错误，由调用方降级；
 * - 只有用户显式开启 + 环境变量 + 人工审批同时满足，才允许真实调用（见 realChatEnabled）。
 */

export class HostChatError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HostChatError';
    this.code = code || 'UPSTREAM_ERROR';
  }
}

/** 真实调用准入：默认关闭，必须显式开启。本轮任何测试都不得让它返回 true。 */
export function realChatEnabled({ env = process.env, chat = {} } = {}) {
  if (chat.backend !== 'host') return { ok: false, reason: 'backend-not-host' };
  if (env.DSH_LIVE2D_CHAT_REAL !== '1') return { ok: false, reason: 'env-not-enabled' };
  return { ok: true, reason: 'enabled' };
}

/**
 * 解析当前 Host 的默认模型。任何一步失败都返回 null（调用方据此降级为模拟）。
 * @param {object} options
 * @param {{ listProviders?: () => string[], listModels?: (provider: string) => Promise<Array<{id:string}>> }} [options.llm]
 * @param {{ get?: () => { provider?: string, model?: string } | null, resolve?: () => Promise<{ provider?: string, model?: string } | null> }} [options.agentDefaultModel]
 */
export async function resolveHostModel({ llm, agentDefaultModel } = {}) {
  try {
    const resolved = typeof agentDefaultModel?.get === 'function' ? agentDefaultModel.get() : undefined;
    if (resolved?.provider && resolved?.model) return { provider: resolved.provider, model: resolved.model, source: 'agent-default-model' };
    const asyncResolved = typeof agentDefaultModel?.resolve === 'function' ? await agentDefaultModel.resolve() : undefined;
    if (asyncResolved?.provider && asyncResolved?.model) return { provider: asyncResolved.provider, model: asyncResolved.model, source: 'agent-default-model' };
  } catch { /* 服务缺失时继续尝试下一来源 */ }

  try {
    const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : [];
    for (const provider of providers || []) {
      const id = provider?.id ?? provider;
      if (!id) continue;
      try {
        const models = await llm.listModels(id);
        const first = models?.find(item => item?.id);
        if (first) return { provider: id, model: first.id, source: 'list-models' };
      } catch { /* 该 provider 目录不可用时试下一个 */ }
    }
  } catch { /* 忽略 */ }
  return null;
}

/** 把 DSH 的 StreamChunk 映射成聊天流需要的形状。 */
export function mapStreamChunk(chunk) {
  if (!chunk || typeof chunk !== 'object') return null;
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') return { kind: 'delta', text: chunk.text };
  if (chunk.type === 'finish') {
    const kind = chunk.reason?.kind;
    if (kind === 'ok') return { kind: 'finish', reason: 'ok' };
    if (kind === 'aborted') return { kind: 'finish', reason: 'aborted' };
    if (kind === 'error') return { kind: 'finish', reason: 'error', code: chunk.reason?.failure?.code || 'UPSTREAM_ERROR' };
    return { kind: 'finish', reason: 'error', code: 'UNKNOWN_FINISH' };
  }
  return null;
}

/**
 * 调用 Host 的 llm.stream，产出统一的 delta / finish。
 * 本轮只接受注入的假对象；真实调用需要先通过 realChatEnabled 的准入检查。
 */
/** 取消时给上游留的收尾时间；超过就放弃等待，避免"上游不理取消"把请求拖死。 */
const ABORT_GRACE_MS = 200;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/** 等待 iterator.next()，但响应取消：取消后立刻返回 {aborted:true}，不再等上游。 */
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

/**
 * 调用 Host 的 llm.stream，产出统一的 delta 与**恰好一个**终止帧：
 *   { kind:'finish', reason:'ok' }
 *   { kind:'finish', reason:'aborted' }
 *   { kind:'finish', reason:'error', code }
 *
 * 语义保证：
 * - 只有适配器明确给出 finish.ok 才算成功；
 * - aborted 不会被当成正常完成；
 * - 缺少 finish（迭代器直接结束）判为 NO_FINISH；
 * - 未知 finish.kind 判为 UNKNOWN_FINISH；
 * - 取消后不再等待不响应取消的上游，最多等 ABORT_GRACE_MS 做收尾。
 */
export async function* streamHostChat({ llm, provider, model, messages, signal, tools }) {
  if (typeof llm?.stream !== 'function') throw new HostChatError('Host 未提供模型服务', 'NO_LLM_SERVICE');
  const iterator = llm.stream({ provider, model, messages, signal, ...(tools ? { tools } : {}) })[Symbol.asyncIterator]();
  let settled = false;
  try {
    for (;;) {
      const step = await nextOrAbort(iterator, signal);
      if (step.aborted) {
        settled = true;
        try { await Promise.race([Promise.resolve(iterator.return?.()), sleep(ABORT_GRACE_MS)]); } catch { /* 忽略 */ }
        yield { kind: 'finish', reason: 'aborted' };
        return;
      }
      const { done, value } = step.value;
      if (done) {
        settled = true;
        yield { kind: 'finish', reason: 'error', code: 'NO_FINISH' };
        return;
      }
      const mapped = mapStreamChunk(value);
      if (!mapped) continue;
      if (mapped.kind === 'finish') {
        settled = true;
        yield mapped.reason === 'error'
          ? { kind: 'finish', reason: 'error', code: mapped.code || 'UPSTREAM_ERROR' }
          : { kind: 'finish', reason: mapped.reason };
        return;
      }
      yield mapped;
    }
  } finally {
    if (!settled) {
      try { await Promise.race([Promise.resolve(iterator.return?.()), sleep(ABORT_GRACE_MS)]); } catch { /* 忽略 */ }
    }
  }
}