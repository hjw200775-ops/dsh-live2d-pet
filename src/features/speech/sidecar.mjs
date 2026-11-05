/**
 * DSH Live2D TTS sidecar（stdin/stdout JSON 行协议）。
 *
 * 安全边界：
 * - 模型目录只从环境变量读取，**不接受客户端传入路径**；
 * - 不执行任何 Shell 命令；
 * - 日志只输出错误码，不输出正文；
 * - 没有原生库或没有模型时明确返回错误码，不自动下载。
 *
 * 协议：
 *   -> {"id":1,"type":"ping"}
 *   <- {"id":1,"type":"ready","voices":[...]} 或 {"id":1,"type":"error","code":"SHERPA_UNAVAILABLE"}
 *   -> {"id":2,"type":"synthesize","text":"...","voice":"zf_xiaoxiao","speed":1,"language":"zh"}
 *   <- {"id":2,"type":"audio","format":"pcm","sampleRate":24000,"data":"<base64 int16le>"}
 *   -> {"id":3,"type":"cancel","target":2}
 *   -> {"id":4,"type":"shutdown"}
 */
import { createInterface } from 'node:readline';

const SAMPLE_RATE = 24000;
let tts = null;
let modelInfo = null;

function send(message) {
  try { process.stdout.write(JSON.stringify(message) + '\n'); } catch { /* 父进程已退出 */ }
}

function errorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : 'SYNTHESIS_FAILED';
}

function loadModel() {
  if (modelInfo) return modelInfo;
  const modelDir = process.env.DSH_LIVE2D_TTS_MODEL_DIR;
  if (!modelDir) { const error = new Error('模型目录未配置'); error.code = 'MODEL_MISSING'; throw error; }
  let sherpa;
  try {
    sherpa = awaitImport('sherpa-onnx-node');
  } catch {
    const error = new Error('sherpa-onnx-node 不可用');
    error.code = 'SHERPA_UNAVAILABLE';
    throw error;
  }
  // 模型文件固定命名，路径只来自 modelDir；客户端无法指定。
  tts = new sherpa.OfflineTts({
    model: {
      kokoro: {
        model: `${modelDir}/model.onnx`,
        voices: `${modelDir}/voices.bin`,
        tokens: `${modelDir}/tokens.txt`,
        dataDir: `${modelDir}/espeak-ng-data`,
        lexicon: `${modelDir}/lexicon-us-en.txt,${modelDir}/lexicon-zh.txt`,
      },
      numThreads: 2,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  });
  modelInfo = { sampleRate: tts.sampleRate || SAMPLE_RATE, voices: ['default'] };
  return modelInfo;
}

// Node 没有同步动态 import；这里用 createRequire 规避 ESM 静态解析失败。
import { createRequire } from 'node:module';
function awaitImport(specifier) {
  const require = createRequire(import.meta.url);
  return require(specifier);
}

/** 测试专用的假模式：生成固定正弦 PCM，不加载任何模型。 */
function fakeAudio(text) {
  const samples = Math.max(1, Math.min(24000, 1200 + [...String(text)].length * 120));
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE) * 0.1 * 32767), i * 2);
  return buffer;
}

const rl = createInterface({ input: process.stdin });
const cancelled = new Set();

rl.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { send({ type: 'error', code: 'BAD_REQUEST' }); return; }
  const { id, type } = message;
  if (type === 'ping') {
    if (process.env.DSH_LIVE2D_TTS_FAKE === '1') { send({ id, type: 'ready', sampleRate: SAMPLE_RATE, voices: ['default'] }); return; }
    try {
      const info = loadModel();
      send({ id, type: 'ready', sampleRate: info.sampleRate, voices: info.voices });
    } catch (error) {
      send({ id, type: 'error', code: errorCode(error) });
    }
    return;
  }
  if (type === 'cancel') { cancelled.add(message.target); return; }
  if (type === 'shutdown') { send({ id, type: 'bye' }); process.exit(0); return; }
  if (type === 'synthesize') {
    if (!message.text || typeof message.text !== 'string') { send({ id, type: 'error', code: 'EMPTY_TEXT' }); return; }
    try {
      if (process.env.DSH_LIVE2D_TTS_FAKE === '1') {
        if (cancelled.has(id)) { send({ id, type: 'error', code: 'CANCELLED' }); return; }
        send({ id, type: 'audio', format: 'pcm', sampleRate: SAMPLE_RATE, data: fakeAudio(message.text).toString('base64') });
        return;
      }
      loadModel();
      if (cancelled.has(id)) { send({ id, type: 'error', code: 'CANCELLED' }); return; }
      const audio = tts.generate(message.text, Number(message.speakerId) || 0, Number(message.speed) || 1);
      const pcm = Buffer.alloc(audio.samples.length * 2);
      for (let i = 0; i < audio.samples.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio.samples[i] * 32767))), i * 2);
      send({ id, type: 'audio', format: 'pcm', sampleRate: audio.sampleRate || SAMPLE_RATE, data: pcm.toString('base64') });
    } catch (error) {
      send({ id, type: 'error', code: errorCode(error) });
    }
    return;
  }
  send({ id, type: 'error', code: 'BAD_REQUEST' });
});
