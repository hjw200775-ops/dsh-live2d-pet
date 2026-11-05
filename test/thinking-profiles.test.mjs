import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThinkingMotion } from '../src/runtime/thinking.mjs';

test('thinking profiles visibly differ and head/gaze/balance change on separate deadlines', () => {
 const stats={};
 for(const phase of ['normal','deep','waiting']){
  const motion=createThinkingMotion({seed:71});
  const sums={AngleZ:0,AngleY:0,PositionX:0,ParamEyeBallX:0,ParamEyeBallY:0};
  let count=0, last={},separateChanges=0;
  for(let frame=0;frame<60*90;frame++){
   const value=motion.valueAt(frame/60,phase);
   if(frame>180){
    for(const key of Object.keys(sums))sums[key]+=Math.abs(value[key]);
    count++;
    const headDelta=Math.abs(value.AngleZ-(last.AngleZ||0));
    const gazeDelta=Math.abs(value.ParamEyeBallY-(last.ParamEyeBallY||0));
    if(headDelta<.0002&&gazeDelta>.0004)separateChanges++;
    assert.ok(!(Math.abs(value.AngleZ)>6&&Math.abs(value.PositionX)>2.4),'no simultaneous head/body extremes');
   }
   last=value;
  }
  stats[phase]=Object.fromEntries(Object.entries(sums).map(([key,sum])=>[key,sum/count]));
  assert.ok(separateChanges>0,'gaze changes independently from head');
 }
 assert.ok(stats.normal.AngleZ>stats.waiting.AngleZ*1.8);
 assert.ok(stats.deep.AngleY>stats.normal.AngleY*3);
 assert.ok(stats.normal.ParamEyeBallX>stats.waiting.ParamEyeBallX*3);
 assert.ok(stats.normal.PositionX>.7,'weight shift has appreciable controller magnitude');
});
