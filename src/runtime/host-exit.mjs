/** Decide whether the pet should exit after the host has actually gone away. */
export function hostExitDecision({ quitWithHost = false, seenHost = false, connected = true, pendingSince = null, now = 0, holdMs = 8000 } = {}) {
  if (connected === true) return { quit: false, pendingSince: null, seenHost: true };
  if (!seenHost) return { quit: false, pendingSince: null, seenHost: false };
  if (!quitWithHost) return { quit: false, pendingSince: null, seenHost: true };
  const since = pendingSince == null ? now : pendingSince;
  return { quit: now - since >= holdMs, pendingSince: since, seenHost: true };
}
