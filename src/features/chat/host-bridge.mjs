import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHAT_LIMITS, validateChatMessage } from './config.mjs';
import { writeChatStream } from './stream.mjs';
import { realChatEnabled, resolveHostModel, streamHostChat } from './host-adapter.mjs';

export const HOST_BRIDGE_FILE = 'host-bridge.json';
export const HOST_BRIDGE_PROTOCOL = 'dsh-live2d-host-bridge/1';
export const HOST_BRIDGE_VERSION = 1;
export const HOST_BRIDGE_LIMITS = Object.freeze({ bodyBytes: 8 * 1024 });

/** 读取并校验 Host 写的桥接文件；任何不合法都返回 null，调用方按"Host 不在线"处理。 */
export function readHostBridgeInfo(raw) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  if (value.version !== HOST_BRIDGE_VERSION || value.protocol !== HOST_BRIDGE_PROTOCOL) return null;
  if (value.host !== '127.0.0.1') return null;
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) return null;
  if (typeof value.token !== 'string' || value.token.length < 32) return null;
  if (!Number.isInteger(value.pid) || value.pid <= 0) return null;
  return { ...value, url: `http://127.0.0.1:${value.port}` };
}

async function readJsonBody(req, limit) {
  let size = 0;
  let tooLarge = false;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) { tooLarge = true; parts.length = 0; if (size > limit * 4) break; continue; }
    if (!tooLarge) parts.push(part);
  }
  if (tooLarge) return { tooLarge: true };
  try { return { value: JSON.parse(Buffer.concat(parts).toString('utf8')) }; } catch { return { invalid: true }; }
}

/**
 * 在 Host 进程内起一条只监听 127.0.0.1 的聊天桥接。
 * 认证用每次启动都重新生成的随机令牌；文件里只放本机回环地址与令牌，不含任何 API Key。
 */
export async function startHostBridge({
  configDir,
  token = randomBytes(32).toString('hex'),
  llm,
  agentDefaultModel,
  log = () => {},
  timeoutMs = 30000,
  scenario = 'ok',
  rateLimit = 6,
  rateWindowMs = 60000,
  now = () => Date.now(),
} = {}) {
  if (!configDir) throw new Error('startHostBridge 需要 configDir');
  const bridgeFile = path.join(configDir, HOST_BRIDGE_FILE);
  const hits = [];
  let busy = false;
  let closing = false;
  let origin = '';

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/chat') { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const requestOrigin = req.headers.origin;
      if (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== `http://localhost:${server.address().port}`) {
        res.writeHead(403).end();
        return;
      }
      const body = await readJsonBody(req, HOST_BRIDGE_LIMITS.bodyBytes);
      if (body.tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }).end(JSON.stringify({ error: 'payload-too-large', limit: HOST_BRIDGE_LIMITS.bodyBytes })); return; }
      if (body.invalid) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'invalid-json' })); return; }
      const message = validateChatMessage(body.value?.text);
      if (!message.ok) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: message.code, limit: CHAT_LIMITS.messageChars })); return; }
      if (busy) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '2' }).end(JSON.stringify({ error: 'chat-busy' })); return; }

      const at = now();
      while (hits.length && at - hits[0] > rateWindowMs) hits.shift();
      if (hits.length >= rateLimit) {
        const retryAfter = Math.max(1, Math.ceil((rateWindowMs - (at - hits[0])) / 1000));
        res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(retryAfter) }).end(JSON.stringify({ error: 'rate-limited', retryAfter, limit: rateLimit, windowMs: rateWindowMs }));
        return;
      }
      hits.push(at);
      busy = true;

      const mode = body.value?.mode === 'follow' ? 'follow' : 'pet';
      const controller = new AbortController();
      const onClose = () => { if (!controller.signal.aborted) controller.abort(); };
      req.on('close', onClose);
      res.on('close', onClose);

      try {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders?.();
        const real = realChatEnabled({ chat: { backend: 'host' } });
        const model = real.ok ? await resolveHostModel({ llm, agentDefaultModel }) : null;
        if (real.ok && model && typeof llm?.stream === 'function') {
          log('[live2d] host chat backend=host-llm');
          await writeChatStream({
            res, prompt: message.text, mode, signal: controller.signal, timeoutMs, scenario,
            backend: 'host-llm', model: `${model.provider}/${model.model}`,
            produce: ({ signal }) => streamHostChat({
              llm, provider: model.provider, model: model.model, signal,
              messages: [{ role: 'user', content: [{ type: 'text', text: message.text }] }],
            }),
          });
        } else {
          await writeChatStream({ res, prompt: message.text, mode, signal: controller.signal, timeoutMs, scenario, backend: 'simulated', model: 'local-simulator' });
        }
      } finally {
        busy = false;
        req.off('close', onClose);
        res.off('close', onClose);
      }
    } catch (error) {
      try { if (!res.writableEnded) res.writeHead(500).end(); } catch { /* 已断开 */ }
      log(`[live2d] host chat error: ${error?.message || error}`);
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;

  const info = {
    version: HOST_BRIDGE_VERSION,
    protocol: HOST_BRIDGE_PROTOCOL,
    host: '127.0.0.1',
    port,
    token,
    pid: process.pid,
    startedAt: Date.now(),
    capabilities: { chat: ['simulated'], backend: 'simulated' },
  };
  await mkdir(configDir, { recursive: true });
  const temporary = `${bridgeFile}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(info, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, bridgeFile);

  return {
    info,
    url: `http://127.0.0.1:${port}`,
    bridgeFile,
    async close() {
      if (closing) return;
      closing = true;
      hits.length = 0;
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
      await rm(bridgeFile, { force: true }).catch(() => {});
    },
  };
}
