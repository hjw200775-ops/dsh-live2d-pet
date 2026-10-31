import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBalance, formatBalance } from '../src/balance.mjs';

function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

test('balance keeps API amount strings and does not invent zero when the key or network fails', async () => {
  let now = 1_000;
  const calls = [];
  const balance = createBalance({
    now: () => now,
    ttlMs: 60_000,
    staleMs: 120_000,
    resolveKey: async () => ({ value: 'test-key-not-real' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      return jsonResponse(200, { is_available: true, balance_infos: [
        { currency: 'USD', total_balance: '1.50', granted_balance: '0.25', topped_up_balance: '1.25' },
        { currency: 'CNY', total_balance: '12.30', granted_balance: '2.00', topped_up_balance: '10.30' },
      ] });
    },
  });
  const ready = await balance.refresh(true);
  assert.equal(formatBalance(ready), '余额 ¥12.30');
  assert.equal(ready.accounts[1].total, '12.30');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization.includes('test-key-not-real'), true);
  now += 10_000;
  await balance.refresh(false);
  assert.equal(calls.length, 1);
  balance.resolveKey = async () => null;
});

test('missing key, rejected key, and network loss stay distinct from a zero balance', async () => {
  let key = '';
  let fail = false;
  const balance = createBalance({
    now: () => 5_000,
    resolveKey: async () => (key ? { value: key } : null),
    fetchImpl: async () => { if (fail) throw new Error('offline'); return jsonResponse(401, {}); },
  });
  assert.equal(formatBalance(await balance.refresh(true)), '未配置密钥');
  key = 'rejected';
  assert.equal(formatBalance(await balance.refresh(true)), '密钥无效');
  assert.equal(JSON.stringify(balance.snapshot()).includes('0.00'), false);
  fail = true;
  key = 'later';
  const offline = createBalance({
    now: () => 5_000,
    resolveKey: async () => ({ value: 'later' }),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(formatBalance(await offline.refresh(true)), '余额网络失败');
  assert.equal(JSON.stringify(offline.snapshot()).includes('0.00'), false);
});
