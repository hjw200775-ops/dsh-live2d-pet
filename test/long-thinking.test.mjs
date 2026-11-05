import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThinkingFace, LONG_THINKING_TIMING as T } from '../src/runtime/thinking-accents.mjs';

test('sustained real-event thinking produces bounded random combinations with cooldowns',()=>{
 const face=createThinkingFace({seed:92});let prev=null;const bursts=[];const peaks={spiral:0,squeezed:0};
 for(let f=0;f<60*600;f++){
  const t=f/60;const values=face.valueAt(t,f<600?'normal':'deep');const state=face.snapshot();
  for(const [id,value] of Object.entries(values)) assert.ok(value>=0&&value<=1,id);
  assert.ok(values.key3+values.key5<=1.00001,'mutually exclusive eye expressions');
  if(state.preset&&!prev)bursts.push({preset:state.preset,start:state.elapsed,end:state.end});
  if(state.preset)peaks[state.preset]=Math.max(peaks[state.preset],Math.min(values.key8,values[state.preset==='spiral'?'key3':'key5'],values[state.preset==='spiral'?'key13':'key1']));
  prev=state.preset;
 }
 assert.ok(bursts[0].start>=T.firstMin&&bursts[0].start<=T.firstMax+.02);
 assert.ok(peaks.spiral>.9&&peaks.squeezed>.75);
 for(let i=1;i<bursts.length;i++){
  const gap=bursts[i].start-bursts[i-1].end;
  assert.ok(gap>=T.cooldownMin&&gap<=T.cooldownMax+.05);
  if(i>=2)assert.ok(!(bursts[i].preset===bursts[i-1].preset&&bursts[i].preset===bursts[i-2].preset));
 }
 assert.ok(new Set(bursts.slice(1).map((x,i)=>(x.start-bursts[i].start).toFixed(1))).size>5,'non-periodic intervals');
});

test('network waiting never triggers combinations; exit clears them and a new episode waits again',()=>{
 const face=createThinkingFace({seed:1});let t=0,values;
 for(;t<120;t+=1/60){values=face.valueAt(t,'waiting');assert.equal(face.snapshot().preset,null);assert.equal(values.key8,0);}
 for(;t<150;t+=1/60){values=face.valueAt(t,'deep');if(face.snapshot().preset)break;}
 assert.ok(face.snapshot().preset);
 for(let i=0;i<300;i++){t+=1/60;values=face.valueAt(t,null);}
 assert.equal(face.snapshot().elapsed,0);assert.equal(face.snapshot().preset,null);
 for(const key of ['key3','key5','key1','key8'])assert.ok(values[key]<1e-6);
 for(let i=0;i<600;i++){t+=1/60;values=face.valueAt(t,'normal');assert.equal(face.snapshot().preset,null);}
});

test('manual owners interrupt a burst and hidden time is not replayed',()=>{
 const face=createThinkingFace({seed:12});let t=0;
 for(;t<30;t+=1/60){face.valueAt(t,'deep');if(face.snapshot().preset)break;}
 assert.ok(face.snapshot().preset);
 assert.deepEqual(face.valueAt(t+.02,'deep',true),{});assert.equal(face.snapshot().preset,null);
 const before=face.snapshot().elapsed;
 face.valueAt(t+3600,'deep');assert.ok(face.snapshot().elapsed-before<=.050001);assert.equal(face.snapshot().preset,null);
});
