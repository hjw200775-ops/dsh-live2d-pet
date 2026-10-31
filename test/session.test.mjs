import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptPetIpc, rendererRecovery, wakeWindow } from '../src/desktop/session.mjs';

test('waking shows the pet again unless the user hid it', () => {
  assert.deepEqual(wakeWindow({ userHidden: false }), { reposition: true, show: true });
  assert.deepEqual(wakeWindow({ userHidden: true }), { reposition: true, show: false });
});

test('a crashed renderer reloads once and a clean exit does not', () => {
  assert.equal(rendererRecovery('crashed', 0), 'reload');
  assert.equal(rendererRecovery('crashed', 1), 'stop');
  assert.equal(rendererRecovery('clean-exit', 0), 'ignore');
});

test('only the pet window may drive desktop controls', () => {
  const pet = { id: 1 };
  assert.equal(acceptPetIpc(pet, pet), true);
  assert.equal(acceptPetIpc({ id: 2 }, pet), false);
  assert.equal(acceptPetIpc(null, pet), false);
});
