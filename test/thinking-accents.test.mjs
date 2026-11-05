import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { thinkingHand, handReturn, handEntry, createThinkingFace, loadThinkingHandReturns } from '../src/runtime/thinking-accents.mjs';

test('short thinking expressions fade and yield without long-thinking flourishes',()=>{
 const face=createThinkingFace();let value;
 for(let i=0;i<180;i++)value=face.valueAt(i/60,'normal');
 assert.ok(value.key7>.23);assert.equal(value.key13,0);
 for(let i=180;i<360;i++)value=face.valueAt(i/60,'deep');
 assert.ok(value.key13>.59);assert.ok(value.key7<.001);assert.equal(value.key8,0);
 assert.deepEqual(face.valueAt(6,'deep',true),{});
 for(let i=361;i<720;i++)value=face.valueAt(i/60,'waiting');
 assert.equal(value.key7,0);assert.ok(value.key13<1e-6);
});

async function rendererTransitionHarness(){
 const source=await readFile(new URL('../renderer/viewer.js',import.meta.url),'utf8');
 const start=source.indexOf('let chain=Promise.resolve()'),end=source.indexOf('    playClickMotions=',start);
 const calls=[];const context={
  labels:{idle:'idle',thinking:'thinking',answering:'answering',error:'error'},desiredMode:'idle',badge:{},
  disposed:false,appliedMode:'idle',motionLocked:false,gestureLock:false,currentThinkingPhase:'waiting',
  thinkingHandReturns:{Movement1:0,Movement3:0,Param39:0,Param41:0},
  model:{internalModel:{coreModel:{setParameterValueById(){}}},motion:async group=>{calls.push(group);return true;}},manager:{},motion:'Idle',expression:'',
  thinkingHand,handReturn,handEntry,fail:e=>{throw e;},setTimeout:fn=>{fn();},
 };
 runInNewContext(source.slice(start,end)+';globalThis.activate=activate;globalThis.flush=()=>chain;',context);
 return {context,calls};
}

test('actual renderer restores each hand before switching intensity or speaking and yields manual lock',async()=>{
 const {context:c,calls}=await rendererTransitionHarness();
 c.currentThinkingPhase='normal';c.activate('thinking');await c.flush();
 assert.deepEqual(calls,['GrassOut']);calls.length=0;
 c.currentThinkingPhase='deep';c.activate('thinking');await c.flush();
 assert.deepEqual(calls,['GrassBack','FingerOut']);calls.length=0;
 c.currentThinkingPhase='waiting';c.activate('thinking');await c.flush();
 assert.deepEqual(calls,['FingerBack','Idle']);calls.length=0;
 c.currentThinkingPhase='deep';c.activate('thinking');await c.flush();calls.length=0;
 c.activate('answering');await c.flush();assert.deepEqual(calls,['FingerBack','Answering']);calls.length=0;
 c.activate('idle');await c.flush();assert.deepEqual(calls,['Return']);calls.length=0;
 c.motionLocked=true;c.currentThinkingPhase='normal';c.activate('thinking');await c.flush();
 assert.deepEqual(calls,[]);
});

test('rapid state changes skip stale automatic hand entries',async()=>{
 const {context:c,calls}=await rendererTransitionHarness();
 c.currentThinkingPhase='normal';c.activate('thinking');c.activate('idle');await c.flush();
 assert.deepEqual(calls,['Idle']);
});

test('return pose is derived from original curve endpoints and excludes unrelated model parameters',async()=>{
 const calls=[];
 const endpoints=await loadThinkingHandReturns(new URL('http://127.0.0.1/model/model.model3.json'),async url=>{
  calls.push(String(url));
  const catalog={FileReferences:{Motions:{GrassBack:[{File:'Animation/grass.json'}],FingerBack:[{File:'Animation/finger.json'}]}}};
  return {ok:true,json:async()=>calls.length===1?catalog:{Curves:[
   {Target:'Parameter',Id:'Param41',Segments:[0,.7,0,1.25,0]},
   {Target:'Parameter',Id:'Movement3',Segments:[0,1,0,1.25,0]},
   {Target:'Parameter',Id:'AngleX',Segments:[0,0,0,1,30]},
  ]}};
 });
 assert.equal(endpoints.Param41,0);assert.equal(endpoints.Movement3,0);
 assert.equal(endpoints.AngleX,undefined);assert.equal(calls[1],'http://127.0.0.1/model/Animation/grass.json');
});
