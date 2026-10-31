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

/** A quiet loop of the escape clip's body path. Face, hands, and props stay out. */
export function createFidget(motion, scale = 0.2) {
  const duration = motion?.Meta?.Duration || 0;
  const curves = (motion?.Curves || [])
    .filter(curve => BODY.includes(curve.Id))
    .map(curve => ({ id: curve.Id, samples: curveSamples(curve.Segments) }));
  return {
    duration,
    valueAt(time) {
      if (!duration || !curves.length) return {};
      const local = ((time % duration) + duration) % duration;
      const values = {};
      for (const curve of curves) values[curve.id] = scale * valueOn(curve.samples, local);
      return values;
    },
  };
}
