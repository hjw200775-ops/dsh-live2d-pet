import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_GAIN, createLookFollower, lookParameters, lookTarget } from '../src/runtime/look.mjs';

const rect = { left: 1000, top: 100, width: 400, height: 700 };

test('指针在中心附近不动（死区）', () => {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height * 0.42;
  for (const dx of [-10, 0, 10]) {
    const point = lookTarget(centerX + dx, centerY, rect);
    assert.equal(point.x, 0);
    assert.equal(point.y, 0);
  }
});

test('左右移动产生成比例的方向，且被限制在 [-1,1]', () => {
  const centerY = rect.top + rect.height * 0.42;
  const right = lookTarget(rect.left + rect.width * 0.9, centerY, rect);
  const farRight = lookTarget(rect.left + rect.width * 3, centerY, rect);
  assert.ok(right.x > 0.3, `右移应该为正，实际 ${right.x}`);
  assert.equal(farRight.x, 1, '远处应该被夹到 1');
  const left = lookTarget(rect.left + rect.width * 0.1, centerY, rect);
  assert.ok(left.x < -0.3, `左移应该为负，实际 ${left.x}`);
});

test('上下方向：屏幕上移对应头部上抬（y 为正）', () => {
  const centerX = rect.left + rect.width / 2;
  const up = lookTarget(centerX, rect.top + 10, rect);
  const down = lookTarget(centerX, rect.top + rect.height * 0.95, rect);
  assert.ok(up.y > 0, `指针在上方时 y 应为正，实际 ${up.y}`);
  assert.ok(down.y < 0, `指针在下方时 y 应为负，实际 ${down.y}`);
});

test('跟随是平滑的，不会一步到位', () => {
  const follower = createLookFollower({ smoothing: 0.18, idleMs: 2200 });
  follower.setTarget({ x: 1, y: 1 }, 0);
  let previous = { x: 0, y: 0 };
  const steps = [];
  for (let t = 16; t <= 320; t += 16) {
    const now = follower.update(t);
    steps.push(now.x);
    assert.ok(now.x >= previous.x - 1e-9, '单调逼近目标');
    assert.ok(now.x - previous.x < 0.35, '单帧跳变过大');
    previous = now;
  }
  const first = steps[0];
  const last = steps[steps.length - 1];
  assert.ok(first < 0.35, `第一帧不该冲到目标，实际 ${first}`);
  assert.ok(last > 0.6, `300ms 后应该接近目标，实际 ${last}`);
});

test('一段时间没动会自己回正', () => {
  const follower = createLookFollower({ smoothing: 0.18, idleMs: 500 });
  follower.setTarget({ x: 1, y: 0.5 }, 0);
  for (let t = 16; t <= 400; t += 16) follower.update(t);
  const held = follower.update(400);
  assert.ok(held.x > 0.5, '刚松开应该还看着那边');
  let last = held;
  for (let t = 500; t <= 1600; t += 16) last = follower.update(t);
  assert.ok(Math.abs(last.x) < 0.12, `应该回正，实际 ${last.x}`);
  assert.equal(last.active, false);
});

test('参数增量幅度在合理范围', () => {
  const params = lookParameters({ x: 1, y: 1 });
  assert.equal(params.ParamAngleX, LOOK_GAIN.headX);
  assert.ok(params.ParamAngleX <= 8, '头部左右不该超过 8 度');
  assert.ok(params.ParamAngleY <= 6, '头部上下不该超过 6 度');
  assert.ok(params.ParamEyeBallX <= 0.5);
});
