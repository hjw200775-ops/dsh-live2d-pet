/** Existing model clips for clicks. Escape stays manual because it runs about 13 seconds. */
export function clickMotionGroups(kind, { mode = 'idle', locked = false } = {}) {
  if (locked || mode === 'answering') return null;
  if (kind === 'head') return ['FingerOut', 'FingerBack'];
  if (kind === 'body') return ['GrassOut', 'GrassBack'];
  return null;
}

export function clickMotionWait(group, index) {
  if (group === 'GrassOut') return 1500;
  if (group === 'GrassBack') return 1300;
  return index === 0 ? 2000 : 1300;
}

/** One short clip after she has been idle. It does not repeat while the clip is playing. */
export function idleVarietyGroups(elapsed, { mode = 'idle', locked = false, dragging = false, seed = 0 } = {}) {
  if (locked || dragging || mode !== 'idle' || !(elapsed >= 16000)) return null;
  return seed % 2 === 0 ? ['FingerOut', 'FingerBack'] : ['GrassOut', 'GrassBack'];
}
