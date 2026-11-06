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

test('真实渲染器回调跨 Cubism save/update/load 生命周期运行 10 分钟，叠加不污染下一帧基线', async () => {
  const source = await readFile(new URL('../renderer/viewer.js', import.meta.url), 'utf8');
  const start = source.indexOf('let frameLook=');
  const end = source.indexOf("if(!report.idle)", start);
  assert.ok(start >= 0 && end > start);
  const baseline = { AngleX: 2, AngleY: -1, AngleZ: 3, PositionX: 0.1, ParamBreath: 0, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.9 };
  let values = { ...baseline };
  const coreModel = {
    addParameterValueById(id, value) { values[id] = (values[id] || 0) + value; },
    setParameterValueById(id, value) { values[id] = value; },
    multiplyParameterValueById(id, value) { values[id] = (values[id] ?? 1) * value; },
  };
  const internalModel = Object.assign(new EventEmitter(), { coreModel, updateNaturalMovements() {} });
  let now = 0;
  const context = {
    model: { internalModel }, performance: { now: () => now }, window: {},
    applyWardrobe() {}, appliedMode: 'idle', gestureLock: false, motionLocked: false, windowDrag: false, paused: false,
    idleMotion: createIdleMotion({ seed: 42 }), blink: createBlink({ seed: 42 }), breathValue, attachNaturalOverlay,
    look: { active: false, update() { return { x: 0, y: 0 }; } }, lookParameters,
    headPat: { feedback: () => ({ stage: 0, strength: 0, headY: 0, headZ: 0, eyeSmile: 0, squint: 0, mouthForm: 0, blush: 0, nuzzle: 0 }) },
    gaze: { valueAt: () => ({ x: 0, y: 0 }) }, desktopApi: false,
  };
  runInNewContext(source.slice(start, end), context);
  let moved = false, blinked = false;
  for (let frame = 0; frame < 60 * 60 * 10; frame++) {
    now = frame * 1000 / 60;
    // 和 pixi-live2d-display Cubism4InternalModel.update 一样的事件/存取顺序。
    internalModel.emit('afterMotionUpdate');
    const saved = { ...values };
    for (const [id, value] of Object.entries(baseline)) assert.equal(saved[id], value, `${id} 被存入累积增量，frame=${frame}`);
    internalModel.updateNaturalMovements(1000/60, now);
    // 本模型 physics 将控制器映射到实际头部输出。必须在 physics 前已能读到增量。
    values.ParamAngleX = values.AngleX;
    values.ParamAngleY = values.AngleY;
    const physicsX = values.ParamAngleX;
    internalModel.emit('beforeModelUpdate');
    assert.equal(values.ParamAngleX, physicsX, '不能在物理之后再次叠加同一头部偏移');
    assert.ok(Math.abs(values.AngleX - baseline.AngleX) <= 1.8 + 1e-6);
    assert.ok(Math.abs(values.AngleZ - baseline.AngleZ) <= 1.4 + 1e-6);
    assert.ok(Math.abs(values.PositionX - baseline.PositionX) <= 0.012 + 1e-6);
    moved ||= Math.abs(values.AngleX - baseline.AngleX) > 0.5;
    blinked ||= values.ParamEyeLOpen < baseline.ParamEyeLOpen * 0.1;
    assert.ok(values.ParamEyeLOpen <= baseline.ParamEyeLOpen);
    values = saved; // model.update() 后的 loadParameters()
  }
  assert.ok(moved);
  assert.ok(blinked);
  context.gestureLock = true;
  context.look.update = () => ({x:1,y:0.5});
  internalModel.emit('afterMotionUpdate');
  const saved = {...values};
  internalModel.updateNaturalMovements(1000/60, now+16);
  assert.ok(values.AngleX > baseline.AngleX + 5, '待机小动作期间仍应注视鼠标');
  assert.equal(saved.AngleX, baseline.AngleX);
});
