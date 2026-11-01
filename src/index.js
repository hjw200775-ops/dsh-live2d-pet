import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViewer } from './viewer-server.js';
import {createActivity} from './activity.js';
import { createBalance } from './balance.mjs';
import { startBridgePublisher } from './bridge.mjs';
import { createFileLogger } from './log-file.mjs';
import { launchDesktopPet, prepareAssets } from './provision.mjs';

export const name = 'deepseek-live2d';
export const inject = ['webServer', 'credentials'];

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

/**
 * 解析模型与 Core 的位置。
 *
 * 优先级：显式 config > DSH_LIVE2D_CONFIG 指向的配置文件 > 约定目录
 *   ~/.dsh/live2d/config.json
 *   ~/.dsh/live2d/deepseek-chan/大肥鱼.model3.json
 *   ~/.dsh/live2d/live2dcubismcore.min.js
 *
 * 这样用户按「装插件 → npx dsh-live2d-fetch-model → 放 Core」三步做完，
 * 再打开 DSH 就能直接看到桌宠，不必手写配置文件。
 */
export async function resolveModelConfig(config = {}, { env = process.env, home = homedir() } = {}) {
  const dir = path.join(home, '.dsh', 'live2d');
  const configFile = config.configFile || env.DSH_LIVE2D_CONFIG || path.join(dir, 'config.json');

  let local = {};
  try {
    local = JSON.parse(await readFile(configFile, 'utf8'));
  } catch (error) {
    // 配置文件不存在是正常的零配置路径；其它错误（坏 JSON、权限）要让人看见。
    if (error.code !== 'ENOENT') throw new Error(`无法读取 Live2D 配置 ${configFile}：${error.message}`);
  }

  const merged = { ...local, ...config };

  if (!merged.modelFile) {
    const candidates = [
      path.join(dir, 'deepseek-chan', '大肥鱼.model3.json'),
      // 下载脚本解压出来的是大写的 DeepSeek-chan，区分大小写的文件系统上必须单独列出。
      path.join(dir, 'DeepSeek-chan', '大肥鱼.model3.json'),
      path.join(dir, 'model', 'DeepSeek-chan', '大肥鱼.model3.json'),
    ];
    merged.modelFile = (await Promise.all(candidates.map(async p => ((await exists(p)) ? p : null)))).find(Boolean);
  }
  if (!merged.coreFile) {
    const core = path.join(dir, 'live2dcubismcore.min.js');
    if (await exists(core)) merged.coreFile = core;
  }
  return { configDir: dir, configFile, local: merged };
}

export async function apply(ctx, config = {}) {
  if (ctx.webServer.host && ctx.webServer.host !== '127.0.0.1') throw new Error('Live2D 私有模型仅支持监听 127.0.0.1 的 DSH 宿主');
  const pluginRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  // 宿主侧的日志也落盘：Electron 下载失败、模型下载失败都只发生在这里
  const log = createFileLogger({ name: 'host' }).log;
  let { configDir, configFile, local } = await resolveModelConfig(config);

  // 首次安装的机器上没有模型：这里自动补齐（Core 受授权限制，只能提示用户自己放）。
  // 已经装好的机器上这一步只是两次文件检查，不影响启动速度。
  const assets = await prepareAssets({ pluginRoot, configDir, local, config, log });
  if (assets.fetched) ({ configDir, configFile, local } = await resolveModelConfig(config));

  const activity=createActivity();
  const bridgeFile=local.bridgeFile || path.join(configDir,'desktop-bridge.json');
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
  const showOverlay=local.overlay!==false && config.overlay!==false;
  let viewer;
  if(showOverlay) viewer=await startViewer({ ...local, configDir, preferencesFile:local.preferencesFile || path.join(configDir,'preferences.json'), activity });
  else {
    // 桌面窗口模式：Electron 没装好时自动补装，装完再拉窗口。整个过程不阻塞 DSH 启动。
    void launchDesktopPet({ pluginRoot, configFile, log }).catch(error => log(`[live2d] 桌宠启动失败：${error?.message || error}`));
  }
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
