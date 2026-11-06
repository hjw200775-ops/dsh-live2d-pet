/**
 * 长按摸头。
 *
 * 设计成纯逻辑模块，渲染器只负责把返回的增量贴到参数上：
 * - 阈值、各阶段时间、淡出时长全部集中在这里，调参只改这一处；
 * - 不依赖浏览器全局，可按时间点采样做单测；
 * - 与既有交互解耦：拖动、单击、双击、透明穿透都不在本模块里判断，
 *   由调用方在「达到阈值前」继续走原来的识别。
 */

/** 时间参数（毫秒）。 */
export const HEAD_PAT_TIMING = {
  thresholdMs: 450, // 按住多久进入摸头
  blushMs: 2000, // 进入后多久加入脸红 / 眯眼
  flourishMs: 5000, // 进入后多久加强并蹭一次头
  rampMs: 260, // 每级变化自身的过渡时长
  fadeMs: 420, // 松手后的淡出
  nuzzleMs: 700, // 5 秒后那一次蹭头的长度
};

/** 各阶段叠加幅度。头用控制器参数（度），表情用 0~1 权重。 */
export const HEAD_PAT_GAIN = {
  headY: -3.4, // 低头
  headZ: 2.0, // 歪头
  smile: 0.5, // 眯眼笑（EyeSmile）
  squint: 0.25, // 眼睛压扁（LEyeSquint / REyeSquint）
  mouthForm: 0.2, // 嘴角
  nuzzleZ: 1.8, // 蹭头时的额外歪头
  flourishBoost: 0.35, // 5 秒后整体加强比例
};

const ZERO = Object.freeze({
  stage: 0,
  strength: 0,
  headY: 0,
  headZ: 0,
  eyeSmile: 0,
  squint: 0,
  mouthForm: 0,
  blush: 0,
  nuzzle: 0,
});

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** 三个时间点把反馈分成 0/1/2/3 四级。 */
export function headPatStage(elapsedMs, timing = HEAD_PAT_TIMING) {
  if (!(elapsedMs >= 0)) return 0;
  if (elapsedMs >= timing.flourishMs) return 3;
  if (elapsedMs >= timing.blushMs) return 2;
  return 1;
}

/**
 * 某一时刻的叠加量。elapsedMs 以「进入摸头」为 0。
 * 每一级都自带一段 ramp，避免表情突然跳。
 */
export function headPatFeedback(elapsedMs, { timing = HEAD_PAT_TIMING, gain = HEAD_PAT_GAIN } = {}) {
  if (!(elapsedMs >= 0)) return { ...ZERO };
  const stage = headPatStage(elapsedMs, timing);
  const ramp = (start) => smoothstep((elapsedMs - start) / Math.max(1, timing.rampMs));

  const level1 = ramp(0);
  const level2 = ramp(timing.blushMs);
  const level3 = ramp(timing.flourishMs);

  // 5 秒后那一次蹭头：只在 nuzzleMs 内有效，正弦包络，前后归零
  let nuzzle = 0;
  const nuzzleT = (elapsedMs - timing.flourishMs) / Math.max(1, timing.nuzzleMs);
  if (nuzzleT > 0 && nuzzleT < 1) nuzzle = Math.sin(Math.PI * nuzzleT);

  const boost = 1 + gain.flourishBoost * level3;
  return {
    stage,
    strength: 1,
    headY: gain.headY * level1 * boost,
    headZ: gain.headZ * level1 * boost + gain.nuzzleZ * nuzzle,
    // 表情从第 2 级开始，和第 1 级的头部动作错开
    eyeSmile: gain.smile * level2 * (1 + 0.2 * level3),
    squint: gain.squint * level2,
    mouthForm: gain.mouthForm * level2,
    blush: level2,
    nuzzle,
  };
}

/** 按比例缩放反馈（淡出用）。 */
function scaled(feedback, factor) {
  const k = clamp01(factor);
  if (k <= 0) return { ...ZERO };
  return {
    stage: feedback.stage,
    strength: k,
    headY: feedback.headY * k,
    headZ: feedback.headZ * k,
    eyeSmile: feedback.eyeSmile * k,
    squint: feedback.squint * k,
    mouthForm: feedback.mouthForm * k,
    blush: feedback.blush * k,
    nuzzle: feedback.nuzzle * k,
  };
}

/**
 * 一次按住的完整生命周期：idle → pressing →（到阈值）active →（松手）fading → idle。
 * 短按只会在 pressing 结束后回到 idle，不会进入摸头。
 */
export function createHeadPat({ timing = HEAD_PAT_TIMING, gain = HEAD_PAT_GAIN } = {}) {
  let phase = 'idle';
  let pressAt = 0;
  let activeAt = 0;
  let releaseAt = 0;

  const feedbackAt = (elapsed) => headPatFeedback(elapsed, { timing, gain });

  return {
    begin(now) {
      if (phase !== 'idle') return false;
      phase = 'pressing';
      pressAt = now;
      return true;
    },
    /** 每帧调用：到阈值就从 pressing 升级成 active，淡出结束就回到 idle。 */
    tick(now) {
      if (phase === 'pressing' && now - pressAt >= timing.thresholdMs) {
        phase = 'active';
        activeAt = now;
      } else if (phase === 'fading' && now - releaseAt >= timing.fadeMs) {
        phase = 'idle';
      }
      return phase;
    },
    /** 松手 / 移出头部 / 失焦 / 打开设置 / 状态切换都走这里。 */
    end(now) {
      if (phase === 'active') {
        phase = 'fading';
        releaseAt = now;
      } else if (phase === 'pressing') {
        phase = 'idle';
      }
    },
    cancel() {
      phase = 'idle';
      pressAt = 0;
      activeAt = 0;
      releaseAt = 0;
    },
    get phase() {
      return phase;
    },
    get pressing() {
      return phase === 'pressing';
    },
    get active() {
      return phase === 'active';
    },
    /** 正在摸头或正在淡出：用来抑制单击、拖动、待机小动作。 */
    get engaged() {
      return phase === 'active' || phase === 'fading';
    },
    /** 距离进入摸头过去了多久（未进入返回 0）。 */
    elapsed(now) {
      return phase === 'active' ? Math.max(0, now - activeAt) : 0;
    },
    feedback(now) {
      if (phase === 'active') return feedbackAt(now - activeAt);
      if (phase === 'fading') {
        const factor = 1 - (now - releaseAt) / Math.max(1, timing.fadeMs);
        return scaled(feedbackAt(releaseAt - activeAt), factor);
      }
      return { ...ZERO };
    },
  };
}
