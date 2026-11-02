import { noise1D, seededRandom, smoothstep } from './noise.mjs';

export function createWeightShift({ seed = 29 } = {}) {
  const random = seededRandom(seed);
  let nextAt = 8 + random() * 12;
  let startedAt = 0;
  let from = 0;
  let target = 0;
  const valueAt = time => from + (target - from) * smoothstep((time - startedAt) / 2);
  return {
    valueAt(time) {
      if (!Number.isFinite(time)) return { AngleZ: 0, PositionX: 0 };
      // 按事件时间推进，稀疏采样与逐帧采样结果一致。
      while (time >= nextAt) {
        from = valueAt(nextAt);
        startedAt = nextAt;
        target = random() * 2 - 1;
        nextAt += 8 + random() * 12;
      }
      const value = valueAt(time);
      return { AngleZ: value * 1.4, PositionX: value * 0.012 };
    },
  };
}

// 只累积待机时间；启停用包络淡入淡出，所有输出都是增量。
export function createIdleMotion({ seed = 31 } = {}) {
  const shift = createWeightShift({ seed });
  let previous = null;
  let elapsed = 0;
  let weight = 0;
  return {
    valueAt(time, enabled = true) {
      if (!Number.isFinite(time)) return {};
      const dt = previous === null ? 0 : Math.max(0, Math.min(0.05, time - previous));
      previous = time;
      if (enabled) elapsed += dt;
      weight = Math.max(0, Math.min(1, weight + (enabled ? 1 : -1) * dt / 0.4));
      const values = {
        AngleX: noise1D(elapsed / 5, seed + 1) * 1.8,
        AngleY: noise1D(elapsed / 6, seed + 2) * 1.2,
        ...shift.valueAt(elapsed),
      };
      return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, value * smoothstep(weight)]));
    },
  };
}
