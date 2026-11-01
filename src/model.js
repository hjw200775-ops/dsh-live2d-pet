import { readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUTHORED_MOTIONS } from './runtime/authored-motions.mjs';
import { fadeFor } from './runtime/fades.mjs';

export async function localFile(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\\x00?#:]/.test(relative) || relative.startsWith('/') || relative.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('Invalid relative asset path');
  }
  const base = await realpath(root);
  const target = await realpath(path.resolve(base, ...relative.split('/')));
  const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Asset escapes model directory');
  return target;
}

export async function inspectModel(modelFile) {
  const filename = await realpath(modelFile);
  const root = path.dirname(filename);
  const model = JSON.parse(await readFile(filename, 'utf8'));
  if (model.Version !== 3 || !model.FileReferences?.Moc || !model.FileReferences?.Textures?.length) throw new Error('Expected a Cubism model3.json with Moc and Textures');
  const refs = model.FileReferences;
  // Clone loaded JSON only. The author's entry and original resources stay untouched.
  const optionalDir = async (dir, suffix) => {
    try { return (await readdir(path.join(root, dir))).filter(n => n.endsWith(suffix)).sort().map(n => `${dir}/${n}`); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  };
  const motions = await optionalDir('Animation', '.motion3.json');
  const expressions = await optionalDir('Exp3', '.exp3.json');
  if (!refs.Motions?.Idle?.length) {
    const idle = motions.find(n => /\/idle\.motion3\.json$/i.test(n));
    if (idle) refs.Motions = { ...refs.Motions, Idle: [{ File: idle, FadeInTime: 0.5, FadeOutTime: 0.5 }] };
  }
  if (!refs.Expressions) refs.Expressions = expressions.map(File => ({ Name: path.basename(File, '.exp3.json'), File }));
  const actions = {Answering:'默认手切举手',Return:'举手切默认手',FingerOut:'竖手指切出来动画',FingerBack:'竖手指切回默认',GrassOut:'狗尾草切换出来',GrassBack:'狗尾草切回默认手',Escape:'脱捕'};
  // 淡入淡出按动作组区分：回到平静要慢、注意力转移要快
  for(const [group,name] of Object.entries(actions)) {
    const File=motions.find(n=>path.basename(n)===`${name}.motion3.json`);
    const fade = fadeFor(group);
    if(File) refs.Motions={...refs.Motions,[group]:[{File,FadeInTime:fade.in,FadeOutTime:fade.out}]};
  }
  for (const [group, motion] of Object.entries(AUTHORED_MOTIONS)) {
    const fade = fadeFor(group);
    refs.Motions = { ...refs.Motions, [group]: [{ File: motion.file, FadeInTime: fade.in, FadeOutTime: fade.out }] };
  }
  // [pet-gesture] 说话手势：模型里若有「举手保持强调」，优先用它做 Answering（抬手+强调+保持）
  {
    const talk = motions.find(n => path.basename(n) === '举手保持强调.motion3.json');
    const fade = fadeFor('Answering');
    if (talk) refs.Motions = { ...refs.Motions, Answering: [{ File: talk, FadeInTime: fade.in, FadeOutTime: fade.out }] };
  }
  const allowed = new Map();
  const assets = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData,
    ...(refs.Expressions || []).map(x => x.File), ...Object.values(refs.Motions || {}).flat().flatMap(x => [x.File, x.Sound])].filter(asset => asset && !asset.startsWith('generated/'));
  for (const asset of assets) allowed.set(asset, await localFile(root, asset));
  const moc = await readFile(allowed.get(refs.Moc));
  if (moc.subarray(0, 4).toString() !== 'MOC3') throw new Error('Invalid MOC3 signature');
  return { model, allowed, report: { modelEntry: path.basename(filename), mocVersion: moc[4], textures: refs.Textures.length, motions: motions.length, expressions: expressions.length, idle: refs.Motions?.Idle?.[0]?.File || null } };
}
