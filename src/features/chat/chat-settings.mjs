import { sanitizeChatPreferences } from './config.mjs';

/**
 * 带版本号与串行化的 chat 设置存储：
 * - 每次修改立即更新内存（UI 立即反映），保存按提交顺序串行执行；
 * - 保存失败且期间没有更新时，完整回滚到修改前的内存状态；
 * - 如果已有更新的修改，旧保存失败不再回滚（避免覆盖新设置）；
 * - `saving` 用于在写入期间禁止发起真实 Host 请求。
 */
export function createChatSettings({ initial, save, sanitize = sanitizeChatPreferences } = {}) {
  if (typeof save !== 'function') throw new Error('createChatSettings 需要 save');
  let chat = sanitize(initial);
  let version = 0;
  let saving = false;
  let chain = Promise.resolve(true);
  let revoked = false;

  const snapshot = () => ({ ...chat });

  const update = async patch => {
    const before = snapshot();
    const next = sanitize(patch, chat);
    const isRevoke = before.realConsent === true && next.realConsent !== true;
    chat = next;
    version += 1;
    const myVersion = version;
    saving = true;
    const result = { ok: true, stale: false, version: myVersion, chat: snapshot() };

    chain = chain.then(async () => {
      let ok = false;
      try { ok = (await save({ ...next })) !== false; } catch { ok = false; }
      if (!ok) {
        result.ok = false;
        if (myVersion === version) {
          chat = before;
          result.chat = snapshot();
        } else {
          result.stale = true;
        }
      }
      if (isRevoke && !ok) revoked = true;
      if (ok) revoked = false;
      if (myVersion === version) saving = false;
      return ok;
    });
    await chain;
    return result;
  };

  return {
    get chat() { return snapshot(); },
    get saving() { return saving; },
    get version() { return version; },
    /** 撤销许可但保存失败时保持 true：客户端必须继续阻止真实请求。 */
    get realCallRevoked() { return revoked; },
    update,
  };
}
