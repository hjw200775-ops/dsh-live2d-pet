import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFidget } from '../src/runtime/fidget.mjs';

test('idle fidget follows the body path at a smaller size and ignores the face', () => {
  const fidget = createFidget({
    Meta: { Duration: 2 },
    Curves: [
      { Id: 'AngleX', Segments: [0, 0, 0, 1, 10, 0, 2, 0] },
      { Id: 'key3', Segments: [0, 0, 0, 2, 1] },
      { Id: 'Movement1', Segments: [0, 0, 0, 2, 1] },
    ],
  }, 0.2);
  assert.equal(fidget.valueAt(1).AngleX, 2);
  assert.equal(fidget.valueAt(0).AngleX, 0);
  assert.equal(fidget.valueAt(1).key3, undefined);
  assert.equal(fidget.valueAt(1).Movement1, undefined);
});
