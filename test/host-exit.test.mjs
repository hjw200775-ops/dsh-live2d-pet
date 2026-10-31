import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostExitDecision } from '../src/runtime/host-exit.mjs';
import { sanitizeDesktopPreferences } from '../src/desktop/preferences.mjs';

test('the pet stays up until the host was connected and then stays away', () => {
  assert.deepEqual(hostExitDecision({ quitWithHost: true, seenHost: false, connected: false, now: 1000 }), { quit: false, pendingSince: null, seenHost: false });
  assert.deepEqual(hostExitDecision({ quitWithHost: false, seenHost: true, connected: false, now: 1000 }), { quit: false, pendingSince: null, seenHost: true });
  const pending = hostExitDecision({ quitWithHost: true, seenHost: true, connected: false, now: 1000 });
  assert.equal(pending.quit, false);
  assert.equal(pending.pendingSince, 1000);
  assert.equal(hostExitDecision({ quitWithHost: true, seenHost: true, connected: false, pendingSince: 1000, now: 9000 }).quit, true);
  assert.equal(hostExitDecision({ quitWithHost: true, seenHost: true, connected: true, pendingSince: 1000, now: 9000 }).pendingSince, null);
});

test('quit-with-host stays off unless the saved value is exactly true', () => {
  assert.equal(sanitizeDesktopPreferences({}).quitWithHost, false);
  assert.equal(sanitizeDesktopPreferences({ quitWithHost: true }).quitWithHost, true);
  assert.equal(sanitizeDesktopPreferences({ quitWithHost: 'yes' }).quitWithHost, false);
});
