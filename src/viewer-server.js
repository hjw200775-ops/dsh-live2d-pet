import { createServer } from 'node:http';
import { readFile, realpath, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inspectModel } from './model.js';
import { authoredMotion } from './runtime/authored-motions.mjs';
import {createPreferences} from './preferences.js';
import {createActivity} from './activity.js';

const require = createRequire(import.meta.url);
const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const mime = name => name.endsWith('.json') ? 'application/json; charset=utf-8' : name.endsWith('.png') ? 'image/png' : name.endsWith('.js') || name.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';

export async function startViewer(config) {
  const ownsActivity=!config.activity;if(ownsActivity)config.activity=createActivity();
  const token = randomBytes(24).toString('hex');
  const bridgeToken = config.bridgeFile ? randomBytes(24).toString('hex') : '';
  const preferences=await createPreferences(config.preferencesFile);
  const streams=new Set();let telemetry=null;
  let state, failure;
  try {
    if (!config.modelFile || !config.coreFile) throw new Error('未找到 modelFile / coreFile：请先运行 npx dsh-live2d-fetch-model（默认解压到 ~/.dsh/live2d），并把 live2dcubismcore.min.js 放到同一目录，然后重启 DSH');
    if (!path.isAbsolute(config.modelFile) || !path.isAbsolute(config.coreFile)) throw new Error('modelFile 和 coreFile 必须使用绝对路径');
    state = await inspectModel(config.modelFile);
    config.coreFile = await realpath(config.coreFile);
  } catch (e) { failure = e.message; }
  const staticFiles = new Map(['index.html', 'viewer.js', 'style.css', 'cubism-color.js'].map(n => [n, path.join(renderer, n)]));
  staticFiles.set('runtime/motion-policy.mjs', fileURLToPath(new URL('./runtime/motion-policy.mjs', import.meta.url)));
  staticFiles.set('runtime/model-hit.mjs', fileURLToPath(new URL('./runtime/model-hit.mjs', import.meta.url)));
  staticFiles.set('runtime/gesture.mjs', fileURLToPath(new URL('./runtime/gesture.mjs', import.meta.url)));
  staticFiles.set('runtime/balance.mjs', fileURLToPath(new URL('./balance.mjs', import.meta.url)));
  staticFiles.set('runtime/wardrobe.mjs', fileURLToPath(new URL('./runtime/wardrobe.mjs', import.meta.url)));
  staticFiles.set('runtime/frame-pace.mjs', fileURLToPath(new URL('./runtime/frame-pace.mjs', import.meta.url)));
  staticFiles.set('runtime/host-exit.mjs', fileURLToPath(new URL('./runtime/host-exit.mjs', import.meta.url)));
  staticFiles.set('runtime/click-motion.mjs', fileURLToPath(new URL('./runtime/click-motion.mjs', import.meta.url)));
  staticFiles.set('runtime/authored-motions.mjs', fileURLToPath(new URL('./runtime/authored-motions.mjs', import.meta.url)));
  staticFiles.set('runtime/fidget.mjs', fileURLToPath(new URL('./runtime/fidget.mjs', import.meta.url)));
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
        let size = 0; const parts = [];
        for await (const part of req) { size += part.length;         if (size > 2048) { res.writeHead(413).end(); return; } parts.push(part); }
        let input; try { input = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { res.writeHead(400).end(); return; }
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
        let size=0;const parts=[];
        for await (const part of req){size+=part.length;if(size>2048){res.writeHead(413).end();return;}parts.push(part);}
        let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{res.writeHead(400).end();return;}
        if(key==='preferences.json') await preferences.update(input);
        else telemetry={mode:['idle','thinking','answering','error'].includes(input.mode)?input.mode:'idle',frames:Number(input.frames)||0,zoom:Number(input.zoom)||1,x:Number(input.x)||0,y:Number(input.y)||0,expression:String(input.expression||'').slice(0,40),motion:String(input.motion||'').slice(0,40),at:Date.now()};
        res.writeHead(204).end();return;
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
