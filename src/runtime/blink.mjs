import { seededRandom, smoothstep } from './noise.mjs';

export const BLINK_SECONDS = 0.16;
export const DOUBLE_BLINK_GAP = 0.1;

export function nextBlink(random) {
  return { interval: 2 + random() * 4, count: random() < 0.2 ? 2 : 1 };
}

function openness(time) {
  if (time < 0 || time >= BLINK_SECONDS) return 1;
  return time < 0.07 ? 1 - smoothstep(time / 0.07) : smoothstep((time - 0.07) / 0.09);
}

// 时间单位为秒；跳过隐藏期间错过的眨眼，不在恢复时追赶补播。
export function createBlink({ seed = 17 } = {}) {
  const random = seededRandom(seed);
  let scheduled = null;
  let start = 0;
  return {
    valueAt(time, enabled = true) {
      if (!Number.isFinite(time)) return 1;
      if (!enabled) { scheduled = null; return 1; }
      if (!scheduled) { scheduled = nextBlink(random); start = time + scheduled.interval; }
      const elapsed = time - start;
      const duration = scheduled.count * BLINK_SECONDS + (scheduled.count - 1) * DOUBLE_BLINK_GAP;
      if (elapsed >= duration) {
        scheduled = nextBlink(random);
        start = time + scheduled.interval;
        return 1;
      }
      if (elapsed < BLINK_SECONDS) return openness(elapsed);
      return scheduled.count === 2 ? openness(elapsed - BLINK_SECONDS - DOUBLE_BLINK_GAP) : 1;
    },
  };
}
