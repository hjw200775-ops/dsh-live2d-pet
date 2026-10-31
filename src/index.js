import { readFile } from 'node:fs/promises';
import { startViewer } from './viewer-server.js';
import path from 'node:path';
import {createActivity} from './activity.js';
import {createBalance} from './balance.mjs';
import {startBridgePublisher} from './bridge.mjs';

export const name = 'deepseek-live2d';
export const inject = ['webServer', 'credentials'];

export async function apply(ctx, config = {}) {
  if (ctx.webServer.host && ctx.webServer.host !== '127.0.0.1') throw new Error('Live2D 私有模型仅支持监听 127.0.0.1 的 DSH 宿主');
  const configFile = config.configFile || process.env.DSH_LIVE2D_CONFIG;
  const local = configFile ? JSON.parse(await readFile(configFile, 'utf8')) : {};
  const activity=createActivity();
  const bridgeFile=local.bridgeFile || (configFile ? path.join(path.dirname(configFile),'desktop-bridge.json') : undefined);
  const balance=createBalance({
    lowBalance:Number(config.lowBalance??local.lowBalance??1)||1,
    resolveKey:async()=>{
      if(!ctx.credentials||typeof ctx.credentials.resolve!=='function')return null;
      return ctx.credentials.resolve(config.credential||local.credential||'DEEPSEEK_API_KEY');
    },
  });
  const balanceTimer=setInterval(()=>{void balance.refresh(false);},60000);
  void balance.refresh(false);
  const stopBridge=bridgeFile?startBridgePublisher({activity,bridgeFile,balance}):()=>{};
  const showOverlay=config.overlay!==false && local.overlay!==false;
  let viewer;
  if(showOverlay) viewer=await startViewer({ ...local, ...config, preferencesFile:local.preferencesFile || (configFile ? path.join(path.dirname(configFile),'preferences.json') : undefined), activity });
  const unsubs=['agent/status','agent/assistant-stream','agent/error'].map(event=>ctx.on(event,p=>activity.receive(event,p)));
  let unregister;
  try {
    unregister = ctx.webServer.register({ kind: 'exact', path: '/deepseek-live2d/bootstrap', handler(req, res) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      const payload=showOverlay?{ url: viewer.url, error: viewer.error, report: viewer.report, overlay:true }:{ overlay:false };
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload));
    } });
  } catch (e) { unsubs.forEach(fn=>fn());stopBridge();activity.dispose();if(viewer)await viewer.close(); throw e; }
  ctx.effect(() => () => { clearInterval(balanceTimer);unregister();unsubs.forEach(fn=>fn());stopBridge();activity.dispose();return viewer?.close(); });
}
