import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authoredMotion, flinchMotion, thinkingPose } from '../src/runtime/authored-motions.mjs';

test('the error flinch returns to rest and does not wag the head sideways', () => {
  const flinch = flinchMotion();
  assert.equal(flinch.Meta.Loop, false);
  assert.equal(flinch.Curves.some(curve => curve.Id === 'ParamAngleX'), false);
  assert.equal(flinch.Curves.find(curve => curve.Id === 'ParamAngleZ').Segments.at(-1), 0);
  assert.equal(authoredMotion('missing.motion3.json'), null);
  assert.ok(thinkingPose(650).angleY > 0);
  assert.ok(thinkingPose(1950).angleY < 0);
  assert.equal(thinkingPose(2600).angleY, 0);
  assert.equal(thinkingPose(8000).eyeY, 0);
});
