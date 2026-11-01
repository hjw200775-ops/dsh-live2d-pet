function linearCurve(id, keys) {
  const segments = [keys[0][0], keys[0][1]];
  for (let index = 1; index < keys.length; index++) segments.push(0, keys[index][0], keys[index][1]);
  return { Target: 'Parameter', Id: id, Segments: segments, segmentCount: keys.length - 1, pointCount: keys.length };
}

function motionDocument(curves, duration, { loop = false } = {}) {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: loop,
      AreBeziersRestricted: true,
      CurveCount: curves.length,
      TotalSegmentCount: curves.reduce((sum, curve) => sum + curve.segmentCount, 0),
      TotalPointCount: curves.reduce((sum, curve) => sum + curve.pointCount, 0),
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves.map(({ Target, Id, Segments }) => ({ Target, Id, Segments })),
  };
}

/** One small tilt and return, used when an error begins. */
export function flinchMotion() {
  return motionDocument([
    linearCurve('ParamAngleZ', [[0, 0], [0.22, -7], [0.9, 0]]),
  ], 0.9);
}

/**
 * 思考时的循环动作：缓慢点头 + 轻微歪头 + 眼珠上飘。
 *
 * 以前是运行时用一条 2.6 秒正弦驱动，节奏精确到能看出来是算法；
 * 改成动作后由动作系统做淡入淡出，和其他动作混在一起更自然。
 * 首尾都回到 0，循环不会跳。
 */
export const THINKING_SECONDS = 4;

export function thinkingLoopMotion() {
  return motionDocument([
    linearCurve('ParamAngleY', [[0, 0], [1.2, 3.2], [2.6, 1.1], [4, 0]]),
    linearCurve('ParamAngleZ', [[0, 0], [1.6, -2.4], [3, 2.1], [4, 0]]),
    linearCurve('ParamEyeBallY', [[0, 0], [1.4, 0.28], [2.8, 0.1], [4, 0]]),
    linearCurve('ParamBodyAngleZ', [[0, 0], [2, -1.1], [4, 0]]),
  ], THINKING_SECONDS, { loop: true });
}

/** 旧接口保留：有些地方还在用这个正弦（例如自动动作前的过渡）。 */
export function thinkingPose(elapsed) {
  const duration = 2600;
  if (!(elapsed >= 0) || elapsed >= duration) return { angleY: 0, eyeY: 0 };
  const cycle = Math.sin((elapsed / duration) * Math.PI * 2);
  return { angleY: cycle * 12, eyeY: cycle * 0.55 };
}

const DOCUMENTS = {
  'flinch.motion3.json': flinchMotion,
  'thinking.motion3.json': thinkingLoopMotion,
};

export function authoredMotion(name) {
  const create = DOCUMENTS[name];
  return create ? create() : null;
}

export const AUTHORED_MOTIONS = {
  Flinch: { file: 'generated/flinch.motion3.json', seconds: 0.9 },
  Thinking: { file: 'generated/thinking.motion3.json', seconds: THINKING_SECONDS, loop: true },
};
