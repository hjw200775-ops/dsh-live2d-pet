import { seededRandom, smoothstep } from './noise.mjs';

export const LEG_SHAKE_PARAMETER = 'LEGAngleZ2';
export const LEG_SHAKE_LIMIT = 3.8;

// LEGAngleZ2 is the model's paired-leg Z control. Physics normally writes it from
// HipAngleX/PositionZ, so the renderer applies this additive tremor after physics.
export function createLegShake({
  seed = 83,
  firstMin = 12,
  firstSpan = 6,
  gapMin = 18,
  gapSpan = 14,
} = {}) {
  const random = seededRandom(seed);
  let nextAt = null;
  let previous = null;
  let active = null;
  let shown = 0;

  const nextGap = () => gapMin + random() * gapSpan;
  const schedule = (time, recovery = false) => {
    nextAt = time + (recovery ? firstMin + random() * firstSpan : nextGap());
  };
  const begin = time => {
    const duration = 0.95 + random() * 0.4;
    const frequency = 4 + random() * 0.8;
    const cycles = Math.max(3, Math.round(duration * frequency));
    active = {
      start: time,
      end: time + duration,
      frequency: cycles / duration,
      amplitude: 3.1 + random() * (LEG_SHAKE_LIMIT - 3.1),
      phase: random() * Math.PI * 2,
    };
  };

  return {
    get shaking() { return shown > 1e-4 || active !== null; },
    get nextAt() { return nextAt; },
    get current() { return shown; },
    reset(time) {
      active = null;
      schedule(Number.isFinite(time) ? time : 0, true);
    },
    cancel(time) {
      active = null;
      schedule(Number.isFinite(time) ? time : 0, true);
    },
    trigger(time) {
      if (!Number.isFinite(time)) return false;
      active = null;
      begin(time);
      return true;
    },
    valueAt(time, enabled = true, { blocked = false } = {}) {
      if (!Number.isFinite(time)) return { [LEG_SHAKE_PARAMETER]: 0 };
      const dt = previous === null ? 0 : Math.max(0, Math.min(0.05, time - previous));
      previous = time;
      if (nextAt === null) schedule(time, true);

      let target = 0;
      if (!enabled || blocked) {
        if (active) {
          active = null;
          schedule(time);
        } else if (time >= nextAt) {
          // A missed slot is skipped rather than replayed when the interruption clears.
          schedule(time);
        }
      } else {
        if (active && time >= active.end) {
          const endedAt = active.end;
          active = null;
          schedule(endedAt);
        }
        if (!active && time >= nextAt) begin(time);
        if (active) {
          const progress = Math.max(0, Math.min(1, (time - active.start) / (active.end - active.start)));
          const envelope = smoothstep(progress / 0.16) * smoothstep((1 - progress) / 0.22);
          const first = Math.sin(progress * active.frequency * Math.PI * 2 + active.phase);
          const second = Math.sin(progress * active.frequency * Math.PI * 4 + active.phase * 0.45);
          target = (first * 0.92 + second * 0.08) * envelope * active.amplitude;
        }
      }

      // A short follower keeps interruption/state changes from removing the pose in one frame.
      shown += (target - shown) * (1 - Math.exp(-dt / 0.055));
      if (Math.abs(shown) < 1e-6) shown = 0;
      return { [LEG_SHAKE_PARAMETER]: shown };
    },
  };
}
