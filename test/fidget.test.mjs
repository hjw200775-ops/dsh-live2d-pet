import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFidget } from '../src/runtime/fidget.mjs';

test('待机微动只用身体参数，不动脸和道具', () => {
  const fidget = createFidget({
    Meta: { Duration: 2 },
    Curves: [
      { Id: 'AngleX', Segments: [0, 0, 0, 1, 10, 0, 2, 0] },
      { Id: 'key3', Segments: [0, 0, 0, 2, 1] },
      { Id: 'Movement1', Segments: [0, 0, 0, 2, 1] },
    ],
  }, 0.2);
  assert.equal(fidget.valueAt(1).key3, undefined);
  assert.equal(fidget.valueAt(1).Movement1, undefined);
  assert.ok('AngleX' in fidget.valueAt(1));
});

test('曲线带静态偏置时会先减均值，叠加层不产生长期偏头', () => {
  // 脱捕真实情况：AngleZ 从 0 拱到 23.4 再回 0，时间均值正得厉害
  const fidget = createFidget({
    Meta: { Duration: 4 },
    Curves: [{ Id: 'AngleZ', Segments: [0, 0, 0, 2, 23.4, 0, 4, 0] }],
  }, 0.14);
  const values = [];
  for (let t = 0; t < 4; t += 0.05) values.push(fidget.valueAt(t).AngleZ);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  assert.ok(Math.abs(mean) < 0.1, `叠加层均值应接近 0，实际 ${mean}`);
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread > 2, `摆动幅度太小：${spread}`);
});

test('恒定曲线（纯偏移）叠加后接近 0', () => {
  const fidget = createFidget({
    Meta: { Duration: 3 },
    Curves: [{ Id: 'AngleZ', Segments: [0, 11.58, 0, 3, 11.58] }],
  }, 0.14);
  for (const t of [0, 1, 2.5]) {
    assert.ok(Math.abs(fidget.valueAt(t).AngleZ) < 1e-6, `t=${t} 不该有偏移`);
  }
  assert.ok(Math.abs(fidget.offsetFor('AngleZ') - 11.58 * 0.14) < 1e-6);
});
