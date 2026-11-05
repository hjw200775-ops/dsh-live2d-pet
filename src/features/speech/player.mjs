/**
 * AudioPlayer：播放器抽象。
 *
 * 真正的实现由宿主提供（Electron 渲染进程用 Web Audio），Node 测试用 Fake sink。
 * sink 契约：
 *   sink.play({format, data, sampleRate}, { volume, muted, onLevel }) -> void
 *   sink.stop() -> void
 *   sink.dispose?.() -> void
 *
 * `onLevel(rms0..1)` 由 sink 在播放期间回调（Web Audio 用 AnalyserNode 计算 RMS）；
 * 本模块只把它转成 SpeechState 的 rms 事件，不接触 Live2D 参数。
 */
export function createAudioPlayer({ sink, state, volume = 1, muted = false } = {}) {
  if (!sink || typeof sink.play !== 'function') throw new Error('AudioPlayer 需要 sink.play');
  let playing = false;
  let currentVolume = clamp(volume);
  let currentMuted = muted === true;

  const player = {
    get playing() { return playing; },
    get volume() { return currentVolume; },
    get muted() { return currentMuted; },
    setVolume(value) { currentVolume = clamp(value); },
    setMuted(value) { currentMuted = value === true; },
    play(audio, meta = {}) {
      return new Promise(resolve => {
        playing = true;
        const onLevel = rms => state?.publishRms?.(rms);
        sink.play(audio, {
          volume: currentMuted ? 0 : currentVolume,
          muted: currentMuted,
          onLevel,
          onEnded: () => { playing = false; resolve(); },
          meta,
        });
      });
    },
    stop() {
      playing = false;
      sink.stop?.();
      state?.publishRms?.(0);
    },
    dispose() {
      playing = false;
      sink.dispose?.();
      state?.publishRms?.(0);
    },
  };
  return player;
}

function clamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.min(1, Math.max(0, number));
}
