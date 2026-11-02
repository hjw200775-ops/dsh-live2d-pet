import { seededRandom, smoothstep } from './noise.mjs';

// 待机久了偶尔换重心，缓慢左右摆一轮；只驱动现有身体控制器，不伪造单脚跺地。
export function createRestSway({ seed = 47 } = {}) {
  const random = seededRandom(seed);
  let start, duration, direction, amplitude;
  const choose = () => {
    duration = 7 + random() * 2;
    direction = random() < 0.5 ? -1 : 1;
    amplitude = 0.85 + random() * 0.15;
  };
  const reset = () => { start = 25 + random() * 10; choose(); };
  reset();
  return {
    reset,
    valueAt(time) {
      if (!Number.isFinite(time)) return { PositionX:0, PositionZ:0, AngleZ:0 };
      while (time >= start + duration) { start += duration + 35 + random() * 20; choose(); }
      if (time <= start) return { PositionX:0, PositionZ:0, AngleZ:0 };
      const t = (time - start) / duration;
      // 对称轨迹、首尾归零，避免每次摆动都往同一侧积累偏置。
      const shape = t < 0.25 ? smoothstep(t / 0.25)
        : t < 0.75 ? 1 - 2 * smoothstep((t - 0.25) / 0.5)
        : -1 + smoothstep((t - 0.75) / 0.25);
      const lean = shape * direction * amplitude;
      return { PositionX:lean * 5.5, PositionZ:-lean * 6.5, AngleZ:lean };
    },
  };
}
