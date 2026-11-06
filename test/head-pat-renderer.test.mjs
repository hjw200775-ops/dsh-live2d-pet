import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { createIdleMotion } from '../src/runtime/idle-motion.mjs';
import { createBlink } from '../src/runtime/blink.mjs';
import { breathValue } from '../src/runtime/breathing.mjs';
import { attachNaturalOverlay } from '../src/runtime/natural-overlay.mjs';
import { lookParameters } from '../src/runtime/look.mjs';
import { createHeadPat } from '../src/runtime/head-pat.mjs';

async function loadViewerSource() {
  return readFile(new URL('../renderer/viewer.js', import.meta.url), 'utf8');
}

test('摸头的头部增量在物理之前叠加，且不污染下一帧基线', async () => {
  const source = await loadViewerSource();
  const start = source.indexOf('let frameLook=');
  const end = source.indexOf('if(!report.idle)', start);
  assert.ok(start >= 0 && end > start, '应能截取自然叠加段');

  const baseline = { AngleX: 2, AngleY: -1, AngleZ: 3, PositionX: 0.1, ParamBreath: 0 };
  let values = { ...baseline };
  const coreModel = {
    addParameterValueById(id, value) { values[id] = (values[id] || 0) + value; },
    setParameterValueById(id, value) { values[id] = value; },
    multiplyParameterValueById(id, value) { values[id] = (values[id] ?? 1) * value; },
  };
  const internalModel = Object.assign(new EventEmitter(), { coreModel, updateNaturalMovements() {} });

  const pat = createHeadPat();
  let now = 0;
  const context = {
    model: { internalModel },
    performance: { now: () => now },
    window: {},
    applyWardrobe() {},
    appliedMode: 'idle',
    gestureLock: false,
    motionLocked: false,
    windowDrag: false,
    paused: false,
    idleMotion: createIdleMotion({ seed: 7 }),
    blink: createBlink({ seed: 7 }),
    breathValue,
    attachNaturalOverlay,
    look: { active: false, update() { return { x: 0, y: 0 }; } },
    lookParameters,
    gaze: { valueAt: () => ({ x: 0, y: 0 }) },
    desktopApi: false,
    headPat: pat,
  };
  runInNewContext(source.slice(start, end), context);

  // 进入摸头并推进到第 1 级
  pat.begin(0);
  pat.tick(450);
  now = 1600;
  pat.tick(now);

  const saved = { ...values };
  internalModel.emit('afterMotionUpdate');
  // Cubism 顺序：动作 → saveParameters → naturalMovements → physics，叠加在 naturalMovements 里生效
  internalModel.updateNaturalMovements(1 / 60, now);
  internalModel.emit('beforeModelUpdate');

  const expected = pat.feedback(now);
  assert.ok(expected.headY < 0, '摸头应产生低头量');
  assert.ok(expected.headZ > 0, '摸头应产生歪头量');
  assert.ok(values.AngleY < baseline.AngleY - 1, `AngleY 应被拉低，实际 ${values.AngleY}`);
  assert.ok(values.AngleZ > baseline.AngleZ + 0.5, `AngleZ 应被抬高，实际 ${values.AngleZ}`);

  // 基线本身不能被写脏：下一帧保存的值仍是基线
  for (const [id, value] of Object.entries(baseline)) {
    assert.equal(saved[id], value, `${id} 不该被摸头增量污染`);
  }

  // 松手淡出后回到基线附近
  pat.end(1600);
  now = 1600 + 500;
  pat.tick(now);
  assert.equal(pat.engaged, false, '淡出结束应退出摸头');
  assert.equal(pat.feedback(now).headY, 0);
});

test('渲染器接线的关键点都在（结构守卫）', async () => {
  const source = await loadViewerSource();
  const required = [
    // 待机 + 头部 + 面板关闭才进入预备态
    "appliedMode==='idle'&&panel.hidden&&regionAt(e.clientY)==='head'",
    // 拖动优先：达到阈值前拖动就取消预备态
    "if(headPat.pressing&&(e.buttons&1)&&decision?.type==='drag-start')stopHeadPat(performance.now(),true,'drag-start');",
    // 摸头期间不拖动
    'if(headPat.engaged){',
    // 松手不触发单击/双击反馈
    'if(patWasEngaged)return;',
    // 打开设置立即结束
    'openPanelAt=(x,y)=>{',
    // 失焦 / 隐藏 / 状态切换
    "on(window,'blur'",
    "if(document.hidden)stopHeadPat(",
    "if(mode!=='idle')stopHeadPat(",
    // 待机小动作与偶发手势让位
    '!headPat.engaged',
  ];
  for (const needle of required) {
    assert.ok(source.includes(needle), `缺少接线：${needle}`);
  }
  // 叠加素材不能接收鼠标事件，否则会挡住点击穿透
  const css = await readFile(new URL('../renderer/style.css', import.meta.url), 'utf8');
  assert.ok(css.includes('#petpat'), '样式里缺少 #petpat');
  assert.ok(css.includes('pointer-events:none'), '叠加素材必须 pointer-events:none');
  assert.ok(!css.includes('animation:petpat-bob'), '用真动图后不该再叠 CSS 轻拍，否则双倍抖动');
  const html = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="petpat"'), 'HTML 缺少叠加层元素');
  assert.ok(html.includes('assets/petpat.webp'), 'HTML 应指向本地动图素材');
  const asset = await readFile(new URL('../renderer/assets/petpat.webp', import.meta.url));
  assert.ok(asset.length > 1000, '动图素材应该存在且有内容');
  assert.equal(asset.subarray(0, 4).toString('ascii'), 'RIFF', 'webp 应以 RIFF 开头');
  assert.equal(asset.subarray(8, 12).toString('ascii'), 'WEBP', '应是 WebP 容器');
});
