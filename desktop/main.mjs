import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, screen, dialog, shell, clipboard } from 'electron';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startViewer } from '../src/viewer-server.js';
import { createDesktopLink } from '../src/activity.js';
import { createFileLogger } from '../src/log-file.mjs';
import { movedWindowBounds, resetWindowBounds, scaledWindowBounds } from '../src/desktop/drag.mjs';
import { loadDesktopPreferences, placeBounds, saveDesktopPreferences } from '../src/desktop/preferences.mjs';
import { rendererRecovery, wakeWindow, acceptPetIpc } from '../src/desktop/session.mjs';
import { createPointerTracker } from '../src/desktop/pointer.mjs';
import { normalizeMouseFollow } from '../src/runtime/look.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// 日志默认落盘到 ~/.dsh/live2d/logs/：用户出问题时能把文件直接发过来，不用复述"闪一下就没了"
const fileLogger = process.env.DSH_DESKTOP_LOG
  ? createFileLogger({ file: process.env.DSH_DESKTOP_LOG })
  : createFileLogger({ name: 'desktop' });
const log = fileLogger.log;
const logDir = fileLogger.dir;
// 不设名字的话，未打包的 Electron 会用公共目录 %APPDATA%\Electron，和别的应用互相覆盖
app.setName('DeepSeek-chan');
if (process.env.DSH_DESKTOP_USER_DATA) app.setPath('userData', process.env.DSH_DESKTOP_USER_DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let windowRef;
let viewer;
let desktopLink;
let tray;
let dragging;
let quitWithHost = false;
let userHidden = false;
let rendererReloads = 0;
let mouseFollow = normalizeMouseFollow();
const preferencesFile = () => path.join(app.getPath('userData'), 'desktop-preferences.json');

function displays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(display => ({
    id: String(display.id),
    primary: display.id === primaryId,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
  }));
}

function boundsPayload(bounds, displayId) {
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, displayId };
}

async function persistWindow() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const current = windowRef.getBounds();
  const display = screen.getDisplayMatching(current);
  const previous = await loadDesktopPreferences(preferencesFile());
  await saveDesktopPreferences(preferencesFile(), {
    ...previous,
    bounds: current,
    displayId: String(display.id),
    alwaysOnTop: windowRef.isAlwaysOnTop(),
  });
}

function createWindow(placed) {
  const window = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    transparent: true,
    frame: false,
    show: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.once('ready-to-show', () => window.showInactive());
  return window;
}

app.on('second-instance', () => {
  log('SECOND_INSTANCE');
  if (windowRef && !windowRef.isDestroyed()) windowRef.showInactive();
});

function fromPet(event) {
  return acceptPetIpc(event.sender, windowRef && !windowRef.isDestroyed() ? windowRef.webContents : null);
}

ipcMain.on('desktop:set-ignore', (event, ignore) => {
  if (!fromPet(event) || dragging) return;
  windowRef.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('desktop:drag-start', event => {
  if (!fromPet(event)) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = windowRef.getBounds();
  clearTimeout(zoomJob?.timer);
  zoomJob = null;
  dragging = { window: windowRef, cursor, bounds };
  windowRef.setIgnoreMouseEvents(false);
});
ipcMain.on('desktop:drag-move', event => {
  if (!fromPet(event) || !dragging || dragging.frame) return;
  dragging.frame = setTimeout(() => {
    if (!dragging) return;
    dragging.frame = null;
    const cursor = screen.getCursorScreenPoint();
    dragging.window.setBounds(movedWindowBounds(dragging.bounds, dragging.cursor, cursor));
  }, 16);
});
const baseWindow = { width: 460, height: 700 };
let zoomJob = null;
function animateWindow(window, target) {
  const from = window.getBounds();
  const start = Date.now();
  const duration = 160;
  clearTimeout(zoomJob?.timer);
  zoomJob = { window, from, target, start, duration, timer: null };
  const step = () => {
    if (!zoomJob || zoomJob.window !== window || window.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - zoomJob.start) / zoomJob.duration);
    const eased = 1 - (1 - t) ** 3;
    window.setBounds({
      x: Math.round(zoomJob.from.x + (zoomJob.target.x - zoomJob.from.x) * eased),
      y: Math.round(zoomJob.from.y + (zoomJob.target.y - zoomJob.from.y) * eased),
      width: Math.max(200, Math.round(zoomJob.from.width + (zoomJob.target.width - zoomJob.from.width) * eased)),
      height: Math.max(240, Math.round(zoomJob.from.height + (zoomJob.target.height - zoomJob.from.height) * eased)),
    });
    if (t < 1) zoomJob.timer = setTimeout(step, 16);
    else { zoomJob = null; void persistWindow(); }
  };
  step();
}
ipcMain.on('desktop:scale-by', (event, factor) => {
  if (!fromPet(event) || dragging) return;
  const base = zoomJob?.target || windowRef.getBounds();
  const area = screen.getDisplayMatching(windowRef.getBounds()).workArea;
  animateWindow(windowRef, scaledWindowBounds(base, Number(factor), area, baseWindow));
});
ipcMain.on('desktop:reset-scale', event => {
  if (!fromPet(event) || dragging) return;
  const area = screen.getDisplayMatching(windowRef.getBounds()).workArea;
  animateWindow(windowRef, resetWindowBounds(windowRef.getBounds(), area, baseWindow));
});
ipcMain.on('desktop:set-top', (event, pinned) => {
  if (!fromPet(event)) return;
  windowRef.setAlwaysOnTop(!!pinned);
  void persistWindow();
});
ipcMain.handle('desktop:get-wardrobe', async event => {
  if (!fromPet(event)) return null;
  return (await loadDesktopPreferences(preferencesFile())).wardrobe;
});
ipcMain.on('desktop:set-wardrobe', async (event, value) => {
  if (!fromPet(event)) return;
  const previous = await loadDesktopPreferences(preferencesFile());
  await saveDesktopPreferences(preferencesFile(), { ...previous, wardrobe: value });
});
ipcMain.handle('desktop:get-quit-with-host', event => fromPet(event) ? quitWithHost : false);
ipcMain.on('desktop:set-quit-with-host', async (event, value) => {
  if (!fromPet(event)) return;
  quitWithHost = value === true;
  const previous = await loadDesktopPreferences(preferencesFile());
  await saveDesktopPreferences(preferencesFile(), { ...previous, quitWithHost });
  buildTray();
});
ipcMain.on('desktop:quit', event => { if (fromPet(event)) app.quit(); });
ipcMain.on('desktop:refresh-balance', event => { if (fromPet(event)) desktopLink?.requestRefresh(); });
ipcMain.handle('desktop:get-mouse-follow', event => fromPet(event) ? mouseFollow : null);
ipcMain.on('desktop:set-mouse-follow', async (event, value) => {
  if (!fromPet(event)) return;
  mouseFollow = normalizeMouseFollow(value, mouseFollow);
  const previous = await loadDesktopPreferences(preferencesFile());
  await saveDesktopPreferences(preferencesFile(), { ...previous, mouseFollow });
});
ipcMain.on('desktop:drag-end', async event => {
  if (!fromPet(event) || !dragging) return;
  clearTimeout(dragging.frame);
  const cursor = screen.getCursorScreenPoint();
  dragging.window.setBounds(movedWindowBounds(dragging.bounds, dragging.cursor, cursor));
  dragging = null;
  await persistWindow();
});

function buildTray() {
  if (!tray || !windowRef || windowRef.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示', click: () => { userHidden = false; windowRef.showInactive(); } },
    { label: '隐藏', click: () => { userHidden = true; windowRef.hide(); } },
    { label: '置顶', type: 'checkbox', checked: windowRef.isAlwaysOnTop(), click: item => { windowRef.setAlwaysOnTop(item.checked); void persistWindow(); } },
    { label: '随 DSH 退出', type: 'checkbox', checked: quitWithHost, click: async item => {
      quitWithHost = item.checked;
      const previous = await loadDesktopPreferences(preferencesFile());
      await saveDesktopPreferences(preferencesFile(), { ...previous, quitWithHost });
      if (!windowRef.isDestroyed()) windowRef.webContents.send('desktop:quit-with-host', quitWithHost);
    } },
    { type: 'separator' },
    { label: '复制姿态参数', click: () => {
      // 出问题时让用户一键复制当前头部/身体参数，比"她歪着头"好定位得多
      const ids = ['AngleX', 'AngleY', 'AngleZ', 'ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'PositionX', 'PositionY', 'PositionZ'];
      void windowRef.webContents.executeJavaScript(`window.__dshParams ? JSON.stringify(window.__dshParams(${JSON.stringify(ids)})) : 'null'`)
        .then(text => clipboard.writeText(text))
        .catch(() => {});
    } },
    { label: '打开日志目录', click: () => { void shell.openPath(logDir); } },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setToolTip('DeepSeek-chan');
  tray.setContextMenu(menu);
}

/**
 * 读插件配置。config.json 不存在是正常情况（约定路径即可），
 * 以前这里直接 JSON.parse 抛错，窗口不创建、进程也不退出，留下一堆无窗口的僵尸 Electron
 * 占着几百 MB 内存。现在缺文件就回落到约定路径，其它错误才抛。
 */
async function loadConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`配置文件读不了（${configPath}）：${error.message}`);
    const { resolveModelConfig } = await import('../src/index.js');
    const resolved = await resolveModelConfig({ configFile: configPath });
    log(`CONFIG_FALLBACK ${configPath}`);
    return resolved.local;
  }
}

function fatal(error) {
  const text = error && error.stack || String(error);
  log('APP_FAIL ' + text);
  try { dialog.showErrorBox('DeepSeek-chan 桌宠没有启动', `${error?.message || error}\n\n详见控制台日志（[live2d]/APP_FAIL）。`); } catch { /* 没有图形环境就算了 */ }
  try { app.exit(1); } catch { /* 已在退出 */ }
}

process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

app.whenReady().then(async () => {
  log(`APP_READY log=${fileLogger.file}`);
  // 老版本没设 app 名，配置存在公共目录 %APPDATA%\Electron；换了名字之后把旧的位置搬过来
  try {
    const target = preferencesFile();
    const legacy = path.join(app.getPath('appData'), 'Electron', 'desktop-preferences.json');
    if (target !== legacy && !(await readFile(target).then(() => true, () => false)) && (await readFile(legacy).then(() => true, () => false))) {
      await copyFile(legacy, target);
      log(`PREFS_MIGRATED ${legacy} -> ${target}`);
    }
  } catch { /* 迁移失败不影响启动，最多位置回到默认 */ }
  const configPath = process.env.DSH_LIVE2D_CONFIG || path.join(homedir(), '.dsh', 'live2d', 'config.json');
  const config = await loadConfig(configPath);
  const link = createDesktopLink();
  desktopLink = link;
  viewer = await startViewer({ modelFile: config.modelFile, coreFile: config.coreFile, configDir: process.env.DSH_LIVE2D_CONFIG_DIR || path.dirname(configPath), activity: link, bridgeFile: path.join(path.dirname(configPath), 'desktop-bridge.json') });
  const saved = await loadDesktopPreferences(preferencesFile());
  mouseFollow = normalizeMouseFollow(saved.mouseFollow);
  const placed = placeBounds(saved, displays());
  windowRef = createWindow(placed);
  if (saved.alwaysOnTop === false) windowRef.setAlwaysOnTop(false);
  quitWithHost = saved.quitWithHost === true;
  const icon = nativeImage.createFromPath(path.join(here, 'tray.png'));
  tray = new Tray(icon);
  buildTray();
  const recoverWindow = () => {
    if (!windowRef || windowRef.isDestroyed() || dragging || zoomJob) return;
    const current = windowRef.getBounds();
    const display = screen.getDisplayMatching(current);
    const placedNow = placeBounds({ bounds: current, displayId: String(display.id) }, displays());
    if (placedNow.x === current.x && placedNow.y === current.y && placedNow.width === current.width && placedNow.height === current.height) return;
    windowRef.setBounds({ x: placedNow.x, y: placedNow.y, width: placedNow.width, height: placedNow.height });
    void persistWindow();
  };
  screen.on('display-removed', recoverWindow);
  screen.on('display-metrics-changed', recoverWindow);
  const wake = () => {
    const action = wakeWindow({ userHidden });
    if (action.reposition) recoverWindow();
    if (!windowRef || windowRef.isDestroyed()) return;
    if (action.show && !windowRef.isVisible()) windowRef.showInactive();
    windowRef.webContents.send('desktop:resume');
  };
  powerMonitor.on('resume', wake);
  powerMonitor.on('unlock-screen', wake);
  windowRef.webContents.on('render-process-gone', (_event, details) => {
    log('RENDER_GONE ' + JSON.stringify(details));
    if (quitting || rendererRecovery(details.reason, rendererReloads) !== 'reload') return;
    rendererReloads += 1;
    windowRef.webContents.reload();
  });
  windowRef.webContents.on('console-message', (_event, _level, message) => log('PAGE ' + message));
  windowRef.webContents.on('did-fail-load', (_event, code, description) => log('FAIL_LOAD ' + code + ' ' + description));
  const page = new URL(viewer.url);
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== page.origin) event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  await windowRef.loadURL(viewer.url);
  // 透明点击穿透窗口的 DOM mousemove 在离开/重新进入时可能断流。
  // 用 Electron 屏幕坐标兜底；只在识别范围内坐标变化和移出时发送。
  const pointerTracker = createPointerTracker();
  const pointerTimer = setInterval(() => {
    if (!windowRef || windowRef.isDestroyed()) return;
    const point = pointerTracker.sample(screen.getCursorScreenPoint(), windowRef.getBounds(), windowRef.isVisible(), mouseFollow);
    if (point) windowRef.webContents.send('desktop:pointer', point);
  }, 33);
  windowRef.once('closed', () => clearInterval(pointerTimer));
  const waitForBridge = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = await windowRef.webContents.executeJavaScript('({ready:!!window.__dshDesktopReady, status:(document.getElementById("status")||{}).textContent||""})').catch(error => ({ error: String(error) }));
        if (attempt === 0 || attempt % 4 === 0 || status.ready) log('WAIT ' + JSON.stringify(status));
        if (status.ready) return;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      throw new Error('桌宠页面没有在限时内完成模型加载');
    };
    try {
      const report = {
        displays: displays(),
        restored: windowRef.getBounds(),
        focused: windowRef.isFocused(),
        alwaysOnTop: windowRef.isAlwaysOnTop(),
        clickThrough: true,
      };
      if (process.env.DSH_DESKTOP_CHECK === '1') {
        await waitForBridge();
        const forcedMode = process.env.DSH_DESKTOP_CHECK_MODE;
        const forcedMotion = process.env.DSH_DESKTOP_CHECK_MOTION;
        if (forcedMotion) {
          const started = await windowRef.webContents.executeJavaScript(
            `(async()=>{try{const ok=await window.__dshPlayMotion?.(${JSON.stringify(forcedMotion)});return String(ok);}catch(e){return 'ERR '+e.message;}})()`,
          ).catch(error => 'ERR ' + error.message);
          log('FORCED_MOTION ' + forcedMotion + ' -> ' + started);
        }
        const waitMs = Number(process.env.DSH_DESKTOP_CHECK_WAIT_MS || 0);
        const ids = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'ParamAngleZ'];
        const readParams = async () => windowRef.webContents
          .executeJavaScript(`window.__dshParams ? window.__dshParams(${JSON.stringify(ids)}) : null`)
          .catch(error => ({ error: String(error) }));
        // 链路有 3 秒的 stale 超时：要持续喂状态，否则会被打回 idle
        const series = [];
        for (let elapsed = 0; elapsed < Math.max(waitMs, 1000); elapsed += 500) {
          if (forcedMode) desktopLink?.ingest?.({ mode: forcedMode, activeCount: 1 });
          if (elapsed % 1000 === 0) series.push({ t: elapsed, ...(await readParams()) });
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (forcedMode) log('FORCED_MODE ' + forcedMode);
        report.groups = await windowRef.webContents.executeJavaScript('window.__dshGroups ? window.__dshGroups() : null').catch(() => null);
        log('GROUPS ' + JSON.stringify(report.groups));
        log('PARAMS_SERIES ' + JSON.stringify(series));
        report.params = series[series.length - 1];
        const hits = await windowRef.webContents.executeJavaScript('window.__dshHit ? { corner: window.__dshHit(6, 6), face: window.__dshHit(Math.round(innerWidth/2), Math.round(innerHeight*0.42)) } : null');
        report.hits = hits;
        const image = await windowRef.capturePage();
        const shot = process.env.DSH_DESKTOP_SHOT || path.join(here, '..', 'qa', 'desktop-front.png');
        await writeFile(shot, image.toPNG());
        report.shot = shot;
        const all = displays();
        if (all.length > 1) {
          const other = all.find(display => !display.primary) || all[1];
          windowRef.setPosition(other.workArea.x + 40, other.workArea.y + 40);
          report.movedTo = { displayId: other.id, bounds: windowRef.getBounds() };
        } else {
          const area = all[0].workArea;
          windowRef.setPosition(area.x - 40, area.y + 80);
          report.movedTo = { displayId: all[0].id, bounds: windowRef.getBounds(), note: 'single-display partial negative offset' };
        }
        await persistWindow();
        const reloaded = await loadDesktopPreferences(preferencesFile());
        const replaced = placeBounds(reloaded, displays());
        report.saved = reloaded.bounds;
        report.placedAgain = replaced;
        log('DESKTOP_CHECK ' + JSON.stringify(report));
        setTimeout(() => app.quit(), 1200);
      } else {
        log('DESKTOP_READY ' + JSON.stringify({ url: viewer.url, displays: report.displays.length, bounds: report.restored }));
      }
    } catch (error) {
      log('CHECK_FAIL ' + (error && error.stack || error));
      setTimeout(() => app.quit(), 500);
    }
}).catch(fatal);

let quitting = false;
app.on('before-quit', () => {
  if (windowRef && !windowRef.isDestroyed()) windowRef.destroy();
  if (tray) { tray.destroy(); tray = null; }
});
app.on('window-all-closed', () => { if (!quitting) app.quit(); });
app.on('will-quit', event => {
  if (!viewer || quitting) return;
  event.preventDefault();
  quitting = true;
  desktopLink?.dispose();
  const closing = viewer;
  viewer = null;
  closing.close().finally(() => app.quit());
});
