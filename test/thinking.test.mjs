import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThinkingMotion, THINKING_LIMITS } from '../src/runtime/thinking.mjs';
import { createActivity, createDesktopLink } from '../src/activity.js';

test('thinking phases reflect events, publish within same mode, and omit private content', () => {
  const hub = createActivity();
  const agent = { id: 'a' };
  const chunk = c => hub.receive('agent/assistant-stream', { agent, frame: { type: 'chunk', chunk: c } });
  hub.receive('agent/status', { agent, status: 'running' });
  assert.equal(hub.snapshot().thinkingPhase, 'waiting');
  const seq = hub.snapshot().seq;
  chunk({ type: 'reasoning-delta', text: 'private' });
  assert.equal(hub.snapshot().thinkingPhase, 'deep');
  assert.ok(hub.snapshot().seq > seq);
  chunk({ type: 'tool-call-delta' });
  assert.equal(hub.snapshot().thinkingPhase, 'normal');
  chunk({ type: 'finish', reason: { kind: 'stop' } });
  assert.equal(hub.snapshot().thinkingPhase, 'waiting');
  chunk({ type: 'text-delta', text: 'private' });
  assert.equal(hub.snapshot().mode, 'answering');
  assert.equal(hub.snapshot().thinkingPhase, null);
  assert.equal(JSON.stringify(hub.history()).includes('private'), false);
  hub.receive('agent/status', { agent, status: 'idle' });
  assert.equal(hub.snapshot().mode, 'idle');
  hub.dispose();
});

test('legacy and invalid bridge phases wait; disconnect clears activity', async t => {
  const link = createDesktopLink({ staleMs: 20 }); t.after(() => link.dispose());
  for (const phase of [undefined, 'invented', 'deep', 'normal', 'waiting']) {
    link.ingest({ mode: 'thinking', thinkingPhase: phase });
    assert.equal(link.snapshot().thinkingPhase, ['deep','normal'].includes(phase) ? phase : 'waiting');
  }
  await new Promise(r => setTimeout(r, 40));
  assert.equal(link.snapshot().mode, 'idle');
  assert.equal(link.snapshot().thinkingPhase, null);
});

test('ten-minute randomized thinking stays bounded and continuous, yields locks and returns to zero', () => {
  const motion = createThinkingMotion({ seed: 12 });
  let previous = {}, changed = false;
  const samples = [];
  for (let i = 0; i < 36000; i++) {
    const phase = ['normal','deep','waiting'][Math.floor(i / 1200) % 3];
    const values = motion.valueAt(i / 60, phase);
    for (const [id, limit] of Object.entries(THINKING_LIMITS)) {
      assert.ok(Math.abs(values[id]) <= limit + 1e-8);
      assert.ok(Math.abs(values[id] - (previous[id] || 0)) <= .4, id);
    }
    changed ||= Math.abs(values.AngleZ - (previous.AngleZ || 0)) > .001;
    if (i % 240 === 0) samples.push(values.AngleX);
    previous = values;
  }
  assert.ok(changed);
  assert.ok(new Set(samples.map(x => x.toFixed(3))).size > 100, 'no four-second repetition');
  assert.deepEqual(motion.valueAt(600, 'deep', { blocked: true }), {});
  let values;
  for (let i = 1; i < 300; i++) values = motion.valueAt(600 + i / 60, null);
  for (const value of Object.values(values)) assert.ok(Math.abs(value) < 1e-6);
});

test('active pointer takes gaze and head orientation while leaving low balance motion', () => {
  const motion = createThinkingMotion();
  let values;
  for (let i=0;i<600;i++) values=motion.valueAt(i/60,'normal',{looking:true});
  assert.equal(values.AngleX,0); assert.equal(values.AngleY,0);
  assert.equal(values.ParamEyeBallX,0); assert.equal(values.ParamEyeBallY,0);
  assert.ok(Math.abs(values.AngleZ)>0);
});
