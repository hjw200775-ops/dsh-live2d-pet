/**
 * 视线漂移：待机时眼珠不是死的，也不是精确正弦，而是每隔一两秒换一个目标点、平滑过去。
 * 用固定种子的伪随机，测试里可以复现。
 */
function lcg(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createGaze({ seed = 7, minHold = 1.6, maxHold = 4.2, range = 0.32 } = {}) {
  const rand = lcg(seed);
  let from = { x: 0, y: 0 };
  let to = { x: 0, y: 0 };
  let startedAt = 0;
  let holdUntil = minHold;

  return {
    valueAt(time) {
      if (!Number.isFinite(time)) return { x: 0, y: 0 };
      if (time >= holdUntil) {
        from = to;
        startedAt = holdUntil;
        to = { x: (rand() * 2 - 1) * range, y: (rand() * 2 - 1) * range * 0.6 };
        holdUntil = time + minHold + rand() * (maxHold - minHold);
      }
      const span = Math.max(0.001, holdUntil - startedAt);
      const t = Math.min(1, Math.max(0, (time - startedAt) / span));
      const eased = t * t * (3 - 2 * t);
      return {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      };
    },
  };
}
