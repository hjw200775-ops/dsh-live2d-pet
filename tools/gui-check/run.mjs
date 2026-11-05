#!/usr/bin/env node
/**
 * 隔离 GUI 验收脚本（Windows / Electron）。
 *
 * 目的：在**不碰正在运行的 DSH** 的前提下，用一份独立配置和独立 userData 启动桌宠窗口，
 * 通过 CDP 操作真实页面，验证互动设置、方案 C 双击折叠、中文气泡持久化与保存失败提示。
 *
 * 约定：
 * - 模型与 Cubism Core 只从用户提供的路径**只读**引用，绝不复制进仓库；
 * - 所有产物（config.json、userData、日志、截图、报告）都写在 --workdir，默认在系统临时目录；
 * - 调试端口只绑 127.0.0.1，且只在本次运行期间开启；
 * - 只用自己记录的 PID 结束进程（taskkill /PID <pid> /T），从不按进程名批量终止；
 * - 无论成功、失败还是 Ctrl+C，都会关闭窗口并等待端口释放。
 *
 * 用法见同目录 README.md。
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { startHostBridge } from '../../src/features/chat/host-bridge.mjs';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const IS_WIN = process.platform === 'win32';

function parseArgs(argv) {
  const args = { keep: false, timeoutMs: 240000 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--model' || key === '--core' || key === '--electron' || key === '--workdir' || key === '--port' || key === '--timeout') {
      const name = key === '--timeout' ? 'timeoutMs' : key.slice(2);
      args[name] = value;
      i++;
    }
    else if (key === '--keep') args.keep = true;
    else if (key === '--help' || key === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`用法：
  node tools/gui-check/run.mjs --model <大肥鱼.model3.json> --core <live2dcubismcore.min.js> [选项]

选项：
  --electron <electron.exe>  Electron 可执行文件（默认自动在 ~/.dsh/live2d/electron/*/ 下查找）
  --workdir <目录>           隔离工作目录（默认 %TEMP%\\dsh-live2d-gui-check）
  --port <端口>              CDP 端口（默认自动挑一个空闲端口，只绑 127.0.0.1）
  --timeout <毫秒>           整体超时（默认 240000）
  --keep                     保留工作目录（默认保留；加 --keep 仅用于显式声明，便于阅读）
  --help                     显示本帮助`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function discoverElectron(explicit) {
  if (explicit) return explicit;
  if (process.env.DSH_LIVE2D_ELECTRON) return process.env.DSH_LIVE2D_ELECTRON;
  const base = path.join(os.homedir(), '.dsh', 'live2d', 'electron');
  try {
    for (const dir of await readdir(base)) {
      const candidate = path.join(base, dir, 'electron.exe');
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* 没有下载过 Electron 时走下面的报错 */ }
  throw new Error(`找不到 Electron。请用 --electron 指定 electron.exe，或让插件先下载到 ${base}`);
}

function assertFile(file, label) {
  if (!file) throw new Error(`缺少 ${label}`);
  if (!existsSync(file)) throw new Error(`${label} 不存在：${file}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${new Date().toISOString().slice(11, 19)} ${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (IS_WIN) execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch { /* 进程可能已经退出 */ }
}

async function portClosed(port, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const open = await new Promise(resolve => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (!open) return true;
    await sleep(300);
  }
  return false;
}

function connectCdp(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, ready, send };
}

async function waitTarget(port, timeoutMs, shouldStop = () => false) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && !shouldStop()) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
      const page = list.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('等待 CDP 目标超时（窗口未起来或调试端口未就绪）');
}

async function launch(args, env) {
  return spawn(args.electron, ['desktop/main.mjs', `--remote-debugging-port=${args.port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'ignore',
  });
}

async function runChecks(cdp, args, workdir, stop = () => false) {
  const { ws, ready, send } = cdp;
  await ready;
  await send('Runtime.enable');
  const prefsFile = path.join(workdir, 'preferences.desktop.json');
  const raw = async file => JSON.parse(await readFile(file, 'utf8'));
  const evaluate = async expression => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || '页面求值失败');
    return res.result.value;
  };

  for (let i = 0; i < 100; i++) {
    if (stop()) return { beforeRestart: null, zh: '' };
    if (await evaluate('!!window.__dshDesktopReady && !!window.__dshInteraction').catch(() => false)) break;
    await sleep(400);
  }
  const boot = await evaluate('({ready:!!window.__dshDesktopReady, hook:typeof window.__dshInteraction})');
  check('隔离窗口加载并暴露调试钩子', boot.ready === true && boot.hook === 'function', JSON.stringify(boot));

  // 存档隔离 + 迁移：旧 preferences.json 只读复制成 preferences.desktop.json，旧文件不被改写或删除
  const migrated = await raw(prefsFile).catch(() => null);
  const legacyAfter = await raw(path.join(workdir, 'preferences.json')).catch(() => null);
  check('desktop 存档迁移到位且旧文件保持原样',
    migrated?.model?.zoom === 1.25 && migrated?.chat?.enabled === true && legacyAfter?.version === 1 && legacyAfter?.model?.zoom === 1.25 && Object.keys(legacyAfter).length === 3,
    JSON.stringify({ migrated: migrated?.model, legacy: legacyAfter }));

  const panel = await evaluate(`(()=>{
    const ids=['interaction-head','interaction-body','interaction-double','interaction-cooldown','interaction-bubble-head','interaction-bubble-body','interaction-bubble-double','interaction-reset'];
    return { inputs:document.querySelectorAll('#interaction input').length, has:ids.every(id=>!!document.getElementById(id)),
      defaults:{head:document.getElementById('interaction-head').checked,body:document.getElementById('interaction-body').checked,double:document.getElementById('interaction-double').checked,cooldown:document.getElementById('interaction-cooldown').value} };
  })()`);
  check('互动设置区存在且控件齐全', panel.has && panel.inputs >= 7, JSON.stringify(panel));

  // 模型纹理加载完成前命中缓存是空的：轮询等待，避免误报失败。
  const probe = () => evaluate(`(()=>{const w=innerWidth,h=innerHeight;const pick=(ratio)=>{for(let y=Math.round(h*ratio);y<h;y+=8)for(let x=Math.round(w*0.2);x<w*0.8;x+=8)if(window.__dshHit(x,y))return {x,y};return null;};
    return {head:pick(0.18),body:pick(0.62)};})()`);
  let points = null;
  for (let i = 0; i < 40; i++) {
    points = await probe().catch(() => null);
    if (points?.head && points?.body) break;
    await sleep(250);
  }
  check('找到头部与身体命中点', !!points?.head && !!points?.body, JSON.stringify(points));

  const click = async (point, times = 1, gap = 120) => {
    await evaluate(`(()=>{window.__bubbleHits=0;const b=document.getElementById('bubble');window.__bubbleObs?.disconnect();window.__bubbleObs=new MutationObserver(()=>{window.__bubbleHits++;});window.__bubbleObs.observe(b,{childList:true,characterData:true,attributes:true,subtree:true});})()`);
    for (let i = 0; i < times; i++) {
      await evaluate(`(()=>{const o={clientX:${point.x},clientY:${point.y},button:0,bubbles:true};window.dispatchEvent(new MouseEvent('mousedown',o));window.dispatchEvent(new MouseEvent('mouseup',o));return true;})()`);
      if (i < times - 1) await sleep(gap);
    }
    await sleep(700);
    return evaluate(`({hits:window.__bubbleHits,text:document.getElementById('bubble').hidden?'':document.getElementById('bubble').textContent})`);
  };
  const setToggle = (id, checked) => evaluate(`(()=>{const c=document.getElementById('${id}');c.checked=${checked};c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);

  check('默认：点头部有反馈（气泡出现）', !!(await click(points.head)).text);
  await setToggle('interaction-head', false); await sleep(200);
  check('关闭头部反馈后点头部无反应', !(await click(points.head)).text);
  await setToggle('interaction-head', true); await sleep(1500);

  await setToggle('interaction-double', false); await sleep(200);
  const folded = await click(points.head, 2, 120);
  check('方案 C：双击关闭时两次快速点击只反馈一次', !!folded.text && folded.hits <= 3, JSON.stringify(folded));

  await setToggle('interaction-double', true); await sleep(1500);
  const doubleOn = await click(points.head, 2, 120);
  check('双击开启时仍是双击气泡', doubleOn.text === '嘿嘿！', JSON.stringify(doubleOn));

  const zh = '喵喵喵，在的哦';
  await evaluate(`(()=>{const i=document.getElementById('interaction-bubble-head');i.value=${JSON.stringify(zh)};i.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(1200);
  const prefs = await raw(prefsFile);
  check('中文气泡写入 preferences.desktop.json', JSON.stringify(prefs.interaction?.bubbles?.head) === JSON.stringify(['喵喵喵', '在的哦']), JSON.stringify(prefs.interaction?.bubbles?.head));
  const saved = await evaluate(`({text:document.getElementById('save-state').textContent,err:document.getElementById('save-state').classList.contains('error'),hidden:document.getElementById('save-state').hidden})`);
  check('保存成功提示出现', saved.text.includes('已保存'), JSON.stringify(saved));

  // 模拟 413：只改页面里的 fetch，服务端仍是真的
  await evaluate(`(()=>{window.__realFetch=window.fetch;window.fetch=(url,opt)=>{if(String(url).includes('preferences.json')&&opt&&opt.method==='POST')return Promise.resolve(new Response(JSON.stringify({error:'payload-too-large',store:'preferences',limit:16384}),{status:413,headers:{'Content-Type':'application/json'}}));return window.__realFetch(url,opt);};return true;})()`);
  await setToggle('interaction-body', false); await sleep(600);
  const failed = await evaluate(`({text:document.getElementById('save-state').textContent,err:document.getElementById('save-state').classList.contains('error'),hidden:document.getElementById('save-state').hidden})`);
  check('413 时显示未保存提示且标红', !failed.hidden && failed.err && failed.text.includes('未保存'), JSON.stringify(failed));
  const diskAfterFail = await raw(prefsFile);
  check('保存失败时磁盘未被改写', diskAfterFail.interaction?.enabled?.body === true, JSON.stringify(diskAfterFail.interaction?.enabled));

  await evaluate(`(()=>{window.fetch=window.__realFetch;const c=document.getElementById('interaction-body');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(1200);
  // ---- 角色人格与上下文 ----
  const personaBoot = await evaluate(`({ hasPersona:!!document.getElementById('chat-persona'), maxLength:document.getElementById('chat-persona')?.maxLength, hasClear:!!document.getElementById('chat-clear'), clearDisabled:document.getElementById('chat-clear')?.disabled })`);
  check('角色描述与清空上下文控件存在', personaBoot.hasPersona === true && personaBoot.maxLength === 200 && personaBoot.hasClear === true, JSON.stringify(personaBoot));

  await evaluate(`(()=>{const i=document.getElementById('chat-persona');i.value='温和一点，回答简短';i.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(800);
  const personaDisk = JSON.parse(await readFile(path.join(workdir, 'preferences.desktop.json'), 'utf8'));
  check('角色描述写入存档', personaDisk.chat?.persona === '温和一点，回答简短', JSON.stringify(personaDisk.chat?.persona));

  // ---- 跟随开发会话（只读）----
  const followBoot = await evaluate(`({ enabled:document.getElementById('follow-enabled').checked, hasSelect:!!document.getElementById('follow-session'), state:document.getElementById('follow-state').textContent })`);
  check('跟随控件存在且默认关闭', followBoot.enabled === false && followBoot.hasSelect === true && followBoot.state.includes('未启用'), JSON.stringify(followBoot));

  await evaluate(`(()=>{const c=document.getElementById('follow-enabled');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  let followDegraded = null;
  for (let i = 0; i < 20; i++) {
    followDegraded = await evaluate(`document.getElementById('follow-state').textContent`);
    if (followDegraded.includes('Host 不可用')) break;
    await sleep(250);
  }
  check('无 DSH Host 时跟随明确降级且不报错', followDegraded?.includes('Host 不可用') === true, String(followDegraded));
  await evaluate(`(()=>{const c=document.getElementById('follow-enabled');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);

  // ---- 对话（模拟）----
  const chatBoot = await evaluate(`({ send:!!document.getElementById('chat-send'), enabled:document.getElementById('chat-enabled').checked, mode:document.getElementById('chat-mode').value })`);
  check('对话（模拟）控件存在且按配置启用', chatBoot.send === true && chatBoot.enabled === true && chatBoot.mode === 'pet', JSON.stringify(chatBoot));

  await evaluate(`(()=>{const i=document.getElementById('chat-input');i.value='你好呀，能听见吗';document.getElementById('chat-send').click();return true;})()`);
  let chatDone = null;
  for (let i = 0; i < 60; i++) {
    chatDone = await evaluate(`({bubble:document.getElementById('bubble').textContent,state:document.getElementById('chat-state').textContent})`);
    if (chatDone.state.includes('回复完成')) break;
    await sleep(300);
  }
  check('模拟对话：气泡出现【模拟】回复且明确标注', chatDone?.bubble?.includes('【模拟】') === true && chatDone.bubble.includes('你好呀'), JSON.stringify(chatDone));
  check('模拟对话：结束后状态为「回复完成（模拟）」', chatDone?.state?.includes('回复完成') === true, JSON.stringify(chatDone?.state));

  await evaluate(`(()=>{const i=document.getElementById('chat-input');i.value='长'.repeat(400);document.getElementById('chat-send').click();return true;})()`);
  await sleep(250);
  await evaluate(`(()=>{document.getElementById('chat-stop').click();return true;})()`);
  let stopped = null;
  for (let i = 0; i < 30; i++) {
    stopped = await evaluate(`document.getElementById('chat-state').textContent`);
    if (stopped.includes('已停止')) break;
    await sleep(200);
  }
  check('模拟对话：停止按钮能中断生成', stopped?.includes('已停止') === true, String(stopped));

  await evaluate(`(()=>{const c=document.getElementById('chat-enabled');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(300);
  const chatOff = await evaluate(`({disabled:document.getElementById('chat-input').disabled,state:document.getElementById('chat-state').textContent})`);
  check('关闭对话后输入被禁用并提示未启用', chatOff.disabled === true && chatOff.state.includes('未启用'), JSON.stringify(chatOff));
  await evaluate(`(()=>{const c=document.getElementById('chat-enabled');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(300);
  // ---- Fake Host LLM：真实后端端到端 ----
  let hostBridge = null;
  let hostCalls = 0;
  process.env.DSH_LIVE2D_CHAT_REAL = '1';
  hostBridge = await startHostBridge({
    configDir: workdir,
    llm: {
      stream: () => {
        hostCalls++;
        return (async function* () {
          yield { type: 'text-delta', text: '这是假 Host 模型的回复' };
          yield { type: 'finish', reason: { kind: 'ok' } };
        })();
      },
    },
    agentDefaultModel: { get: () => ({ provider: 'fake-provider', model: 'fake-model' }) },
  });
  try {
    await evaluate(`(()=>{const b=document.getElementById('chat-backend');b.value='host';b.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await evaluate(`(()=>{const c=document.getElementById('chat-consent');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await sleep(900);

    await evaluate(`(()=>{const i=document.getElementById('chat-input');i.value='走真实后端';document.getElementById('chat-send').click();return true;})()`);
    let realState = null;
    for (let i = 0; i < 60; i++) {
      realState = await evaluate(`({bubble:document.getElementById('bubble').textContent,state:document.getElementById('chat-state').textContent,err:document.getElementById('chat-state').classList.contains('error')})`);
      if (realState.state.includes('回复完成') || realState.err) break;
      await sleep(250);
    }
    check('Fake Host LLM：真实后端成功回复且不再误判', hostCalls === 1 && realState?.bubble?.includes('这是假 Host 模型的回复') === true && realState.state.includes('DSH 模型') && realState.err === false, JSON.stringify({ hostCalls, realState }));

    await evaluate(`(()=>{const c=document.getElementById('chat-consent');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
    await sleep(500);
    const callsBefore = hostCalls;
    await evaluate(`(()=>{const i=document.getElementById('chat-input');i.value='取消许可后还能发吗';document.getElementById('chat-send').click();return true;})()`);
    await sleep(600);
    const blocked = await evaluate(`({state:document.getElementById('chat-state').textContent,err:document.getElementById('chat-state').classList.contains('error')})`);
    check('取消真实许可后立即阻止新的真实请求', hostCalls === callsBefore && blocked.state.includes('许可未开启'), JSON.stringify({ hostCalls, blocked }));
  } finally {
    delete process.env.DSH_LIVE2D_CHAT_REAL;
    await hostBridge.close();
  }

  const beforeRestart = await evaluate('window.__dshInteraction()');
  ws.close();
  return { beforeRestart, zh };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }
  try {
    assertFile(args.model, '--model 指向的模型文件');
    assertFile(args.core, '--core 指向的 Cubism Core');
    args.electron = await discoverElectron(args.electron);
    assertFile(args.electron, 'Electron 可执行文件');
  } catch (error) {
    console.error(`[gui-check] ${error.message}`);
    usage();
    process.exitCode = 2;
    return;
  }

  args.port = Number(args.port || await freePort());
  // 每次运行一个全新的子目录：既保证迁移/首次启动路径可复现，也不会删用户已有的目录。
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workdir = args.workdir
    ? path.join(args.workdir, `run-${stamp}`)
    : path.join(os.tmpdir(), `dsh-live2d-gui-check-${stamp}`);
  await mkdir(workdir, { recursive: true });
  // 桌面模式存档按新约定是 preferences.desktop.json；先放一份旧 preferences.json 验证迁移。
  const prefsFile = path.join(workdir, 'preferences.desktop.json');
  const legacyPrefsFile = path.join(workdir, 'preferences.json');
  const legacyValue = { version: 1, model: { zoom: 1.25, x: 0, y: 0 }, chat: { enabled: true, mode: 'pet' } };
  await writeFile(legacyPrefsFile, JSON.stringify(legacyValue, null, 2), 'utf8');
  const configFile = path.join(workdir, 'config.json');
  await writeFile(configFile, JSON.stringify({ modelFile: args.model, coreFile: args.core, autoFetchModel: false, overlay: false }, null, 2), 'utf8');

  const env = {
    ...process.env,
    DSH_LIVE2D_CONFIG: configFile,
    DSH_DESKTOP_USER_DATA: path.join(workdir, 'userdata'),
    DSH_DESKTOP_LOG: path.join(workdir, 'desktop.log'),
  };
  delete env.ELECTRON_RUN_AS_NODE; // 否则 electron.exe 会退化成普通 Node，import 'electron' 直接崩

  let child;
  let cdp;
  const ports = [args.port];
  let timedOut = false;
  const state = { stop: false };

  function cleanup() {
    killTree(child?.pid);
    try { cdp?.ws?.close(); } catch { /* ignore */ }
  }

  async function scenario() {
    child = await launch(args, env);
    if (state.stop) return;
    const target = await waitTarget(args.port, 90000, () => state.stop);
    const connection = connectCdp(target.webSocketDebuggerUrl);
    cdp = connection;
    const { beforeRestart, zh } = await runChecks(connection, args, workdir, () => state.stop);

    cleanup();
    await portClosed(args.port);
    await sleep(2500);
    if (state.stop) return;

    // 重启验证用一个新的空闲端口，避免同一端口在 TIME_WAIT 里重绑失败
    args.port = await freePort();
    ports.push(args.port);
    child = await launch(args, env);
    if (state.stop) return;
    const target2 = await waitTarget(args.port, 90000, () => state.stop);
    const second = connectCdp(target2.webSocketDebuggerUrl);
    cdp = second;
    await second.ready;
    await second.send('Runtime.enable');
    let after = null;
    for (let i = 0; i < 80; i++) {
      after = await second.send('Runtime.evaluate', { expression: 'window.__dshInteraction ? window.__dshInteraction() : null', returnByValue: true }).then(r => r.result.value).catch(() => null);
      if (after) break;
      await sleep(400);
    }
    check('重启后互动配置保留', JSON.stringify(after) === JSON.stringify(beforeRestart), JSON.stringify(after));
    const ui = await second.send('Runtime.evaluate', { expression: `({bubble:document.getElementById('interaction-bubble-head')?.value,body:document.getElementById('interaction-body')?.checked})`, returnByValue: true }).then(r => r.result.value).catch(() => null);
    check('重启后面板回显已保存的中文气泡', ui?.bubble === zh, JSON.stringify(ui));
  }

  // 超时不直接 process.exit：走统一 finally，保证关窗、释放端口、写报告。
  const timeoutMs = Number(args.timeoutMs);
  const deadline = new Promise(resolve => {
    setTimeout(() => { timedOut = true; state.stop = true; resolve('timeout'); }, timeoutMs).unref?.();
  });
  const work = scenario().catch(error => {
    if (state.stop) return 'stopped';
    console.error('[gui-check] 失败：', error);
    results.push({ name: 'harness', ok: false, detail: String(error) });
    return 'error';
  });

  try {
    const outcome = await Promise.race([work, deadline]);
    if (outcome === 'timeout') results.push({ name: '整体超时', ok: false, detail: `${timeoutMs}ms 内未完成` });
  } finally {
    state.stop = true;
    cleanup();
    await sleep(600);
    cleanup(); // 超时瞬间可能刚拉起新进程，二次清理兜底
    const released = (await Promise.all(ports.map(port => portClosed(port)))).every(Boolean);
    check('清理后窗口关闭、调试端口释放', released);
    const failed = results.filter(item => !item.ok);
    const summary = { ok: failed.length === 0, timedOut, checks: results, workdir, ports, at: new Date().toISOString() };
    await writeFile(path.join(workdir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8').catch(() => {});
    console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} 项通过`);
    console.log(`工作目录（含日志与报告）：${workdir}`);
    if (failed.length) console.log('FAILED:', JSON.stringify(failed));
    process.exitCode = timedOut ? 4 : failed.length ? 1 : 0;
  }
}

main();