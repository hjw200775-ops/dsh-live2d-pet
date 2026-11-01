/**
 * 每个动作组的淡入淡出（秒）。
 *
 * 之前所有组共用动作文件里写死的 0.25/0.25，导致「思考 → 回答」这种高频切换偏硬。
 * 规律：越接近"注意力转移"的切换越快，越接近"回到平静"的越慢。
 */
const FADES = {
  Idle: { in: 0.6, out: 0.6 },
  Thinking: { in: 0.45, out: 0.5 },
  Answering: { in: 0.2, out: 0.32 },
  Flinch: { in: 0.1, out: 0.45 },
  Return: { in: 0.35, out: 0.35 },
};

const DEFAULT_FADE = { in: 0.25, out: 0.25 };

export function fadeFor(group) {
  return FADES[group] ?? DEFAULT_FADE;
}

export function fadeTable() {
  return { ...FADES };
}
