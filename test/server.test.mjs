import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startViewer } from '../src/viewer-server.js';
import { apply } from '../src/index.js';

test('private viewer serves only model references and generated Idle without editing original', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-live2d-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'Animation'));
  const original = JSON.stringify({Version:3,FileReferences:{Moc:'test.moc3',Textures:['texture.png']}});
  await Promise.all([
    writeFile(path.join(root,'test.model3.json'), original), writeFile(path.join(root,'test.moc3'), Buffer.from([77,79,67,51,5])),
    writeFile(path.join(root,'texture.png'), 'test texture'), writeFile(path.join(root,'secret.txt'), 'DO NOT SERVE'),
    writeFile(path.join(root,'core.js'),'// test only'), writeFile(path.join(root,'Animation/IDLE.motion3.json'), '{}')
  ]);
  const config = {modelFile:path.join(root,'test.model3.json'),coreFile:path.join(root,'core.js')};
  const viewer = await startViewer(config);
  t.after(() => viewer.close());
  const base = new URL('.',viewer.url);
  assert.equal((await fetch(new URL('status.json',base)).then(r=>r.json())).idle,'Animation/IDLE.motion3.json');
  const generated = await fetch(new URL('model/model.model3.json',base)).then(r=>r.json());
  assert.equal(generated.FileReferences.Motions.Idle[0].File,'Animation/IDLE.motion3.json');
  assert.equal(await readFile(config.modelFile,'utf8'),original);
  for (const route of ['model/secret.txt','model/%2e%2e%2fsecret.txt','model/C:%5csecret.txt','../core.js']) {
    assert.equal((await fetch(new URL(route,base))).status,404);
  }
  assert.equal((await fetch(new URL('model/texture.png',base))).status,200);
  const flinch = await fetch(new URL('model/generated/flinch.motion3.json',base)).then(r=>r.json());
  assert.equal(flinch.Meta.Loop,false);
  assert.equal(flinch.Curves.some(curve=>curve.Id==='ParamAngleX'),false);
  for (const route of ['viewer.js','runtime/motion-policy.mjs','runtime/model-hit.mjs','runtime/gesture.mjs','runtime/balance.mjs','runtime/wardrobe.mjs','runtime/frame-pace.mjs','runtime/host-exit.mjs','runtime/click-motion.mjs','runtime/authored-motions.mjs','runtime/fidget.mjs']) {
    assert.equal((await fetch(new URL(route,base))).status,200,route);
  }
  assert.equal((await fetch(viewer.url,{method:'POST'})).status,405);
  assert.equal((await fetch(new URL('%zz',base))).status,400);

  let route, cleanup, unregistered = false;
  await apply({on(){return()=>{};},webServer:{register(r){route=r; return ()=>{unregistered=true};}},effect(fn){cleanup=fn();}},config);
  const headers = {};
  let payload;
  route.handler({method:'GET'}, {setHeader(k,v){headers[k]=v;},end(b){payload=JSON.parse(b);}});
  assert.equal(new URL(payload.url).hostname,'127.0.0.1');
  assert.equal(route.path,'/deepseek-live2d/bootstrap');
  await cleanup(); assert.equal(unregistered,true);
  await assert.rejects(fetch(payload.url));
});

test('missing assets report an explicit configuration failure', async t => {
  const viewer = await startViewer({}); t.after(()=>viewer.close());
  const status = await fetch(new URL('status.json', viewer.url)).then(r=>r.json());
  assert.equal(status.ok,false);
  // 缺模型时要说人话：说清缺什么、给下载入口，而不是只报 modelFile 未设置
  assert.match(status.error,/模型/);
  assert.match(status.error,/releases/);
});

test('缺 Core 时的报错点名 Core 并给官方下载页', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'live2d-core-'));
  await mkdir(path.join(dir, 'DeepSeek-chan'), { recursive: true });
  const entry = path.join(dir, 'DeepSeek-chan', '大肥鱼.model3.json');
  await writeFile(entry, JSON.stringify({ Version: 3, FileReferences: { Moc: '大肥鱼.moc3', Textures: ['t.png'] } }));
  await writeFile(path.join(dir, 'DeepSeek-chan', '大肥鱼.moc3'), Buffer.from('MOC3xxxx'));
  await writeFile(path.join(dir, 'DeepSeek-chan', 't.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const viewer = await startViewer({ modelFile: entry, configDir: dir });
  t.after(async () => { await viewer.close(); await rm(dir, { recursive: true, force: true }); });
  const status = await fetch(new URL('status.json', viewer.url)).then(r=>r.json());
  assert.equal(status.ok, false);
  assert.match(status.error, /Cubism Core/);
  assert.match(status.error, /live2d\.com/);
});
