/**
 * SpeechQueue：串行播放、可停止/取消/替换。
 *
 * - 永远不会有两条语音同时播放：新任务要么排队，要么先停旧的；
 * - 合成失败只记录错误码，不把正文写进日志；
 * - 停止后清空队列并把 RMS 归零，便于口型闭合；
 * - 任务 ID 由调用方给（例如 chat 的 turn id），用于按对话取消。
 */
import { createSpeechState } from './state.mjs';

export function createSpeechQueue({ provider, player, state = createSpeechState(), dedupeWindowMs = 4000, now = () => Date.now() } = {}) {
  if (!provider || typeof provider.synthesize !== 'function') throw new Error('SpeechQueue 需要 provider');
  if (!player || typeof player.play !== 'function') throw new Error('SpeechQueue 需要 player');

  const queue = [];
  let current = null;
  let disposed = false;
  const recent = new Map(); // key -> timestamp

  const keyOf = (text, source) => `${source}:${text}`;
  const isDuplicate = (text, source) => {
    const key = keyOf(text, source);
    const at = recent.get(key);
    if (at && now() - at < dedupeWindowMs) return true;
    recent.set(key, now());
    return false;
  };

  const setState = (next, reason) => state.set(next, reason);

  const pump = async () => {
    if (current || disposed || queue.length === 0) return;
    const item = queue.shift();
    current = item;
    let audio = null;
    try {
      setState('synthesizing', item.source);
      audio = await provider.synthesize(item.text);
      if (disposed || item.cancelled) return;
      setState('speaking', item.source);
      await player.play(audio, { id: item.id, source: item.source });
      if (disposed || item.cancelled) return;
      setState('idle', 'finished');
    } catch (error) {
      if (disposed) return;
      if (item.cancelled) { setState('stopped', 'cancelled'); return; }
      setState('error', safeReason(error));
    } finally {
      current = null;
      state.publishRms(0);
      if (!disposed && queue.length) void pump();
    }
  };

  const enqueue = (text, { id = null, source = 'pet', mode = 'queue' } = {}) => {
    if (disposed) return false;
    const clean = String(text ?? '').trim();
    if (!clean) return false;
    if (isDuplicate(clean, source)) return false;
    if (mode === 'replace') { for (const item of queue.splice(0)) item.cancelled = true; }
    queue.push({ id, text: clean, source, cancelled: false });
    void pump();
    return true;
  };

  const stop = () => {
    for (const item of queue.splice(0)) item.cancelled = true;
    if (current) current.cancelled = true;
    player.stop?.();
    state.publishRms(0);
    setState('stopped', 'user');
  };

  const cancel = id => {
    if (id === null || id === undefined) return false;
    let found = false;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].id === id) { queue[i].cancelled = true; queue.splice(i, 1); found = true; }
    }
    if (current && current.id === id) { current.cancelled = true; player.stop?.(); found = true; }
    if (found) setState('stopped', 'cancelled');
    return found;
  };

  const dispose = () => {
    disposed = true;
    for (const item of queue.splice(0)) item.cancelled = true;
    if (current) current.cancelled = true;
    player.stop?.();
    player.dispose?.();
    state.publishRms(0);
    state.dispose();
  };

  return {
    enqueue,
    stop,
    cancel,
    dispose,
    get state() { return state.state; },
    get pending() { return queue.length + (current ? 1 : 0); },
    get currentId() { return current?.id ?? null; },
  };
}

function safeReason(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return code;
  return 'synthesis-failed';
}
