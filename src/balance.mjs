const STATUSES = ['unconfigured', 'loading', 'available', 'insufficient', 'invalid', 'network', 'stale', 'expired'];

export function cleanBalance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = STATUSES.includes(raw.status) ? raw.status : 'network';
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).slice(0, 4).map(account => ({
    currency: String(account?.currency || '').slice(0, 8),
    total: String(account?.total || '').slice(0, 32),
    granted: String(account?.granted || '').slice(0, 32),
    toppedUp: String(account?.toppedUp || '').slice(0, 32),
  })).filter(account => account.currency && account.total);
  return {
    status,
    accounts,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    low: raw.low === true,
    noticeKey: String(raw.noticeKey || '').slice(0, 48),
  };
}

export function formatBalance(snapshot) {
  const balance = cleanBalance(snapshot);
  if (!balance) return '';
  const account = balance.accounts.find(item => item.currency === 'CNY') || balance.accounts[0];
  const amount = account ? `${account.currency === 'CNY' ? '¥' : account.currency === 'USD' ? '$' : account.currency + ' '}${account.total}` : '';
  if (balance.status === 'unconfigured') return '未配置密钥';
  if (balance.status === 'loading') return '余额…';
  if (balance.status === 'invalid') return '密钥无效';
  if (balance.status === 'network') return '余额网络失败';
  if (balance.status === 'expired') return '余额已过期';
  if (!amount) return '余额未知';
  if (balance.status === 'insufficient') return `余额不足 ${amount}`;
  if (balance.status === 'stale') return `${amount} 缓存`;
  return `余额 ${amount}`;
}

function accountsFrom(data) {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  return infos.map(info => ({
    currency: String(info?.currency || ''),
    total: String(info?.total_balance ?? ''),
    granted: String(info?.granted_balance ?? ''),
    toppedUp: String(info?.topped_up_balance ?? ''),
  })).filter(account => account.currency && account.total !== '');
}

export function createBalance({ resolveKey, fetchImpl = fetch, now = Date.now, ttlMs = 60000, staleMs = 180000, timeoutMs = 15000, lowBalance = 1 }) {
  let current = cleanBalance({ status: 'loading', accounts: [], updatedAt: null });
  let inflight = null;
  let failures = 0;
  let nextAllowed = 0;
  const remember = (next) => { current = cleanBalance(next); return current; };
  async function refresh(force = false) {
    const time = now();
    if (!force && (current.status === 'available' || current.status === 'insufficient') && time - current.updatedAt < ttlMs) return current;
    if (inflight) return inflight;
    if (!force && time < nextAllowed) return current;
    inflight = (async () => {
      let key = '';
      try {
        const cred = await resolveKey();
        key = cred && typeof cred.value === 'string' ? cred.value.trim() : '';
        if (!key) return remember({ status: 'unconfigured', accounts: [], updatedAt: null });
        const response = await fetchImpl('https://api.deepseek.com/user/balance', {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 401 || response.status === 403) return remember({ status: 'invalid', accounts: [], updatedAt: time });
        if (!response.ok) throw new Error('http');
        const data = await response.json();
        const accounts = accountsFrom(data);
        const primary = accounts.find(account => account.currency === 'CNY') || accounts[0];
        const numeric = primary ? Number(primary.total) : NaN;
        const low = Number.isFinite(numeric) && numeric < lowBalance;
        const status = data?.is_available === true ? 'available' : 'insufficient';
        failures = 0;
        nextAllowed = 0;
        return remember({ status, accounts, updatedAt: time, low, noticeKey: primary ? `${primary.currency}:${primary.total}` : '' });
      } catch {
        failures += 1;
        nextAllowed = time + Math.min(60000, 2000 * 2 ** Math.min(failures, 5));
        if (current.updatedAt && time - current.updatedAt <= staleMs && current.accounts.length) {
          return remember({ ...current, status: 'stale', low: false });
        }
        if (current.updatedAt && current.accounts.length) return remember({ status: 'expired', accounts: [], updatedAt: current.updatedAt, low: false });
        return remember({ status: 'network', accounts: [], updatedAt: null, low: false });
      } finally {
        key = '';
        inflight = null;
      }
    })();
    return inflight;
  }
  return { refresh, snapshot: () => current };
}
