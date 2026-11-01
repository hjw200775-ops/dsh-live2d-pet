/** Existing model clips for clicks. Escape stays manual because it runs about 13 seconds. */
export function clickMotionGroups(kind, { mode = 'idle', locked = false } = {}) {
  if (locked || mode === 'answering') return null;
  if (kind === 'head') return ['FingerOut', 'FingerBack'];
  if (kind === 'body') return ['GrassOut', 'GrassBack'];
  return null;
}

const AUTHORED_SECONDS = { Hello: 2300, Nod: 1700, Shake: 1900, Stretch: 3300 };

export function clickMotionWait(group, index) {
  if (group === 'GrassOut') return 1500;
  if (group === 'GrassBack') return 1300;
  if (AUTHORED_SECONDS[group]) return AUTHORED_SECONDS[group];
  return index === 0 ? 2000 : 1300;
}

/**
 * 待机一段时间后随机来一个小动作。
 *
 * 前四轮沿用原来的手指 / 狗尾巴草（保持老行为），之后轮流用代码生成的动作，
 * 这样长时间挂着不会总是那两个。
 */
export function idleVarietyGroups(elapsed, { mode = 'idle', locked = false, dragging = false, seed = 0 } = {}) {
  if (locked || dragging || mode !== 'idle' || !(elapsed >= 16000)) return null;
  if (seed < 4) return seed % 2 === 0 ? ['FingerOut', 'FingerBack'] : ['GrassOut', 'GrassBack'];
  const extra = (seed - 4) % 4;
  return [['Nod'], ['Hello'], ['Stretch'], ['Shake']][extra];
}
