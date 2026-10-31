import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('desktop re-enable waits for host route; dispose cancels a pending retry', async () => {
  const code=await readFile(new URL('../client.js',import.meta.url),'utf8');
  let plugin, cleanup, attempts=0;
  const elements=[];
  const element=tag=>{const e={tag,style:{},children:[],addEventListener(){},removeEventListener(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},setAttribute(){},remove(){this.removed=true;}};elements.push(e);return e;};
  const context=vm.createContext({window:{__ModuleLoader__:{load(entry){plugin=entry.factory();}},addEventListener(){},removeEventListener(){}},document:{createElement:element,body:element('body')},AbortController,URL,innerWidth:1280,innerHeight:900,setTimeout,clearTimeout,fetch:async()=>{attempts++;return attempts<3?{ok:false,status:404}:{ok:true,json:async()=>({url:'http://127.0.0.1:12345/test/index.html'})};}});
  vm.runInContext(code,context); plugin.apply({effect(fn){cleanup=fn();}});
  await new Promise(r=>setTimeout(r,1000));
  assert.equal(attempts,3);assert.equal(elements.filter(e=>e.tag==='iframe').length,1);
  assert.match(elements.find(e=>e.tag==='iframe').style.cssText,/color-scheme:normal/);
  cleanup();assert.equal(elements.find(e=>e.id==='dsh-deepseek-live2d').removed,true);
  attempts=0;context.fetch=async()=>{attempts++;return{ok:false,status:404};};
  plugin.apply({effect(fn){cleanup=fn();}});
  await new Promise(r=>setTimeout(r,30)); cleanup();
  await new Promise(r=>setTimeout(r,450));assert.equal(attempts,1);
});
