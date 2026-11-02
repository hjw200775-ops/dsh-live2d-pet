/**
 * 呼吸层：模型自带 ParamBreath，但 IDLE 动作里没有它的曲线 —— 这个参数本来就是留给运行时驱动的。
 * 用它做一个缓慢的起伏，静止时人物才不会像张图片。
 */
export const BREATH_PERIOD = 4.2; // 秒，约每分钟 14 次，接近放松状态

const frequency = (1 / 3.6 + 1 / 4.8) / 2;
const drift = (1 / 3.6 - 1 / 4.8) / 2;

export function breathPeriodAt(time) {
  return 1 / (frequency + drift * Math.sin((Number.isFinite(time) ? time : 0) / 23));
}

export function breathValue(time, { period, low = 0.15, high = 0.85 } = {}) {
  if (!Number.isFinite(time)) return low;
  // 积分瞬时频率，不能直接 time / 当前周期，否则周期漂移会造成相位跳动。
  // 显式 period 仍支持固定周期，便于调用者控制。
  const cycles = period > 0 && Number.isFinite(period)
    ? time / period
    : time * frequency + drift * 23 * (1 - Math.cos(time / 23));
  const phase = ((cycles % 1) + 1) % 1;
  // 吸得快、呼得慢，比纯正弦自然一点
  const shape = Math.sin(phase * Math.PI * 2 - Math.PI / 2);
  const eased = (shape + 1) / 2;
  return low + (high - low) * (0.55 * eased + 0.45 * eased * eased);
}
