/** Draw pacing and presented-frame intervals. RAF wakeups are not samples. */
export function createFramePace({ idleMs = 33, activeMs = 16, sampleWindowMs = 60000 } = {}) {
  let debt = 0;
  let lastPresented = null;
  let droppedFirst = false;
  const samples = [];
  const trim = now => {
    const cutoff = now - sampleWindowMs;
    while (samples.length && samples[0].now < cutoff) samples.shift();
  };
  return {
    consume(dt, active) {
      const interval = active ? activeMs : idleMs;
      const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
      debt += elapsed;
      if (debt < interval) return { draw: false, step: 0, wait: interval - debt };
      const step = Math.min(debt, 50);
      const leftover = debt - interval;
      debt = leftover > 0 && leftover < interval ? leftover : 0;
      return { draw: true, step, wait: interval - debt };
    },
    present(now) {
      if (lastPresented == null) { lastPresented = now; return; }
      const gap = now - lastPresented;
      lastPresented = now;
      if (!droppedFirst) { droppedFirst = true; return; }
      samples.push({ now, gap });
      trim(now);
    },
    snapshot(now = 0) {
      trim(now);
      if (!samples.length) return { count: 0, median: null, p95: null };
      const gaps = samples.map(sample => sample.gap).sort((a, b) => a - b);
      const pick = p => gaps[Math.min(gaps.length - 1, Math.max(0, Math.ceil(gaps.length * p) - 1))];
      return { count: gaps.length, median: pick(0.5), p95: pick(0.95) };
    },
  };
}
