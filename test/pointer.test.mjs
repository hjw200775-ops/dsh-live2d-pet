import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPointerTracker } from '../src/desktop/pointer.mjs';

test('透明窗口指针采样支持负坐标屏幕、静止去重、移出及重新进入', () => {
  const tracker = createPointerTracker();
  const bounds = {x:-500,y:100,width:460,height:700};
  assert.equal(tracker.sample({x:1000,y:1000},bounds),null);
  assert.deepEqual(tracker.sample({x:-400,y:200},bounds),{inside:true,x:100,y:100});
  assert.equal(tracker.sample({x:-400,y:200},bounds),null);
  assert.deepEqual(tracker.sample({x:-399,y:201},bounds),{inside:true,x:101,y:101});
  assert.deepEqual(tracker.sample({x:200,y:200},bounds),{inside:false});
  assert.equal(tracker.sample({x:1000,y:200},bounds),null);
  assert.deepEqual(tracker.sample({x:-400,y:200},bounds),{inside:true,x:100,y:100});
  assert.deepEqual(tracker.sample({x:-400,y:200},bounds,false),{inside:false});
  assert.equal(tracker.sample({x:-400,y:200},bounds,false),null);
});

test('窗口移动或缩放后重新换算相对位置，不沿用旧窗口坐标', () => {
  const tracker = createPointerTracker();
  assert.deepEqual(tracker.sample({x:200,y:200},{x:100,y:100,width:460,height:700}),{inside:true,x:100,y:100});
  assert.deepEqual(tracker.sample({x:200,y:200},{x:150,y:150,width:460,height:700}),{inside:true,x:50,y:50});
  assert.deepEqual(tracker.sample({x:200,y:200},{x:150,y:150,width:40,height:40}),{inside:true,x:50,y:50});
});

test('跟随开关与圆形范围：范围外退出一次，关闭不发送坐标，重开能恢复', () => {
  const tracker = createPointerTracker();
  const bounds = {x:0,y:0,width:400,height:500}; // 头部中心 (200,210)
  const near = {enabled:true,radius:200};
  assert.deepEqual(tracker.sample({x:400,y:210},bounds,true,near),{inside:true,x:400,y:210});
  assert.deepEqual(tracker.sample({x:401,y:210},bounds,true,near),{inside:false});
  assert.equal(tracker.sample({x:401,y:210},bounds,true,near),null);
  assert.deepEqual(tracker.sample({x:200,y:210},bounds,true,near),{inside:true,x:200,y:210});
  assert.deepEqual(tracker.sample({x:200,y:210},bounds,true,{...near,enabled:false}),{inside:false});
  assert.equal(tracker.sample({x:201,y:210},bounds,true,{...near,enabled:false}),null);
  assert.deepEqual(tracker.sample({x:200,y:210},bounds,true,near),{inside:true,x:200,y:210});
  assert.deepEqual(tracker.sample({x:600,y:210},bounds,true,{enabled:true,radius:600}),{inside:true,x:600,y:210});
  assert.deepEqual(tracker.sample({x:600,y:210},bounds,true,near),{inside:false});
});
