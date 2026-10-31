export function wakeWindow({ userHidden = false } = {}) {
  return { reposition: true, show: userHidden !== true };
}

export function rendererRecovery(reason, attempts = 0) {
  if (reason === 'clean-exit') return 'ignore';
  if (attempts >= 1) return 'stop';
  return 'reload';
}

export function acceptPetIpc(sender, pet) {
  return sender != null && pet != null && sender === pet;
}
