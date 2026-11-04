import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authorizeRealChat, readStoredChat, REAL_CHAT_ENV } from '../../src/features/chat/authorization.mjs';
import { defaultChatPreferences } from '../../src/features/chat/config.mjs';

const fakeModel = { get: () => ({ provider: 'fake-provider', model: 'fake-model' }) };
const fakeLlm = { stream: () => (async function* () { yield { type: 'finish', reason: { kind: 'ok' } }; })() };

async function dirWith(t, chat) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'preferences.desktop.json'), JSON.stringify({ version: 1, chat }), 'utf8');
  return dir;
}

const fullConsent = { enabled: true, backend: 'host', realConsent: true, mode: 'pet' };

test('读取保存的 chat 配置；文件缺失时返回安全默认值', async t => {
  const dir = await dirWith(t, fullConsent);
  assert.equal((await readStoredChat(dir)).realConsent, true);
  assert.deepEqual(await readStoredChat(path.join(dir, 'missing')), defaultChatPreferences());
});

test('五个条件全部满足才允许真实调用', async t => {
  const dir = await dirWith(t, fullConsent);
  const auth = await authorizeRealChat({ configDir: dir, llm: fakeLlm, agentDefaultModel: fakeModel, env: { [REAL_CHAT_ENV]: '1' } });
  assert.equal(auth.ok, true);
  assert.equal(auth.model.provider, 'fake-provider');
});

test('逐条缺失都拒绝：backend / consent / mode / env / model', async t => {
  const cases = [
    [{ ...fullConsent, backend: 'simulated' }, { [REAL_CHAT_ENV]: '1' }, 'backend-not-host'],
    [{ ...fullConsent, realConsent: false }, { [REAL_CHAT_ENV]: '1' }, 'no-user-consent'],
    [{ ...fullConsent, mode: 'follow' }, { [REAL_CHAT_ENV]: '1' }, 'mode-not-pet'],
    [fullConsent, {}, 'env-disabled'],
  ];
  for (const [chat, env, reason] of cases) {
    const dir = await dirWith(t, chat);
    const auth = await authorizeRealChat({ configDir: dir, llm: fakeLlm, agentDefaultModel: fakeModel, env });
    assert.equal(auth.ok, false, reason);
    assert.ok(auth.reasons.includes(reason), `${reason}: ${auth.reasons}`);
  }

  const dir = await dirWith(t, fullConsent);
  const noModel = await authorizeRealChat({ configDir: dir, llm: fakeLlm, agentDefaultModel: null, env: { [REAL_CHAT_ENV]: '1' } });
  assert.equal(noModel.ok, false);
  assert.ok(noModel.reasons.includes('model-unavailable'));
});

test('没有模型服务时也拒绝（即使其它条件满足）', async t => {
  const dir = await dirWith(t, fullConsent);
  const auth = await authorizeRealChat({ configDir: dir, llm: {}, agentDefaultModel: fakeModel, env: { [REAL_CHAT_ENV]: '1' } });
  assert.equal(auth.ok, false);
  assert.ok(auth.reasons.includes('llm-unavailable'));
});
