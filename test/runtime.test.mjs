import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrawableColor } from '../src/runtime/drawable-color.mjs';
import { attachMotionPolicy } from '../src/runtime/motion-policy.mjs';

test('nose screen color is scaled by the atlas alpha', () => {
  const opaque = applyDrawableColor([0, 0, 0], 1, [0, 0, 0], [1, 0.965, 0.961]);
  assert.ok(opaque.every((channel, index) => Math.abs(channel - [1, 0.965, 0.961][index]) < 1e-6));
  const soft = applyDrawableColor([0, 0, 0], 0.2, [0, 0, 0], [1, 0.965, 0.961]);
  assert.ok(soft.every((channel, index) => Math.abs(channel - [0.2, 0.193, 0.1922][index]) < 1e-3));
  const unchanged = applyDrawableColor([0.2, 0.4, 0.6], 1, [1, 1, 1], [0, 0, 0]);
  assert.deepEqual(unchanged.map(n => +n.toFixed(5)), [0.2, 0.4, 0.6]);
});

test('motion policy crossfades and loops only the idle group', () => {
  const started = [];
  const motionManager = {
    groups: { idle: 'Idle' },
    queueManager: { startMotion(motion, autoDelete, now) { started.push({ motion, autoDelete, now }); return 7; } },
    createMotion(data, group) {
      return {
        group, loop: null, seen: [],
        setIsLoop(value) { this.loop = value; },
        setFinishedMotionHandler() {},
        updateParameters(model, entry, time) { this.seen.push(time); },
      };
    },
  };
  let stopped = false;
  motionManager.queueManager.stopAllMotions = () => { stopped = true; };
  attachMotionPolicy(motionManager);
  const idle = motionManager.createMotion({}, 'Idle');
  const answer = motionManager.createMotion({}, 'Answering');
  assert.equal(idle.loop, true);
  assert.equal(answer.loop, false);
  const handle = motionManager._startMotion(answer, () => {});
  assert.equal(handle, 7);
  assert.equal(stopped, false);
  assert.equal(started[0].motion, answer);
  assert.equal(started[0].autoDelete, false);
});
