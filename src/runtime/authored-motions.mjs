function linearCurve(id, keys) {
  const segments = [keys[0][0], keys[0][1]];
  for (let index = 1; index < keys.length; index++) segments.push(0, keys[index][0], keys[index][1]);
  return { Target: 'Parameter', Id: id, Segments: segments, segmentCount: keys.length - 1, pointCount: keys.length };
}

function motionDocument(curves, duration) {
  return {
    Version: 3,
    Meta: {
      Duration: duration,
      Fps: 30,
      Loop: false,
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

/** One look up, then one look down, then rest. The chest stays still. */
export function thinkingPose(elapsed) {
  const duration = 2600;
  if (!(elapsed >= 0) || elapsed >= duration) return { angleY: 0, eyeY: 0 };
  const cycle = Math.sin((elapsed / duration) * Math.PI * 2);
  return { angleY: cycle * 12, eyeY: cycle * 0.55 };
}

const DOCUMENTS = {
  'flinch.motion3.json': flinchMotion,
};

export function authoredMotion(name) {
  const create = DOCUMENTS[name];
  return create ? create() : null;
}

export const AUTHORED_MOTIONS = {
  Flinch: { file: 'generated/flinch.motion3.json', seconds: 0.9 },
};
