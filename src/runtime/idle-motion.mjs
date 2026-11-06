import { noise1D, seededRandom, smoothstep } from './noise.mjs';

const SHIFT_BLEND_SECONDS = 2.8;

export function createWeightShift({ seed = 29 } = {}) {
  const random = seededRandom(seed);
  let nextAt = 1.5 + random() * 1.8;
  let startedAt = 0;
  let from = 0;
  let target = 0;
  const valueAt = time => from + (target - from) * smoothstep((time - startedAt) / SHIFT_BLEND_SECONDS);
  return {
    valueAt(time) {
      if (!Number.isFinite(time)) return { AngleZ: 0, PositionX: 0 };
      // 按事件时间推进，稀疏采样与逐帧采样结果一致。
      while (time >= nextAt) {
        from = valueAt(nextAt);
        startedAt = nextAt;
        const candidate = (random() < .5 ? -1 : 1) * (.55 + random() * .45);
        target = Math.abs(candidate - from) < .4 ? -candidate : candidate;
        nextAt += 4.5 + random() * 4;
      }
      const value = valueAt(time);
      return { AngleZ: -value * 2.5, PositionX: value * 1.65 };
    },
  };
}

// 只累积待机时间；启停用包络淡入淡出，所有输出都是增量。
export function createIdleMotion({ seed = 31 } = {}) {
  const shift = createWeightShift({ seed });
  let previous = null;
  let elapsed = 0;
  let weight = 0;
  let attention = 0;
  return {
    valueAt(time, enabled = true, { looking = false } = {}) {
      if (!Number.isFinite(time)) return {};
      const dt = previous === null ? 0 : Math.max(0, Math.min(0.05, time - previous));
      previous = time;
      if (enabled) elapsed += dt;
      weight = Math.max(0, Math.min(1, weight + (enabled ? 1 : -1) * dt / 0.7));
      attention += ((looking ? 1 : 0) - attention) * (1 - Math.exp(-dt / .2));
      const headWeight = 1 - .8 * attention;
      const balance = shift.valueAt(elapsed);
      const values = {
        AngleX: noise1D(elapsed / 3.4, seed + 1) * 3.3 * headWeight,
        AngleY: noise1D(elapsed / 4.7, seed + 2) * 2.4 * headWeight,
        AngleZ: balance.AngleZ + noise1D(elapsed / 5.6, seed + 3) * .7,
        PositionX: balance.PositionX + noise1D(elapsed / 6.1, seed + 4) * .25,
      };
      return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, value * smoothstep(weight)]));
    },
  };
}
