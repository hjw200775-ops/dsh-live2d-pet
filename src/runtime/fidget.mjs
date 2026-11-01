const BODY = ['AngleX', 'AngleY', 'AngleZ', 'PositionX', 'PositionY', 'PositionZ'];

function curveSamples(segments) {
  const samples = [[segments[0], segments[1]]];
  let index = 2;
  while (index < segments.length) {
    const kind = segments[index];
    const [startTime, startValue] = samples[samples.length - 1];
    if (kind === 1) {
      const controlA = [segments[index + 1], segments[index + 2]];
      const controlB = [segments[index + 3], segments[index + 4]];
      const end = [segments[index + 5], segments[index + 6]];
      for (let step = 1; step <= 8; step++) {
        const t = step / 8;
        const u = 1 - t;
        const time = u ** 3 * startTime + 3 * u ** 2 * t * controlA[0] + 3 * u * t ** 2 * controlB[0] + t ** 3 * end[0];
        const value = u ** 3 * startValue + 3 * u ** 2 * t * controlA[1] + 3 * u * t ** 2 * controlB[1] + t ** 3 * end[1];
        samples.push([time, value]);
      }
      index += 7;
    } else {
      samples.push([segments[index + 1], segments[index + 2]]);
      index += 3;
    }
  }
  return samples;
}

function valueOn(samples, time) {
  let previous = samples[0];
  for (const point of samples) {
    if (point[0] >= time) {
      const span = point[0] - previous[0];
      if (span <= 0) return point[1];
      const mix = (time - previous[0]) / span;
      return previous[1] + (point[1] - previous[1]) * mix;
    }
    previous = point;
  }
  return previous[1];
}

/**
 * 按时间加权求曲线的平均值（时间轴上的重心），用来去掉直线的静态偏置。
 */
function timeMean(samples, duration) {
  if (!duration || samples.length < 2) return 0;
  let area = 0;
  for (let index = 1; index < samples.length; index++) {
    const [t0, v0] = samples[index - 1];
    const [t1, v1] = samples[index];
    const span = Math.max(0, t1 - t0);
    area += ((v0 + v1) / 2) * span;
  }
  return area / duration;
}

/**
 * 待机时的轻微身体晃动：从「脱捕」剪切里抽出身体轨迹，缩小幅度后**叠加**到模型自身的动作上。
 *
 * 注意：原曲线不是围绕 0 摆动的（脱捕 AngleZ 均值约 +11.6），直接叠加会给她一个
 * 永久的偏头角度。所以每条曲线先减掉时间均值，只留摇摆成分。
 */
export function createFidget(motion, scale = 0.2) {
  const duration = motion?.Meta?.Duration || 0;
  const curves = (motion?.Curves || [])
    .filter(curve => BODY.includes(curve.Id))
    .map(curve => {
      const samples = curveSamples(curve.Segments);
      return { id: curve.Id, samples, offset: timeMean(samples, duration) };
    });
  return {
    duration,
    offsetFor(id) {
      const curve = curves.find(item => item.id === id);
      return curve ? curve.offset * scale : 0;
    },
    valueAt(time) {
      if (!duration || !curves.length) return {};
      const local = ((time % duration) + duration) % duration;
      const values = {};
      for (const curve of curves) {
        // 减掉均值：叠加层不再带静态偏置，只有晃动
        values[curve.id] = scale * (valueOn(curve.samples, local) - curve.offset);
      }
      return values;
    },
  };
}
