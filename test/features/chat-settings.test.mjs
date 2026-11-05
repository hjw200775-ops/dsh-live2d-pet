import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatSettings } from '../../src/features/chat/chat-settings.mjs';
import { defaultChatPreferences, sanitizeChatPreferences } from '../../src/features/chat/config.mjs';

const base = { ...defaultChatPreferences(), enabled: true, backend: 'host', realConsent: true, mode: 'pet' };

function deferredStore(initial = base) {
  const pending = [];
  const store = createChatSettings({
    initial,
    save: next => new Promise(resolve => { pending.push({ next, resolve }); }),
  });
  return { store, pending };
}

test('保存失败：完整回滚 chat（不只恢复复选框）', async () => {
  const { store, pending } = deferredStore();
  const promise = store.update({ backend: 'simulated', mode: 'follow', persona: '新人格' });
  assert.equal(store.chat.backend, 'simulated', '内存先反映新值');
  await Promise.resolve();
  assert.equal(store.saving, true);
  pending[0].resolve(false);
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(store.chat.backend, 'host');
  assert.equal(store.chat.mode, 'pet');
  assert.equal(store.chat.persona, '');
  assert.equal(store.saving, false);
});

test('连续修改串行化：旧保存失败不回滚新设置', async () => {
  const { store, pending } = deferredStore();
  const first = store.update({ mode: 'follow' });
  const second = store.update({ persona: '第二个' });
  await Promise.resolve();
  pending[0].resolve(false);
  await first;
  pending[1].resolve(true);
  const result = await second;
  assert.equal(result.ok, true);
  assert.equal(store.chat.persona, '第二个');
  assert.equal(store.chat.mode, 'follow');
});

test('新设置以最后一次修改为准，旧保存成功也不覆盖', async () => {
  const { store, pending } = deferredStore();
  const first = store.update({ persona: '旧' });
  const second = store.update({ persona: '新' });
  await Promise.resolve();
  pending[0].resolve(true);
  await first;
  pending[1].resolve(true);
  await second;
  assert.equal(store.chat.persona, '新');
  assert.equal(pending[1].next.persona, '新');
});

test('撤销真实许可保存失败：标记 realCallRevoked，后续成功保存清除', async () => {
  const { store, pending } = deferredStore();
  const revoke = store.update({ realConsent: false });
  await Promise.resolve();
  pending[0].resolve(false);
  const result = await revoke;
  assert.equal(result.ok, false);
  assert.equal(store.realCallRevoked, true);
  assert.equal(store.chat.realConsent, true, '磁盘可能仍是旧授权，内存也必须保守');

  const retry = store.update({ realConsent: false });
  await Promise.resolve();
  pending[1].resolve(true);
  await retry;
  assert.equal(store.realCallRevoked, false);
  assert.equal(store.chat.realConsent, false);
});

test('保存期间 saving=true；保存完成后恢复', async () => {
  const { store, pending } = deferredStore();
  const promise = store.update({ enabled: false });
  await Promise.resolve();
  assert.equal(store.saving, true);
  pending[0].resolve(true);
  await promise;
  assert.equal(store.saving, false);
});

test('初始值经过 sanitize，未知字段被丢弃', () => {
  const store = createChatSettings({ initial: { ...base, evil: 'x' }, save: async () => true });
  assert.equal(Object.hasOwn(store.chat, 'evil'), false);
  assert.deepEqual(store.chat, sanitizeChatPreferences(base, defaultChatPreferences()));
});
