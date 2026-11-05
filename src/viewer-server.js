import { createServer } from 'node:http';
import { readFile, realpath, mkdir, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectModel } from './model.js';
import { authoredMotion } from './runtime/authored-motions.mjs';
import {createPreferences} from './preferences.js';
import {createActivity} from './activity.js';
import { sanitizeChatPreferences, validateChatMessage, CHAT_LIMITS } from './features/chat/config.mjs';
import { encodeSseFrame } from './features/chat/sse.mjs';
import { writeChatStream } from './features/chat/stream.mjs';
import { HOST_BRIDGE_FILE, readHostBridgeInfo } from './features/chat/host-bridge.mjs';

const require = createRequire(import.meta.url);
const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));

/**
 * 每个写入型接口各自的上限，不要一刀切：
 * - preferences 要装下最大合法互动配置（3 类 × 12 条 × 40 字中文 ≈ 4.5 KB，
 *   再叠加 JSON 结构、模型缩放与浮层坐标），取 16 KiB 留出约 3.6 倍余量；
 * - telemetry 与 bridge 只是状态心跳，保持 2 KiB 的紧边界。
 */
export const REQUEST_LIMITS = Object.freeze({ preferences: 16 * 1024, telemetry: 2048, bridge: 2048, chat: 8 * 1024 });
/** Follow 长连接：没有总时长上限，只有空闲阈值（Host 每 10 秒有 keepalive）。 */
const followIdleMs = () => (Number(process.env.DSH_LIVE2D_FOLLOW_IDLE_MS) > 0 ? Number(process.env.DSH_LIVE2D_FOLLOW_IDLE_MS) : 45000);

/** 对话相关上限按请求读取，测试可以在同一进程内用环境变量覆盖，生产默认不变。 */
function chatLimits() {
  const read = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    timeoutMs: read('DSH_LIVE2D_CHAT_TIMEOUT_MS', 30000),
    rateLimit: read('DSH_LIVE2D_CHAT_RATE_LIMIT', 6),
    rateWindowMs: read('DSH_LIVE2D_CHAT_RATE_WINDOW_MS', 60000),
    scenario: process.env.DSH_LIVE2D_CHAT_SCENARIO || 'ok',
  };
}

/** 读 JSON 请求体；超过 limit 后继续把剩余字节读掉（丢弃），再回 413。
 *  提前 return 而不排空会让客户端卡在“已发完、等响应”的半开状态，实测会挂死。
 *  丢弃也有硬上限：超过 4×limit 就停止读取，交给 413 的 Connection: close 结束连接。 */
async function readJsonBody(req, limit) {
  let size = 0;
  let tooLarge = false;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) {
      tooLarge = true;
      parts.length = 0;
      if (size > limit * 4) break;
      continue;
    }
    if (!tooLarge) parts.push(part);
  }
  if (tooLarge) return { tooLarge: true, size };
  try { return { value: JSON.parse(Buffer.concat(parts).toString('utf8')) }; }
  catch { return { invalid: true }; }
}

const mime = name => name.endsWith('.json') ? 'application/json; charset=utf-8' : name.endsWith('.png') ? 'image/png' : name.endsWith('.js') || name.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';

/** 读取 Host 写的桥接信息；文件缺失、格式不对或进程已退出都当作"Host 不在线"。 */
async function loadHostBridge(configDir) {
  if (!configDir) return null;
  try {
    const raw = await readFile(path.join(configDir, HOST_BRIDGE_FILE), 'utf8');
    const info = readHostBridgeInfo(raw);
    if (!info) return null;
    try { process.kill(info.pid, 0); } catch (error) { if (error?.code !== 'EPERM') return null; }
    return info;
  } catch { return null; }
}

/** 通用 Host 流式转发：成功返回 true（已写帧），失败返回 false（未写帧）。 */
async function proxyHostStream({ res, host, path, body, signal, timeoutMs, idleTimeoutMs }) {
  const controller = new AbortController();
  let timer = null;
  const arm = () => {
    if (!idleTimeoutMs) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  if (timeoutMs) timer = setTimeout(() => controller.abort(), timeoutMs);
  const link = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener('abort', link, { once: true }); }
  try {
    const response = await fetch(`${host.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      try { res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' }).end(text || JSON.stringify({ error: 'host-error' })); } catch { /* 已断开 */ }
      return true;
    }
    if (!response.body) return false;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    arm();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        if (!res.writableEnded) res.write(Buffer.from(value));
      }
    } catch { /* 上游中断交由 finally 结束 */ }
    try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
    return true;
  } catch { return false; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', link); }
}

/** 把渲染器的 /chat 转发到 Host 桥接；返回 false 表示"还没写出任何帧，可以降级"。 */
async function proxyHostChat({ res, host, text, mode, signal, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const link = () => controller.abort();
  if (signal) { if (signal.aborted) controller.abort(); else signal.addEventListener('abort', link, { once: true }); }
  try {
    const response = await fetch(`${host.url}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ text, mode }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return false;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(Buffer.from(value));
      }
    } catch {
      if (!signal?.aborted) {
        try { if (!res.writableEnded) res.write(encodeSseFrame({ event: 'error', data: { type: 'error', code: 'host-lost' } })); } catch { /* 已断开 */ }
      }
    }
    try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
    return true;
  } catch { return false; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', link); }
}
export async function startViewer(config) {
  const ownsActivity=!config.activity;if(ownsActivity)config.activity=createActivity();
  const token = randomBytes(24).toString('hex');
  const bridgeToken = config.bridgeFile ? randomBytes(24).toString('hex') : '';
  const preferences=await createPreferences(config.preferencesFile);
  const streams=new Set();let telemetry=null;let chatBusy=false;const chatHits=[];
  let state, failure;
  try {
    if (!config.modelFile) throw new Error(
      '缺少 Live2D 模型。\n\n' +
      '· 首次启动会自动下载（约 48 MB）；下载失败时可以手动取模型包：\n' +
      '  https://github.com/hjw200775-ops/dsh-live2d-pet-/releases\n' +
      '· 解压后应得到：~/.dsh/live2d/DeepSeek-chan/大肥鱼.model3.json',
    );
    if (!config.coreFile) throw new Error(
      '缺少 Live2D Cubism Core（live2dcubismcore.min.js）。\n\n' +
      '· Core 有独立授权、不随插件分发，需从官网下载（免费）：\n' +
      '  https://www.live2d.com/en/sdk/download/web/\n' +
      `· 下载后放到：${config.configDir || '~/.dsh/live2d'}/live2dcubismcore.min.js`,
    );
    if (!path.isAbsolute(config.modelFile) || !path.isAbsolute(config.coreFile)) throw new Error('modelFile 和 coreFile 必须使用绝对路径');
    state = await inspectModel(config.modelFile);
    config.coreFile = await realpath(config.coreFile);
  } catch (e) {
    // 文件在但读不了（被移走 / 权限）时也给人话，而不是裸 ENOENT。
    failure = e.code === 'ENOENT'
      ? `找不到文件：${e.path || e.message}\n\n请确认模型与 Core 都在 ~/.dsh/live2d 下，或修正 config.json 里的路径。`
      : e.message;
  }
  const staticFiles = new Map(['index.html', 'viewer.js', 'style.css', 'cubism-color.js'].map(n => [n, path.join(renderer, n)]));
  // 运行时模块整目录放行：以前是逐个 set，加了新模块忘了登记就会让整个渲染器 import 失败
  staticFiles.set('runtime/balance.mjs', fileURLToPath(new URL('./balance.mjs', import.meta.url)));
  {
    const runtimeDir = fileURLToPath(new URL('./runtime/', import.meta.url));
    for (const name of await readdir(runtimeDir)) {
      if (name.endsWith('.mjs')) staticFiles.set(`runtime/${name}`, path.join(runtimeDir, name));
    }
  }
  // 功能模块（src/features/**）整目录递归放行：新增文件/子目录不必再登记路由。
  {
    const featuresDir = fileURLToPath(new URL('./features/', import.meta.url));
    const walk = async (dir, prefix = '') => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
        else if (entry.name.endsWith('.mjs')) staticFiles.set(`features/${relative}`, path.join(dir, entry.name));
      }
    };
    await walk(featuresDir);
  }
  staticFiles.set('core.js', config.coreFile);
  staticFiles.set('pixi.js', path.resolve(path.dirname(require.resolve('pixi.js')), '../browser/pixi.min.js'));
  staticFiles.set('live2d.js', path.join(path.dirname(require.resolve('pixi-live2d-display')), 'cubism4.min.js'));
  let origin;
  const server = createServer(async (req, res) => {
    try {
      // The token grants access only to this model's reference allowlist, never arbitrary files.
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, origin);
      if (req.method === 'POST' && url.pathname === '/bridge') {
        if (!bridgeToken || req.headers.authorization !== `Bearer ${bridgeToken}`) { res.writeHead(403).end(); return; }
        const body = await readJsonBody(req, REQUEST_LIMITS.bridge);
        if (body.tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' }).end(JSON.stringify({ error: 'payload-too-large', limit: REQUEST_LIMITS.bridge })); return; }
        if (body.invalid) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid-json' })); return; }
        const input = body.value;
        if (!['idle', 'thinking', 'answering', 'error'].includes(input.mode)) { res.writeHead(400).end(); return; }
        config.activity?.ingest?.({ mode: input.mode, activeCount: input.activeCount, balance: input.balance });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ refresh: config.activity?.takeRefresh?.() === true }));
        return;
      }
      const base = `/${token}/`;
      if (!url.pathname.startsWith(base)) { res.writeHead(404).end(); return; }
      const key = decodeURIComponent(url.pathname.slice(base.length));
      if(req.method==='POST' && ['preferences.json','telemetry.json'].includes(key)) {
        if(req.headers.origin!==origin){res.writeHead(403).end();return;}
        const isPreferences=key==='preferences.json';
        const limit=isPreferences?REQUEST_LIMITS.preferences:REQUEST_LIMITS.telemetry;
        const body=await readJsonBody(req,limit);
        if(body.tooLarge){res.writeHead(413,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',Connection:'close'}).end(JSON.stringify({error:'payload-too-large',store:isPreferences?'preferences':'telemetry',limit}));return;}
        if(body.invalid){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'invalid-json',store:isPreferences?'preferences':'telemetry'}));return;}
        const input=body.value;
        if(isPreferences) await preferences.update(input);
        else telemetry={mode:['idle','thinking','answering','error'].includes(input.mode)?input.mode:'idle',frames:Number(input.frames)||0,zoom:Number(input.zoom)||1,x:Number(input.x)||0,y:Number(input.y)||0,expression:String(input.expression||'').slice(0,40),motion:String(input.motion||'').slice(0,40),at:Date.now()};
        res.writeHead(204).end();return;
      }
      // 清空 Pet 上下文：只转发给 Host 内存，不落盘。
      if (req.method === 'POST' && key === 'chat/context/clear') {
        if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        const host = await loadHostBridge(config.configDir);
        if (!host) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'host-unavailable' })); return; }
        try {
          const response = await fetch(`${host.url}/chat/context/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
            body: '{}',
            signal: AbortSignal.timeout(3000),
          });
          res.writeHead(response.status, { 'Cache-Control': 'no-store' }).end();
        } catch {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'host-unavailable' }));
        }
        return;
      }
      // Follow（只读陪伴）：会话列表与事件流都转发 Host；Host 不在线时明确降级。
      if (req.method === 'POST' && (key === 'follow/sessions' || key === 'follow')) {
        if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        if (config.mode === 'overlay') { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'overlay-unsupported' })); return; }
        const host = await loadHostBridge(config.configDir);
        if (!host) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'host-unavailable' })); return; }
        if (key === 'follow/sessions') {
          try {
            const response = await fetch(`${host.url}/follow/sessions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${host.token}` },
              body: '{}',
              signal: AbortSignal.timeout(5000),
            });
            const text = await response.text();
            res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(text);
          } catch {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'host-unavailable' }));
          }
          return;
        }
        const body = await readJsonBody(req, REQUEST_LIMITS.chat);
        if (body.tooLarge) { res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }).end(JSON.stringify({ error: 'payload-too-large' })); return; }
        if (body.invalid) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'invalid-json' })); return; }
        const controller = new AbortController();
        const onClose = () => { if (!controller.signal.aborted) controller.abort(); };
        req.on('close', onClose); res.on('close', onClose);
        try {
          // Follow 是长连接：没有总时长上限，只做空闲检测（Host 每 10s 有 keepalive）。
          const proxied = await proxyHostStream({ res, host, path: '/follow', body: JSON.stringify({ sessionId: body.value?.sessionId }), signal: controller.signal, idleTimeoutMs: followIdleMs() });
          if (!proxied) { res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: 'host-unavailable' })); }
        } finally {
          req.off('close', onClose); res.off('close', onClose);
          try { if (!res.writableEnded) res.end(); } catch { /* 已断开 */ }
        }
        return;
      }
      // 对话：POST + SSE。backend=simulated 走本地仿真；backend=host 先转发 Host 桥接，
      // 失败则降级为本地模拟并在 meta 帧里标记 degraded（不影响动画与互动）。
      if(req.method==='POST' && key==='chat') {
        if(req.headers.origin!==origin){res.writeHead(403).end();return;}
        const body=await readJsonBody(req,REQUEST_LIMITS.chat);
        if(body.tooLarge){res.writeHead(413,{'Content-Type':'application/json; charset=utf-8',Connection:'close'}).end(JSON.stringify({error:'payload-too-large',store:'chat',limit:REQUEST_LIMITS.chat}));return;}
        if(body.invalid){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'invalid-json'}));return;}
        const chat=sanitizeChatPreferences(preferences.get().chat);
        if(!chat.enabled){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'chat-disabled'}));return;}
        const message=validateChatMessage(body.value?.text);
        if(!message.ok){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:message.code,limit:CHAT_LIMITS.messageChars}));return;}
        if(chatBusy){res.writeHead(429,{'Content-Type':'application/json; charset=utf-8','Retry-After':'2'}).end(JSON.stringify({error:'chat-busy'}));return;}
        const limits=chatLimits();
        const now=Date.now();
        while(chatHits.length && now-chatHits[0]>limits.rateWindowMs) chatHits.shift();
        if(chatHits.length>=limits.rateLimit) {
          const retryAfter=Math.max(1,Math.ceil((limits.rateWindowMs-(now-chatHits[0]))/1000));
          res.writeHead(429,{'Content-Type':'application/json; charset=utf-8','Retry-After':String(retryAfter)}).end(JSON.stringify({error:'rate-limited',retryAfter,limit:limits.rateLimit,windowMs:limits.rateWindowMs}));
          return;
        }
        chatHits.push(now);
        chatBusy=true;
        const controller=new AbortController();
        const onClose=()=>{if(!controller.signal.aborted)controller.abort();};
        req.on('close',onClose);res.on('close',onClose);
        const overlay = config.mode === 'overlay';
        try {
          let proxied=false;
          // Overlay 没有可信实例身份，即使 Desktop 存档授权也一律模拟，绝不代理到 Host。
          if(chat.backend==='host' && !overlay){
            const host=await loadHostBridge(config.configDir);
            if(host) proxied=await proxyHostChat({res,host,text:message.text,mode:chat.mode,signal:controller.signal,timeoutMs:limits.timeoutMs});
          }
          if(!proxied){
            await writeChatStream({
              res,prompt:message.text,mode:chat.mode,signal:controller.signal,timeoutMs:limits.timeoutMs,
              backend:'simulated',model:'local-simulator',scenario:chat.backend==='host'?'ok':limits.scenario,
              degraded:chat.backend==='host',degradedReason:overlay?'overlay-simulated-only':'host-unavailable',
            });
          }
        } catch(error) {
          try{if(!res.writableEnded)res.write(encodeSseFrame({event:'error',data:{type:'error',code:error?.code||'upstream-error'}}));}catch{/* 已断开 */}
        } finally {
          chatBusy=false;
          req.off('close',onClose);res.off('close',onClose);
          try{if(!res.writableEnded)res.end();}catch{/* 已断开 */}
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      let bytes, type;
      if(key==='events' && config.activity && req.method==='GET') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
        streams.add(res);const send=s=>res.write(`data: ${JSON.stringify(s)}\n\n`);
        send(config.activity.snapshot());const unsubscribe=config.activity.subscribe(send);
        const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);
        res.on('close',()=>{clearInterval(heartbeat);unsubscribe();streams.delete(res);});return;
      } else if(key==='preferences.json') {
        bytes=JSON.stringify(preferences.get());type='application/json';
      } else if(key==='runtime.json') {
        bytes=JSON.stringify({activity:config.activity?.snapshot()||{mode:'idle'},history:config.activity?.history()||[],telemetry});type='application/json';
      } else if (key === 'status.json') {
        bytes = JSON.stringify({ ok: !failure, error: failure, ...state?.report }); type = 'application/json; charset=utf-8';
      } else if (key === 'model/model.model3.json' && state) {
        bytes = JSON.stringify(state.model); type = 'application/json; charset=utf-8';
      } else if (key.startsWith('model/generated/') && state) {
        const motion = authoredMotion(key.slice('model/generated/'.length));
        if (!motion) { res.writeHead(404).end(); return; }
        bytes = JSON.stringify(motion); type = 'application/json; charset=utf-8';
      } else {
        const file = key.startsWith('model/') ? state?.allowed.get(key.slice(6)) : staticFiles.get(key);
        if (!file) { res.writeHead(404).end(); return; }
        bytes = await readFile(file); type = mime(key);
      }
      res.setHeader('Content-Type', type);
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (e) { res.writeHead(e instanceof URIError ? 400 : 500).end('Local asset could not be loaded'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  if (config.bridgeFile && bridgeToken) {
    await mkdir(path.dirname(config.bridgeFile), { recursive: true });
    const temporary = `${config.bridgeFile}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify({ port: server.address().port, token: bridgeToken, pid: process.pid }), 'utf8');
    await rename(temporary, config.bridgeFile);
  }
  return { url: `${origin}/${token}/index.html`, report: state?.report, error: failure, close: async () => {for(const res of streams)res.end();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await preferences.flush();if(config.bridgeFile)await rm(config.bridgeFile,{force:true});if(ownsActivity)config.activity.dispose();} };
}
