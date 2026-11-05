import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * SherpaTTSProvider：通过独立 Node sidecar 调用 sherpa-onnx。
 *
 * 设计约束：
 * - 原生 addon 只在 sidecar 进程里加载，Electron 渲染器不碰；
 * - sidecar 命令与参数由宿主固定，不接受客户端路径或任意 Shell；
 * - 失败只暴露稳定错误码，不记录正文；
 * - 失败后 provider 会重置加载状态，下一次调用可重试；Mock 可随时回退。
 */
export const SHERPA_PROTOCOL = 'dsh-live2d-tts/1';
export const SHERPA_LIMITS = Object.freeze({ maxChars: 500, requestTimeoutMs: 30000 });

const ABORTED = 'ABORTED';

export function createSherpaTtsProvider({
  transport,
  voices = ['default'],
  defaultVoice = 'default',
  language = 'zh',
  speed = 1,
  timeoutMs = SHERPA_LIMITS.requestTimeoutMs,
  log = () => {},
} = {}) {
  if (!transport || typeof transport.request !== 'function') throw new Error('SherpaTtsProvider 需要 transport');
  const knownVoices = [...new Set(['default', ...voices])];
  let loaded = false;
  let closed = false;
  let pendingLoad = null;

  const ensureOpen = () => {
    if (closed) { const error = new Error('sidecar 已关闭'); error.code = 'SIDECAR_CLOSED'; throw error; }
  };

  const provider = {
    name: 'sherpa-sidecar',
    languages: ['zh', 'en'],
    get loaded() { return loaded; },
    voices() { return [...knownVoices]; },

    /** 加载（ping）sidecar；失败返回错误码，可重试。 */
    async load() {
      ensureOpen();
      if (loaded) return { ok: true };
      if (pendingLoad) return pendingLoad;
      pendingLoad = (async () => {
        try {
          const response = await transport.request({ type: 'ping' }, { timeoutMs });
          if (response.type !== 'ready') throw Object.assign(new Error('sidecar 未就绪'), { code: response.code || 'NOT_READY' });
          loaded = true;
          log('[live2d] tts sidecar ready');
          return { ok: true };
        } catch (error) {
          loaded = false;
          log('[live2d] tts sidecar unavailable code=' + safeCode(error));
          return { ok: false, code: safeCode(error) };
        } finally {
          pendingLoad = null;
        }
      })();
      return pendingLoad;
    },

    async synthesize(text, options = {}, signal) {
      ensureOpen();
      const clean = String(text ?? '').trim();
      if (!clean) { const error = new Error('empty text'); error.code = 'EMPTY_TEXT'; throw error; }
      if ([...clean].length > SHERPA_LIMITS.maxChars) { const error = new Error('text too long'); error.code = 'TEXT_TOO_LONG'; throw error; }
      const voice = knownVoices.includes(options.voice) ? options.voice : defaultVoice;
      const request = {
        type: 'synthesize',
        text: clean,
        voice,
        speed: clampSpeed(options.speed ?? speed),
        language: options.language ?? language,
        speakerId: Number.isInteger(options.speakerId) ? options.speakerId : 0,
      };
      if (signal?.aborted) { const error = new Error('aborted'); error.code = ABORTED; throw error; }
      const onAbort = () => { transport.cancel?.(request.id); };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      try {
        const response = await transport.request(request, { timeoutMs, signal });
        if (response.type === 'error') {
          const error = new Error('tts failed');
          error.code = safeCode({ code: response.code });
          throw error;
        }
        const data = Buffer.from(response.data || '', 'base64');
        return {
          format: 'pcm',
          sampleRate: Number(response.sampleRate) || 22050,
          data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          durationMs: Math.round((data.length / 2 / (Number(response.sampleRate) || 22050)) * 1000),
        };
      } catch (error) {
        if (signal?.aborted || safeCode(error) === ABORTED) {
          const aborted = new Error('aborted');
          aborted.code = ABORTED;
          throw aborted;
        }
        loaded = false;
        throw error;
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
      }
    },

    async unload() {
      if (closed) return;
      closed = true;
      loaded = false;
      try { await transport.close?.(); } catch { /* 忽略 */ }
    },
  };
  return provider;
}

/** 基于子进程的传输层：固定 node + sidecar 路径，禁 shell。 */
export function createProcessTransport({
  nodePath = process.execPath,
  sidecarPath,
  env = {},
  spawnImpl = nodeSpawn,
  log = () => {},
} = {}) {
  if (!sidecarPath) throw new Error('createProcessTransport 需要 sidecarPath');
  const child = spawnImpl(nodePath, [sidecarPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...env },
  });
  const pending = new Map();
  let seq = 0;
  let closed = false;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  const failAll = code => {
    for (const waiter of pending.values()) waiter.reject(Object.assign(new Error(code), { code }));
    pending.clear();
  };
  child.on('error', () => failAll('SIDECAR_SPAWN_FAILED'));
  child.on('exit', code => { closed = true; failAll('SIDECAR_EXITED'); log('[live2d] tts sidecar exit code=' + (Number.isInteger(code) ? code : 'unknown')); });
  child.stderr?.on('data', () => { /* 不记录 sidecar stderr，避免模型路径/正文泄漏 */ });

  return {
    get closed() { return closed; },
    request(message, { timeoutMs = 30000, signal } = {}) {
      if (closed) return Promise.reject(Object.assign(new Error('sidecar 已退出'), { code: 'SIDECAR_EXITED' }));
      const id = ++seq;
      message.id = id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error('timeout'), { code: 'TTS_TIMEOUT' }));
        }, timeoutMs);
        const onAbort = () => {
          clearTimeout(timer);
          pending.delete(id);
          reject(Object.assign(new Error('aborted'), { code: ABORTED }));
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
        pending.set(id, {
          resolve: value => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); resolve(value); },
          reject: error => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); reject(error); },
        });
        try { child.stdin.write(JSON.stringify(message) + '\n'); }
        catch { pending.delete(id); reject(Object.assign(new Error('write failed'), { code: 'SIDECAR_WRITE_FAILED' })); }
      });
    },
    cancel(target) {
      try { child.stdin.write(JSON.stringify({ type: 'cancel', target }) + '\n'); } catch { /* 忽略 */ }
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n'); } catch { /* 忽略 */ }
      const done = new Promise(resolve => child.once('exit', resolve));
      try { child.kill(); } catch { /* 忽略 */ }
      return Promise.race([done, new Promise(resolve => setTimeout(resolve, 2000))]);
    },
  };
}

/** 主 provider 不可用时自动回退到 Mock，并保留错误码。 */
export function createFallbackTtsProvider({ primary, fallback, log = () => {} } = {}) {
  if (!primary || !fallback) throw new Error('createFallbackTtsProvider 需要 primary 与 fallback');
  return {
    name: `fallback:${primary.name}+${fallback.name}`,
    languages: [...new Set([...(primary.languages || []), ...(fallback.languages || [])])],
    degraded: false,
    voices: () => (typeof primary.voices === 'function' ? primary.voices() : []),
    async load() {
      const result = await primary.load?.();
      if (result && result.ok === false) {
        this.degraded = true;
        log('[live2d] tts fallback code=' + safeCode({ code: result.code }));
      }
      return result;
    },
    async synthesize(text, options, signal) {
      try {
        return await primary.synthesize(text, options, signal);
      } catch (error) {
        if (safeCode(error) === ABORTED) throw error;
        this.degraded = true;
        log('[live2d] tts fallback code=' + safeCode(error));
        return fallback.synthesize(text, options, signal);
      }
    },
    async unload() { await primary.unload?.(); },
  };
}

function clampSpeed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(2, Math.max(0.5, number));
}

export function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : 'TTS_FAILED';
}
