/**
 * 本地假模型：产生确定性的模拟回复，**不发起任何网络请求**。
 * 所有文本都带「模拟」标记，避免让用户误以为已经接入真实 AI。
 */
export const SIMULATED_BADGE = '【模拟】';

const FOLLOW_SAMPLES = [
  '这是来自开发会话的示例消息，用来验证 follow 模式的显示链路。',
  '（示例）我在这边看着你的进度，需要我读一下当前回答吗？',
];

/** 组装一段模拟回复；prompt 只用于回显，不落盘、不进日志。 */
export function simulatedReplyText(prompt, mode = 'pet') {
  if (mode === 'follow') return `${SIMULATED_BADGE}${FOLLOW_SAMPLES[0]}`;
  const safe = String(prompt ?? '').slice(0, 120);
  return `${SIMULATED_BADGE}我在听。你刚才说「${safe}」。这是本地假模型生成的内容，没有调用任何真实 API。`;
}

/**
 * 流式产出模拟分片。
 * @param {object} options
 * @param {string} options.prompt 用户输入（仅用于拼接回显）
 * @param {'pet'|'follow'} [options.mode]
 * @param {AbortSignal} [options.signal]
 * @param {'ok'|'empty'|'error'|'stall'|'hang'} [options.scenario] 测试用故障注入
 * @param {number} [options.chunkSize] 每片字符数
 * @param {number} [options.delayMs] 每片延迟
 */
export async function* streamSimulatedReply({
  prompt,
  mode = 'pet',
  signal,
  scenario = 'ok',
  chunkSize = 3,
  delayMs = 12,
} = {}) {
  if (scenario === 'empty') return;
  if (scenario === 'hang') {
    // 真正挂起，直到被取消：用于验证超时、断连与资源释放。
    await new Promise(resolve => {
      if (!signal) return; // 没有信号就永远等待
      if (signal.aborted) return resolve();
      signal.addEventListener('abort', resolve, { once: true });
    });
    return;
  }
  const text = simulatedReplyText(prompt, mode);
  const chars = [...text];
  for (let index = 0; index < chars.length; index += chunkSize) {
    if (signal?.aborted) return;
    if (scenario === 'error' && index >= chunkSize * 2) {
      const error = new Error('simulated upstream failure');
      error.code = 'SIMULATED_UPSTREAM_ERROR';
      throw error;
    }
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    if (signal?.aborted) return;
    yield chars.slice(index, index + chunkSize).join('');
    if (scenario === 'stall') return; // 只发第一片，交给上层超时
  }
}
