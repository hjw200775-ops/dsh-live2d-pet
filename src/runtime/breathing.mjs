/**
 * 呼吸层：模型自带 ParamBreath，但 IDLE 动作里没有它的曲线 —— 这个参数本来就是留给运行时驱动的。
 * 用它做一个缓慢的起伏，静止时人物才不会像张图片。
 */
export const BREATH_PERIOD = 4.2; // 秒，约每分钟 14 次，接近放松状态

export function breathValue(time, { period = BREATH_PERIOD, low = 0.15, high = 0.85 } = {}) {
  if (!Number.isFinite(time)) return low;
  const phase = ((time % period) + period) % period / period;
  // 吸得快、呼得慢，比纯正弦自然一点
  const shape = Math.sin(phase * Math.PI * 2 - Math.PI / 2);
  const eased = (shape + 1) / 2;
  return low + (high - low) * (0.55 * eased + 0.45 * eased * eased);
}
