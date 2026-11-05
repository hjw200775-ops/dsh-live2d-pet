/**
 * TTSProvider 统一接口（本轮不接云服务）：
 *
 *   provider.name: string
 *   provider.languages: string[]            // 'zh' | 'ja' | 'en'
 *   provider.synthesize(text, options) -> Promise<{ format:'wav', data:Uint8Array, sampleRate:number, durationMs:number }>
 *
 * 约定：
 * - 只接收纯文本，不接收消息对象；不读取会话、不访问网络（由具体 provider 自行决定）；
 * - 输出必须是可解码的音频字节，禁止返回 URL 或文件路径；
 * - 错误必须抛 Error，且 message 不得包含正文（调用方只记录错误码）。
 */
export function assertTtsProvider(provider) {
  if (!provider || typeof provider.synthesize !== 'function') throw new Error('TTSProvider 需要 synthesize()');
  if (typeof provider.name !== 'string' || !provider.name) throw new Error('TTSProvider 需要 name');
  if (!Array.isArray(provider.languages) || provider.languages.length === 0) throw new Error('TTSProvider 需要 languages');
  return provider;
}

/** 生成一段 16-bit PCM 单声道 WAV：用于离线验收，不含任何真实语音。 */
export function makeSilenceWav({ durationMs = 220, sampleRate = 16000, frequency = 440 } = {}) {
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, text) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.15 * 32767);
    view.setInt16(44 + i * 2, value, true);
  }
  return { format: 'wav', data: bytes, sampleRate, durationMs };
}

/** 离线验证用 provider：把文本长度映射为短音，不联网、不读文件。 */
export function createMockTtsProvider({ delayMs = 0 } = {}) {
  return assertTtsProvider({
    name: 'mock-silence',
    languages: ['zh', 'ja', 'en'],
    async synthesize(text) {
      const clean = String(text ?? '').trim();
      if (!clean) throw new Error('empty-text');
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      return makeSilenceWav({ durationMs: 180 + Math.min(400, [...clean].length * 12) });
    },
  });
}
