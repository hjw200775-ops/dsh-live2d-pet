import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeTargets, defaultWardrobe, normalizeWardrobe } from '../src/runtime/wardrobe.mjs';

test('work state changes only its temporary key and leaves the saved outfit', () => {
  const look = { ...defaultWardrobe(), body: 'type2', glasses: 'frame', skirt: true };
  const thinking = composeTargets(look, 'thinking');
  assert.equal(thinking.Clothes2, 1);
  assert.equal(thinking.key11, 1);
  assert.equal(thinking.key12, 0);
  assert.equal(thinking.Clothes1, 0);
  assert.equal(composeTargets(defaultWardrobe()).Clothes1, 1);
  assert.equal(thinking.Clothes5, 1);
  assert.equal(composeTargets({ ...look, tail: true, lean: true }).Clothes5, 0);
  assert.equal(composeTargets({ ...look, tail: true, lean: true }).LeanInput, -30);
  assert.equal(composeTargets(defaultWardrobe()).LeanInput, 0);
  assert.equal(thinking.key8, 1);
  assert.equal(thinking.key7, 0);
  const idle = composeTargets(look, 'idle');
  assert.equal(idle.key8, 0);
  assert.equal(idle.Clothes2, 1);
});

test('eye and glasses choices are mutually exclusive and unknown values reset', () => {
  const look = normalizeWardrobe({ eyes: 'heart', glasses: 'monocle', body: 'nope', bunny: true });
  assert.equal(look.body, 'default');
  assert.equal(look.bunny, true);
  const values = composeTargets(look, 'answering');
  assert.equal(values.key4, 1);
  assert.equal(values.key3, 0);
  assert.equal(values.key12, 1);
  assert.equal(values.key11, 0);
  assert.equal(values.key7, 1);
});
