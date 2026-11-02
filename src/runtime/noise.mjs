// 无查表循环的一维值噪声。每个整数格点独立散列，五次插值保证边界斜率连续。
export function seededRandom(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function smoothstep(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function lattice(index, seed) {
  let h = (index | 0) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

export function noise1D(time, seed = 7) {
  if (!Number.isFinite(time)) return 0;
  const index = Math.floor(time);
  const a = lattice(index, seed);
  return a + (lattice(index + 1, seed) - a) * smoothstep(time - index);
}
