import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer } from '../src/runtime/gesture.mjs';

test('a short press becomes one click only after the double-click window', () => {
  const gesture = createGestureRecognizer({ slop: 5, holdMs: 180, doubleMs: 260 });
  assert.equal(gesture.pointerDown(0, 0, 0).type, 'down');
  assert.equal(gesture.pointerMove(3, 1), null);
  assert.equal(gesture.pointerUp(2, 1, 40).type, 'click-arm');
  assert.equal(gesture.expire(200), null);
  assert.deepEqual(gesture.expire(300), { type: 'click', x: 2, y: 1 });
});

test('a second tap replaces the pending click with one double-click', () => {
  const gesture = createGestureRecognizer();
  gesture.pointerDown(0, 0, 0);
  gesture.pointerUp(0, 0, 40);
  assert.equal(gesture.pointerDown(2, 2, 180).type, 'pending-double');
  assert.equal(gesture.pointerUp(2, 2, 220).type, 'double-click');
  assert.equal(gesture.expire(600), null);
});

test('moving past the slop or holding too long cancels the click', () => {
  const dragged = createGestureRecognizer();
  dragged.pointerDown(0, 0, 0);
  assert.equal(dragged.pointerMove(6, 0).type, 'drag-start');
  assert.equal(dragged.pointerUp(12, 0, 80).type, 'drag-end');
  assert.equal(dragged.expire(400), null);
  const held = createGestureRecognizer();
  held.pointerDown(0, 0, 0);
  assert.equal(held.pointerUp(1, 0, 200).type, 'cancel');
});
