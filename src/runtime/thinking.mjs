import { seededRandom } from './noise.mjs';

// These are presentation phases supported by received application events, not
// estimates of the model's private cognitive state. Old senders safely wait.
export function thinkingPhase(value) {
  return ['normal', 'deep', 'waiting'].includes(value) ? value : 'waiting';
}

export const THINKING_LIMITS = { AngleX: 7, AngleY: 11, AngleZ: 6.5, PositionX: 2.6, ParamEyeBallX: .6, ParamEyeBallY: .55 };

export function createThinkingMotion({ seed = 43 } = {}) {
  const random = seededRandom(seed);
  const keys = Object.keys(THINKING_LIMITS);
  let previous = null, elapsed = 0, phase = '', target = {}, current = {};
  let side = 1;
  const next = { head: 0, gaze: 0, balance: 0 };
  // Separate random deadlines: the eyes can settle before the head, and body
  // weight changes more slowly. Targets stay inside the existing controller range.
  const choose = (kind, channel) => {
    const waiting = kind === 'waiting', deep = kind === 'deep';
    if (channel === 'head') {
      side = random() < .5 ? -1 : 1;
      const strength = .65 + random() * .25;
      Object.assign(target, {
        AngleX: side * strength * (waiting ? 1.4 : deep ? 2.2 : 7),
        AngleY: deep ? -8 - random() * 3 : waiting ? -.7 + random() * 1.4 : 1.2 + random() * 2,
        AngleZ: side * strength * (waiting ? 2.4 : deep ? 3.2 : 6.5),
      });
      next.head = elapsed + 3.2 + random() * 3.2;
    } else if (channel === 'gaze') {
      Object.assign(target, {
        ParamEyeBallX: side * (waiting ? .06 + random() * .08 : deep ? .04 + random() * .04 : .42 + random() * .16),
        ParamEyeBallY: waiting ? -.03 + random() * .08 : deep ? -.12 - random() * .08 : .35 + random() * .17,
      });
      next.gaze = elapsed + 1.8 + random() * 2.6;
    } else {
      // A soft counterbalance, with a smaller body shift during concentrated
      // downward attention; never drive head and body to their limits together.
      target.PositionX = -side * (.55 + random() * .3) * (waiting ? 1.8 : deep ? 1.5 : 2.6);
      next.balance = elapsed + 4.6 + random() * 3.8;
    }
  };
  return {
    valueAt(time, kind = null, { blocked = false, looking = false } = {}) {
      if (!Number.isFinite(time)) return {};
      const dt = previous === null ? 0 : Math.max(0, Math.min(.05, time - previous));
      previous = time;
      if (kind) kind = thinkingPhase(kind);
      if (kind && !blocked) elapsed += dt;
      if (kind !== phase) {
        phase = kind;
        target = {};
        for (const channel of Object.keys(next)) next[channel] = elapsed;
      }
      if (kind && !blocked) {
        for (const channel of Object.keys(next)) if (elapsed >= next[channel]) choose(kind, channel);
      }
      const result = {};
      for (const id of keys) {
        const gaze = id.startsWith('ParamEye');
        const wanted = kind && !blocked && !(looking && (gaze || id === 'AngleX' || id === 'AngleY')) ? target[id] || 0 : 0;
        const tau = !kind ? .3 : gaze ? .45 : id === 'PositionX' ? 1.7 : id === 'AngleY' ? 1.05 : .95;
        current[id] = (current[id] || 0) + (wanted - (current[id] || 0)) * (1 - Math.exp(-dt / tau));
        if (Math.abs(current[id]) < 1e-7) current[id] = 0;
        // Lock owners receive no writes; internal offsets still decay for release.
        if (!blocked) result[id] = current[id];
      }
      return result;
    },
  };
}
