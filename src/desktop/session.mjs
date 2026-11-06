export function wakeWindow({ userHidden = false } = {}) {
  return { reposition: true, show: userHidden !== true };
}

// A wall-clock gap can include time spent asleep. It is a recovery hint, not
// an unlock signal, and can also result from a stalled process or a clock jump.
export function createResumeGapDetector(now = Date.now) {
  let previous = now();
  return () => {
    const current = now();
    const gap = current - previous;
    previous = current;
    return gap >= 3000;
  };
}

export function rendererRecovery(reason, attempts = 0) {
  if (reason === 'clean-exit') return 'ignore';
  if (attempts >= 1) return 'stop';
  return 'reload';
}

export function acceptPetIpc(sender, pet) {
  return sender != null && pet != null && sender === pet;
}
