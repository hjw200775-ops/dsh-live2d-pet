import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRestSway } from '../src/runtime/rest-sway.mjs';
import { createIdleMotion } from '../src/runtime/idle-motion.mjs';

test('久待后偶发摆动：25–35 秒首次触发、双向可见、首尾平滑且没有固定偏置', () => {
  const sway=createRestSway({seed:47});
  const groups=[];let current=null,last={PositionX:0,PositionZ:0,AngleZ:0};
  for(let i=0;i<=90000;i++){
    const time=i/100,value=sway.valueAt(time);
    for(const [id,limit] of Object.entries({PositionX:5.5,PositionZ:6.5,AngleZ:1})){
      assert.ok(Math.abs(value[id])<=limit+1e-9);
      assert.ok(Math.abs(value[id]-last[id])<.08,`${id} 出现跳变`);
    }
    if(Math.abs(value.PositionX)>1e-7){
      if(!current){current={start:time,end:time,area:0,min:0,max:0};groups.push(current);}
      current.end=time;current.area+=value.PositionX*.01;
      current.min=Math.min(current.min,value.PositionX);current.max=Math.max(current.max,value.PositionX);
    }else if(current&&time-current.end>.05)current=null;
    last=value;
  }
  assert.ok(groups[0].start>=25&&groups[0].start<=35);
  assert.ok(groups.length>10&&groups.length<25,'应偶发而非连续循环');
  for(const g of groups){
    assert.ok(g.end-g.start>6.8&&g.end-g.start<9);
    assert.ok(g.min<-3&&g.max>3,'左右摆动都应达到可见幅度');
    assert.ok(Math.abs(g.area)<.01,'一轮摆动的偏置应接近零');
  }
  for(let i=1;i<groups.length;i++)assert.ok(groups[i].start-groups[i-1].end>34.8);
});

test('状态打断时平滑收回，新的待机需要重新等待；自动小动作不会清空久待计时', () => {
  const idle=createIdleMotion({seed:31});
  let previous,peakTime;
  for(let i=0;i<2400;i++){
    const time=i/60,v=idle.valueAt(time,true,{resting:true});
    if(Math.abs(v.PositionZ)>1.8){previous=v;peakTime=time;break;}
  }
  assert.ok(peakTime>25);
  const next=idle.valueAt(peakTime+1/60,false,{resting:false});
  assert.ok(Math.abs(next.PositionZ-previous.PositionZ)<.2,'切状态不能立刻撤掉身体姿态');
  for(let i=2;i<=240;i++)idle.valueAt(peakTime+i/60,false,{resting:false});
  assert.equal(idle.valueAt(peakTime+5,false,{resting:false}).PositionZ,0);
  for(let i=1;i<1200;i++)assert.equal(idle.valueAt(peakTime+5+i/60,true,{resting:true}).PositionZ,0);
  const other=createIdleMotion({seed:31});let visible=false;
  for(let i=0;i<3000;i++){
    const enabled=i%960<750; // 模拟待机动作占用，状态仍是 idle。
    const v=other.valueAt(i/60,enabled,{resting:true});
    visible||=Math.abs(v.PositionZ)>1;
  }
  assert.ok(visible,'待机小动作不应让久待摆动永远触发不了');
});
