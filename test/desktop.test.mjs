import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dragCursorOrigin, movedWindowBounds, resetWindowBounds, scaledWindowBounds } from '../src/desktop/drag.mjs';
import { hitDrawableList } from '../src/runtime/model-hit.mjs';
import { loadDesktopPreferences, placeBounds, sanitizeDesktopPreferences, saveDesktopPreferences } from '../src/desktop/preferences.mjs';

test('快速单段拖动保留从按下点开始的完整位移，无效起点回落当前指针', () => {
  const bounds={x:120,y:100,width:460,height:700};
  const current={x:438,y:460};
  const origin=dragCursorOrigin(bounds,{x:228,y:320},current);
  assert.deepEqual(movedWindowBounds(bounds,origin,current),{x:210,y:140,width:460,height:700});
  for(const bad of [null,{x:NaN,y:1},{x:10000,y:1},{x:-1,y:1}])assert.deepEqual(dragCursorOrigin(bounds,bad,current),current);
});

test('鼠标跟随开关与范围可保存重载，旧设置和损坏值回落默认', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-follow-prefs-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'desktop-preferences.json');
  await saveDesktopPreferences(file,{mouseFollow:{enabled:false,radius:600}});
  assert.deepEqual((await loadDesktopPreferences(file)).mouseFollow,{enabled:false,radius:600});
  await saveDesktopPreferences(file,{mouseFollow:{enabled:true,radius:1875}});
  assert.equal((await loadDesktopPreferences(file)).mouseFollow.radius,1875);
  await saveDesktopPreferences(file,{mouseFollow:{enabled:true,radius:0}});
  assert.equal((await loadDesktopPreferences(file)).mouseFollow.radius,0);
  assert.deepEqual(sanitizeDesktopPreferences({}).mouseFollow,{enabled:true,radius:1200});
  assert.deepEqual(sanitizeDesktopPreferences({mouseFollow:{enabled:'false',radius:-1}}).mouseFollow,{enabled:true,radius:1200});
});

test('desktop coordinates keep negatives and recover a missing display', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-prefs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'desktop-preferences.json');
  const displays = [
    { id: 'primary', primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 'left', primary: false, workArea: { x: -1920, y: 0, width: 1920, height: 1080 } },
  ];
  const saved = await saveDesktopPreferences(file, { bounds: { x: -1800, y: 40, width: 460, height: 700 }, displayId: 'left', zoom: 1.2, model: { x: -4, y: 8 } });
  assert.equal(saved.bounds.x, -1800);
  assert.deepEqual(placeBounds(saved, displays), { x: -1800, y: 40, width: 460, height: 700, displayId: 'left' });
  const onlyPrimary = placeBounds(saved, [displays[0]]);
  assert.equal(onlyPrimary.displayId, 'primary');
  assert.ok(onlyPrimary.x >= 0);
  const inflated = placeBounds({ bounds: { x: -1800, y: 40, width: 1400, height: 1800 }, displayId: 'left' }, displays);
  assert.deepEqual(inflated, { x: -1800, y: 0, width: 840, height: 1080, displayId: 'left' });
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const grown = scaledWindowBounds({ x: 400, y: 200, width: 300, height: 400 }, 1.5, workArea);
  assert.deepEqual(grown, { x: 325, y: 0, width: 450, height: 600 });
  const capped = scaledWindowBounds({ x: 100, y: 50, width: 460, height: 700 }, 8, workArea);
  assert.equal(capped.width <= workArea.width && capped.height <= workArea.height, true);
  assert.equal(capped.x >= 0 && capped.y >= 0 && capped.x + capped.width <= workArea.width && capped.y + capped.height <= workArea.height, true);
  const reset = resetWindowBounds({ x: 200, y: 100, width: 900, height: 1200 }, workArea);
  assert.deepEqual(reset, { x: 420, y: 380, width: 460, height: 700 });
  assert.deepEqual(movedWindowBounds({ x: 10, y: 20, width: 460, height: 700 }, { x: 100, y: 100 }, { x: 180, y: 40 }), { x: 90, y: -40, width: 460, height: 700 });
  await writeFile(file, '{', 'utf8');
  const recovered = await loadDesktopPreferences(file);
  assert.equal(recovered.bounds, null);
  assert.equal(sanitizeDesktopPreferences({ bounds: { x: -20, y: 10, width: 10, height: 700 } }).bounds, null);
});

test('model hit testing uses triangles instead of the window rectangle', () => {
  const drawable = { minX: 0, minY: 0, maxX: 10, maxY: 10, vertices: [0, 0, 10, 0, 0, 10], indices: [0, 1, 2] };
  assert.equal(hitDrawableList(1, 1, [drawable]), true);
  assert.equal(hitDrawableList(9, 9, [drawable]), false);
});
