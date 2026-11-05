import { readFile } from 'node:fs/promises';

/** Push the reduced activity snapshot to the desktop pet. Missing bridge file means the pet is not running. */
export function startBridgePublisher({ activity, bridgeFile, balance, fetchImpl = fetch, intervalMs = 1000 }) {
  let timer;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const info = JSON.parse(await readFile(bridgeFile, 'utf8'));
      const port = Number(info.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof info.token !== 'string' || info.token.length < 16) return;
      const snap = activity.snapshot();
      const payload = { mode: snap.mode, thinkingPhase: snap.thinkingPhase, activeCount: snap.activeCount || 0 };
      if (balance) payload.balance = balance.snapshot();
      const response = await fetchImpl(`http://127.0.0.1:${port}/bridge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(800),
      });
      if (balance && response && response.ok && typeof response.json === 'function') {
        const reply = await response.json().catch(() => ({}));
        if (reply && reply.refresh) await balance.refresh(true);
      }
    } catch { /* The pet restarts on its own port; the next tick reconnects. */ }
  };
  const unsubscribe = activity.subscribe(() => { void tick(); });
  timer = setInterval(() => { void tick(); }, intervalMs);
  void tick();
  return () => { stopped = true; clearInterval(timer); unsubscribe(); };
}
