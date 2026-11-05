import { seededRandom } from './noise.mjs';

// Only uses the model's existing Grass/Finger clips and expression keys.
export function thinkingHand(mode, phase) {
  return mode !== 'thinking' || phase === 'waiting' ? 'default' : phase === 'deep' ? 'finger' : 'grass';
}
export function handReturn(hand) {
  return { finger: 'FingerBack', grass: 'GrassBack' }[hand] || null;
}
export function handEntry(hand) {
  return { finger: 'FingerOut', grass: 'GrassOut' }[hand] || null;
}

export const LONG_THINKING_TIMING = {
  firstMin: 14, firstMax: 22, cooldownMin: 18, cooldownMax: 32,
  durationMin: 2.8, durationMax: 3.8,
};

export function createThinkingFace({ seed = 47 } = {}) {
  const random = seededRandom(seed);
  const between = (min, max) => min + random() * (max - min);
  let previous = null, elapsed = 0, active = null, lastPreset = null, repeats = 0;
  let nextAt = between(LONG_THINKING_TIMING.firstMin, LONG_THINKING_TIMING.firstMax);
  const values = { key7: 0, key13: 0, key3: 0, key5: 0, key1: 0, key8: 0 };
  const reset = () => {
    elapsed = 0; active = null;
    nextAt = between(LONG_THINKING_TIMING.firstMin, LONG_THINKING_TIMING.firstMax);
  };
  return {
    valueAt(time, phase, blocked = false) {
      if (!Number.isFinite(time)) return {};
      const dt = previous === null ? 0 : Math.max(0, Math.min(.05, time - previous));
      previous = time;
      const eligible = phase === 'normal' || phase === 'deep';
      // Waiting/idle starts a new attention episode. No time-based inference of
      // deeper reasoning, no catching up while hidden, and no burst under locks.
      if (!eligible) {
        if (elapsed || active) reset();
      } else if (!blocked) elapsed += dt;
      if (blocked && active) {
        active = null;
        nextAt = elapsed + between(LONG_THINKING_TIMING.cooldownMin, LONG_THINKING_TIMING.cooldownMax);
      }
      if (active && elapsed >= active.end) {
        active = null;
        nextAt = elapsed + between(LONG_THINKING_TIMING.cooldownMin, LONG_THINKING_TIMING.cooldownMax);
      }
      if (eligible && !blocked && !active && elapsed >= nextAt) {
        // Random choice with at most two identical bursts in succession.
        let preset = random() < .5 ? 'spiral' : 'squeezed';
        if (preset === lastPreset && repeats >= 1) preset = preset === 'spiral' ? 'squeezed' : 'spiral';
        repeats = preset === lastPreset ? repeats + 1 : 0;
        lastPreset = preset;
        active = { preset, start: elapsed,
          end: elapsed + between(LONG_THINKING_TIMING.durationMin, LONG_THINKING_TIMING.durationMax),
          spin: between(.65, 1.05) };
      }
      const target = { key7: phase === 'normal' ? .24 : 0, key13: phase === 'deep' ? .6 : 0, key3: 0, key5: 0, key1: 0, key8: 0 };
      if (active) {
        target.key7 = 0;
        target.key8 = 1;
        target.key3 = active.preset === 'spiral' ? 1 : 0;
        target.key13 = active.preset === 'spiral' ? 1 : 0;
        target.key5 = active.preset === 'squeezed' ? 1 : 0;
        target.key1 = active.preset === 'squeezed' ? .8 : 0;
      }
      for (const id of Object.keys(values)) {
        // Let the loading face arrive after the eye expression.
        const tau = id === 'key8' && target.key8 > 0 ? .55 : .3;
        values[id] += ((blocked ? 0 : target[id]) - values[id]) * (1 - Math.exp(-dt / tau));
        if (Math.abs(values[id]) < 1e-7) values[id] = 0;
      }
      if (blocked) return {};
      return { ...values, ...(active ? { Param140: ((elapsed - active.start) * active.spin) % 1 } : {}) };
    },
    snapshot() { return { preset: active?.preset || null, elapsed, nextAt, end: active?.end || null }; },
  };
}

// Read the exact end pose from shipped return clips, rather than guessing arm
// values or changing model bindings. Only these existing hand channels are used.
export async function loadThinkingHandReturns(entryUrl, fetchImpl = fetch) {
  const response = await fetchImpl(entryUrl);
  if (!response.ok) throw new Error('Cannot read hand motion catalog');
  const entry = await response.json();
  const allowed = new Set(['Movement1','Movement3','Param56','Param57','Param40','Param36','Param39','Param41','Param42','Param43']);
  const targets = {};
  for (const group of ['GrassBack','FingerBack']) {
    const file = entry.FileReferences?.Motions?.[group]?.[0]?.File;
    if (!file) continue;
    const motionResponse = await fetchImpl(new URL(file, entryUrl));
    if (!motionResponse.ok) throw new Error('Cannot read return hand pose');
    const motion = await motionResponse.json();
    for (const curve of motion.Curves || []) {
      const last = curve.Segments?.at(-1);
      if (curve.Target === 'Parameter' && allowed.has(curve.Id) && Number.isFinite(last)) targets[curve.Id] = last;
    }
  }
  return targets;
}
