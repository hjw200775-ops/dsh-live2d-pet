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

/**
 * 头部和身体用的是模型自带的「控制器」参数（AngleX/AngleY/AngleZ、PositionX/Y），
 * 模型自己的 IDLE 和竖指动作也是驱动这几个，数值范围取自这些动作的实测区间：
 *   AngleX -17.6…14.3 / AngleY -23.6…5.8 / AngleZ 0…23.4 / PositionX -17.6…14.3 / PositionY -6.7…5.7
 * 手臂是「姿态开关」（狗尾草 / 抚胸 / 竖食指），不是连续角度，所以动作里不碰手臂。
 */
export const SAFE_PARAMS = new Set(['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamMouthForm']);
export const HEAD_LIMIT = { x: 14, y: 20, z: 20 };

/** One small tilt and return, used when an error begins. */
export function flinchMotion() {
  return motionDocument([
    linearCurve('AngleZ', [[0, 0], [0.22, 7], [0.9, 0]]),
  ], 0.9);
}

/**
 * 思考时的循环动作：缓慢点头 + 轻微歪头 + 眼珠上飘。
 * 首尾都回到 0，循环不会跳。
 */
export const THINKING_SECONDS = 4;

export function thinkingLoopMotion() {
  return motionDocument([
    // 围绕 0 对称摆动：正负抵消，思考时不会一直往一边歪
    linearCurve('AngleY', [[0, 1.4], [1.2, -3.2], [2.6, -1.1], [3.4, 1.2], [4, 1.4]]),
    linearCurve('AngleZ', [[0, -1.3], [1.6, 2.6], [3, 1.2], [4, -1.3]]),
    linearCurve('ParamEyeBallY', [[0, 0.14], [1.4, 0.28], [2.8, 0.1], [4, 0.14]]),
  ], THINKING_SECONDS, { loop: true });
}

/** 打招呼：轻轻点头 + 抬一点身子 + 微微前倾，像在跟你示意。 */
export const HELLO_SECONDS = 2.2;
export function helloMotion() {
  return motionDocument([
    linearCurve('PositionY', [[0, 0], [0.5, 3.2], [1.4, 3.2], [2.2, 0]]),
    linearCurve('AngleY', [[0, 0], [0.45, -5], [1.2, -2], [2.2, 0]]),
    linearCurve('AngleZ', [[0, 0], [0.6, 4], [1.5, 1.5], [2.2, 0]]),
    linearCurve('ParamEyeLOpen', [[0, 1], [0.9, 1], [1.0, 0.2], [1.1, 1], [2.2, 1]]),
    linearCurve('ParamEyeROpen', [[0, 1], [0.9, 1], [1.0, 0.2], [1.1, 1], [2.2, 1]]),
  ], HELLO_SECONDS);
}

/** 点头：两次短促的下点，第二次轻一点。 */
export const NOD_SECONDS = 1.6;
export function nodMotion() {
  return motionDocument([
    linearCurve('AngleY', [[0, 0], [0.3, -6.5], [0.62, 0.8], [0.95, -5], [1.6, 0]]),
  ], NOD_SECONDS);
}

/** 摇头：左右各一次，幅度收到 8 以内，避免脖子穿帮。 */
export const SHAKE_SECONDS = 1.8;
export function shakeMotion() {
  return motionDocument([
    linearCurve('AngleX', [[0, 0], [0.32, -8], [0.85, 8], [1.35, -5], [1.8, 0]]),
  ], SHAKE_SECONDS);
}

/** 伸懒腰：身子慢慢拔高再落下，配一个轻微的歪头。 */
export const STRETCH_SECONDS = 3.2;
export function stretchMotion() {
  return motionDocument([
    linearCurve('PositionY', [[0, 0], [1.1, 5], [2.1, 5.4], [3.2, 0]]),
    linearCurve('AngleZ', [[0, 0], [1.2, 6.5], [2.2, 4], [3.2, 0]]),
    linearCurve('AngleY', [[0, 0], [1.3, -4.5], [2.4, -2], [3.2, 0]]),
  ], STRETCH_SECONDS);
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
  'hello.motion3.json': helloMotion,
  'nod.motion3.json': nodMotion,
  'shake.motion3.json': shakeMotion,
  'stretch.motion3.json': stretchMotion,
};

export function authoredMotion(name) {
  const create = DOCUMENTS[name];
  return create ? create() : null;
}

export const AUTHORED_MOTIONS = {
  Flinch: { file: 'generated/flinch.motion3.json', seconds: 0.9 },
  Thinking: { file: 'generated/thinking.motion3.json', seconds: THINKING_SECONDS, loop: true },
  Hello: { file: 'generated/hello.motion3.json', seconds: HELLO_SECONDS },
  Nod: { file: 'generated/nod.motion3.json', seconds: NOD_SECONDS },
  Shake: { file: 'generated/shake.motion3.json', seconds: SHAKE_SECONDS },
  Stretch: { file: 'generated/stretch.motion3.json', seconds: STRETCH_SECONDS },
};
