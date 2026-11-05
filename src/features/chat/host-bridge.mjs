import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHAT_LIMITS, validateChatMessage } from './config.mjs';
import { encodeSseFrame } from './sse.mjs';
import { safeCode, writeChatStream } from './stream.mjs';
import { streamHostChat } from './host-adapter.mjs';
import { authorizeFollow, authorizeRealChat } from './authorization.mjs';
import { createFollowDeduper, followFrameFromEvent, followStatusFrame } from './follow.mjs';
import { createPetConversation } from './conversation.mjs';
import { buildPetMessages } from './persona.mjs';

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
  authorize = null,
  restrictFile = null,
  sessionSource = null,
} = {}) {
  if (!configDir) throw new Error('startHostBridge 需要 configDir');
  const bridgeFile = path.join(configDir, HOST_BRIDGE_FILE);
  const hits = [];
  let busy = false;
  let closing = false;
  const active = new Set();
  const conversation = createPetConversation();
  let followBusy = false;
  const followControllers = new Set();
  let aclRestricted = true;
  let origin = '';

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || !['/chat', '/chat/context/clear', '/follow', '/follow/sessions'].includes(req.url)) { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      const requestOrigin = req.headers.origin;
      if (requestOrigin !== undefined && requestOrigin !== origin && requestOrigin !== `http://localhost:${server.address().port}`) {
        res.writeHead(403).end();
        return;
      }
      // 清空 Pet 上下文：只影响 Host 内存，不触及聊天正文或日志。
      if (req.url === '/chat/context/clear') {
        conversation.clear();
        res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        return;
      }

      // Follow 会话列表：只读、只走官方 sessionController.list()
      if (req.url === '/follow/sessions') {
        const sessions = sessionSource ? await sessionSource.list() : [];
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ sessions }));
        return;
      }
      const body = await readJsonBody(req, HOST_BRIDGE_LIMITS.bodyBytes);
      if (body.tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }).end(JSON.stringify({ error: 'payload-too-large', limit: HOST_BRIDGE_LIMITS.bodyBytes })); return; }
      if (body.invalid) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'invalid-json' })); return; }
      if (req.url === '/follow') {
        const sessionId = typeof body.value?.sessionId === 'string' ? body.value.sessionId.trim() : '';
        const allowed = await authorizeFollow({ configDir, sessionId });
        if (!allowed.ok) {
          res.writeHead(allowed.reason === 'session-mismatch' ? 403 : 409, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: allowed.reason }));
          return;
        }
        if (!sessionSource) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'session-source-unavailable' })); return; }
        if (followBusy) { res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '2' }).end(JSON.stringify({ error: 'follow-busy' })); return; }
        followBusy = true;
        const controller = new AbortController();
        followControllers.add(controller);
        const dedupe = createFollowDeduper();
        let unsubscribe = () => {};
        try {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.flushHeaders?.();
          const onClose = () => { if (!controller.signal.aborted) controller.abort(); };
          req.on('close', onClose);
          res.on('close', onClose);
          const heartbeat = setInterval(() => { try { if (!res.writableEnded) res.write(': keepalive\n\n'); } catch { /* 已断开 */ } }, 10000);
          const send = frame => { try { if (!res.writableEnded) res.write(encodeSseFrame({ event: frame.type, data: frame })); } catch { /* 已断开 */ } };
          send({ type: 'follow-ready', sessionId });
          unsubscribe = sessionSource.subscribe(({ session, event, status }) => {
            if (controller.signal.aborted) return;
            if (status) {
              if (status.sessionId !== sessionId) return;
              const frame = followStatusFrame(status.sessionId, status.running);
              if (frame) send(frame);
              return;
            }
            if (!session || session.id !== sessionId) return;
            const frame = followFrameFromEvent(session, event);
            if (!frame || !dedupe.accept(frame.seq)) return;
            send(frame);
          });
          await new Promise(resolve => {
            if (controller.signal.aborted) return resolve();
            controller.signal.addEventListener('abort', resolve, { once: true });
          });
          clearInterval(heartbeat);
          req.off('close', onClose);
          res.off('close', onClose);
        } finally {
          unsubscribe();
          followBusy = false;
          followControllers.delete(controller);
          try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
        }
        return;
      }
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
      const controller = new AbortController();
      active.add(controller);
      const onClose = () => { if (!controller.signal.aborted) controller.abort(); };
      try {
        req.on('close', onClose);
        res.on('close', onClose);

        // 授权只看 Desktop 存档与 Host 环境，不看请求正文；任何异常都在 finally 释放 busy。
        const auth = await (authorize || authorizeRealChat)({ configDir, llm, agentDefaultModel, aclRestricted });
        const mode = auth.chat.mode;
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders?.();
        if (auth.ok) {
          const model = auth.model;
          log('[live2d] host chat backend=host-llm source=' + (model?.source || 'unknown'));
          const built = buildPetMessages({
            persona: auth.chat.persona,
            history: conversation.history('host-llm'),
            userText: message.text,
            historyTurns: auth.chat.historyTurns,
          });
          const turn = conversation.begin(message.text, 'host-llm');
          let assistantText = '';
          let outcome = 'error';
          try {
            outcome = (await writeChatStream({
              res, prompt: message.text, mode, signal: controller.signal, timeoutMs, scenario,
              backend: 'host-llm', model: `${model.provider}/${model.model}`,
              produce: ({ signal }) => (async function* () {
                for await (const chunk of streamHostChat({
                  llm, provider: model.provider, model: model.model, signal,
                  messages: built.messages, system: built.system,
                })) {
                  if (chunk.kind === 'delta' && chunk.text) assistantText += chunk.text;
                  yield chunk;
                }
              })(),
            })).outcome;
          } finally {
            // 只有成功完成才提交；取消、超时、错误、空流都不入历史。
            if (outcome === 'ok' && assistantText.trim()) conversation.commit(turn, assistantText);
            else conversation.abort(turn);
          }
        } else {
          log('[live2d] host chat backend=simulated reason=' + (auth.reasons[0] || 'none'));
          await writeChatStream({ res, prompt: message.text, mode, signal: controller.signal, timeoutMs, scenario, backend: 'simulated', model: 'local-simulator' });
        }
      } catch (error) {
        // 内层先给出 500，避免 finally 用默认 200 结束空响应；错误码白名单归一。
        try { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'bridge-error' })); } catch { /* 已断开 */ }
        log('[live2d] host chat error code=' + safeCode(error));
      } finally {
        busy = false;
        active.delete(controller);
        req.off('close', onClose);
        res.off('close', onClose);
        try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
      }
      return;
    } catch (error) {
      try { if (!res.writableEnded) res.writeHead(500).end(); } catch { /* 已断开 */ }
      log('[live2d] host chat error code=' + safeCode(error));
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
  // 先在临时文件上收紧 ACL，再 rename：避免令牌在权限未知的窗口里可见。
  try {
    aclRestricted = (await (restrictFile || restrictToCurrentUser)(temporary, log)) !== false;
  } catch { aclRestricted = false; }
  if (!aclRestricted) log('[live2d] host bridge acl=unavailable');
  await rename(temporary, bridgeFile);

  return {
    info,
    url: `http://127.0.0.1:${port}`,
    bridgeFile,
    async close() {
      if (closing) return;
      closing = true;
      hits.length = 0;
      for (const controller of active) { try { controller.abort(); } catch { /* 忽略 */ } }
      active.clear();
      for (const controller of followControllers) { try { controller.abort(); } catch { /* 忽略 */ } }
      followControllers.clear();
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });
      await rm(bridgeFile, { force: true }).catch(() => {});
    },
  };
}

/** Windows 上把桥接文件收紧到当前用户；失败返回 false，调用方据此禁止真实后端。 */
async function restrictToCurrentUser(file, log) {
  if (process.platform !== 'win32') {
    try { await chmod(file, 0o600); return true; } catch { return false; }
  }
  const user = process.env.USERNAME;
  if (!user) { log('[live2d] host bridge acl=best-effort'); return false; }
  return new Promise(resolve => {
    execFile('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], { windowsHide: true }, error => {
      log(error ? '[live2d] host bridge acl=best-effort' : '[live2d] host bridge acl=restricted');
      resolve(!error);
    });
  });
}