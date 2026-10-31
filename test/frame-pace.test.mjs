import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFramePace } from '../src/runtime/frame-pace.mjs';

test('idle pacing draws once per interval and does not burst after a hitch', () => {
  const pace = createFramePace();
  let draws = 0;
  for (let i = 0; i < 3; i++) {
    const decision = pace.consume(10, false);
    assert.equal(decision.draw, false);
  }
  assert.equal(pace.consume(10, false).draw, true);
  draws++;
  const hitch = pace.consume(100, false);
  assert.equal(hitch.draw, true);
  assert.ok(hitch.step <= 50);
  draws++;
  assert.equal(pace.consume(1, false).draw, false);
  assert.equal(draws, 2);
});

test('presented intervals drop the first gap and forget samples older than one minute', () => {
  const pace = createFramePace({ sampleWindowMs: 60000 });
  pace.present(0);
  pace.present(33);
  for (let t = 66; t <= 363; t += 33) pace.present(t);
  const early = pace.snapshot(363);
  assert.equal(early.count, 10);
  assert.equal(early.median, 33);
  assert.equal(early.p95, 33);
  assert.deepEqual(pace.snapshot(70000), { count: 0, median: null, p95: null });
});
