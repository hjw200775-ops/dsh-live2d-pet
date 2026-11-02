import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_GAIN, createLookFollower, lookParameters, lookTarget } from '../src/runtime/look.mjs';
import { normalizeMouseFollow, inFollowRange, lookOrigin } from '../src/runtime/look.mjs';

const rect = { left: 1000, top: 100, width: 400, height: 700 };

test('识别范围以头部为中心，圆边界包含在内，开关和无效设置正确处理', () => {
  assert.deepEqual(normalizeMouseFollow(),{enabled:true,radius:1200});
  assert.deepEqual(normalizeMouseFollow({enabled:false,radius:600}),{enabled:false,radius:600});
  assert.deepEqual(normalizeMouseFollow({enabled:'true',radius:Infinity}),{enabled:true,radius:1200});
  assert.equal(normalizeMouseFollow({radius:1875}).radius,1875);
  assert.equal(normalizeMouseFollow({radius:0}).radius,0);
  assert.equal(normalizeMouseFollow({radius:4001}).radius,1200);
  const center=lookOrigin(rect);
  assert.equal(inFollowRange(center.x+1200,center.y,rect),true);
  assert.equal(inFollowRange(center.x+1201,center.y,rect),false);
  assert.equal(inFollowRange(center.x+9000,center.y,rect,{enabled:true,radius:0}),true);
  assert.equal(inFollowRange(center.x,center.y,rect,{enabled:false,radius:0}),false);
  assert.equal(inFollowRange(NaN,center.y,rect),false);
});

test('脸部中心附近也能细微跟随，没有硬死区', () => {
  const {x,y}=lookOrigin(rect);
  assert.deepEqual(lookTarget(x,y,rect),{x:0,y:0});
  const a=lookTarget(x+1,y,rect),b=lookTarget(x+10,y,rect);
  assert.ok(a.x>0&&b.x>a.x&&b.x<0.03);
  assert.equal(b.y,0);
});

test('左右移动产生成比例的方向，且被限制在 [-1,1]', () => {
  const centerY = lookOrigin(rect).y;
  const right = lookTarget(rect.left + rect.width * 0.9, centerY, rect);
  const farRight = lookTarget(rect.left + rect.width * 3, centerY, rect);
  assert.ok(right.x > 0, `右移应该为正，实际 ${right.x}`);
  assert.ok(farRight.x>right.x&&farRight.x<1,'距离增加时平滑趋向上限，不能提前满偏');
  const left = lookTarget(rect.left + rect.width * 0.1, centerY, rect);
  assert.ok(left.x < 0, `左移应该为负，实际 ${left.x}`);
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
  assert.ok(params.ParamAngleX <= 10, '头部左右不该超过 10 度');
  assert.ok(params.ParamAngleY <= 6.5, '头部上下不该超过 6.5 度');
  assert.ok(params.ParamEyeBallX <= 0.5);
});

test('眼睛先捕获目标、头部随后跟上，稳定后眼球回收', () => {
  const f=createLookFollower();
  f.setTarget({x:0.8,y:0.5},0);
  let early;
  for(let t=0;t<=1000;t+=10){const v=f.update(t);if(t===60)early=v;}
  assert.ok(early.eyeX>early.x+0.1,'眼睛应明显领先头部');
  const settled=f.update(1010);
  assert.ok(Math.abs(settled.x-0.8)<0.01);
  assert.ok(Math.abs(settled.eyeX-0.48)<0.02,'头转过去后眼球应稍微回收');
});

test('指针停住保持注视，离开范围才平滑回正；高低帧率响应一致', () => {
  const f=createLookFollower();f.setTarget({x:0.7,y:-0.4},0);
  for(let t=0;t<10000;t+=20)f.update(t);
  assert.ok(f.update(10000).x>0.69);assert.equal(f.active,true);assert.equal(f.moving,false);
  f.release();const first=f.update(10020);assert.ok(first.x>0.6,'移出不能瞬间回中');
  for(let t=10040;t<12000;t+=20)f.update(t);
  assert.ok(Math.abs(f.update(12000).x)<0.01);assert.equal(f.active,false);
  const samples=[];
  for(const fps of [24,30,60,144]){
    const g=createLookFollower();g.update(0);g.setTarget({x:0.8,y:0.3},0);
    for(let i=1;i<=fps;i++)g.update(i*1000/fps);
    samples.push(g.update(1000).x);
  }
  assert.ok(Math.max(...samples)-Math.min(...samples)<0.01);
});

test('快速反向和斜向移动有界、无跳变，范围设置也控制响应尺度', () => {
  const f=createLookFollower();let previous={x:0,y:0,eyeX:0,eyeY:0};
  for(let i=0;i<3000;i++){
    if(i%30===0)f.setTarget({x:(i%60===0?1:-1),y:(i%90===0?1:-1)},i*1000/60);
    const next=f.update(i*1000/60);
    for(const key of ['x','y','eyeX','eyeY']){assert.ok(Math.abs(next[key])<=1);assert.ok(Math.abs(next[key]-previous[key])<0.23);}
    previous=next;
  }
  const {x,y}=lookOrigin(rect);
  const small=lookTarget(x+300,y,rect,{radius:400}),large=lookTarget(x+300,y,rect,{radius:2000});
  assert.ok(small.x>large.x);
  const diagonal=lookTarget(x+3000,y+3000,rect);
  assert.ok(Math.hypot(diagonal.x,diagonal.y)<1);
});

test('暂停或隐藏期间移出范围，恢复时不会补跳到旧目标', () => {
  const f=createLookFollower();f.setTarget({x:1,y:1},0);
  for(let t=0;t<1000;t+=16)f.update(t);
  const before=f.update(1000);f.release();
  const resumed=f.update(60000);
  assert.ok(Math.abs(resumed.x-before.x)<0.05);
  for(let t=60016;t<62000;t+=16)f.update(t);
  assert.ok(Math.abs(f.update(62000).x)<0.01);
});
