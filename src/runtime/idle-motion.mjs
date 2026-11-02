import { noise1D, seededRandom, smoothstep } from './noise.mjs';
import { createRestSway } from './rest-sway.mjs';
import { createLegShake } from './leg-shake.mjs';

export function createWeightShift({ seed = 29 } = {}) {
  const random = seededRandom(seed);
  let nextAt = 8 + random() * 12;
  let startedAt = 0;
  let from = 0;
  let target = 0;
  const valueAt = time => from + (target - from) * smoothstep((time - startedAt) / 2);
  return {
    valueAt(time) {
      if (!Number.isFinite(time)) return { AngleZ: 0, PositionX: 0 };
      // 按事件时间推进，稀疏采样与逐帧采样结果一致。
      while (time >= nextAt) {
        from = valueAt(nextAt);
        startedAt = nextAt;
        target = random() * 2 - 1;
        nextAt += 8 + random() * 12;
      }
      const value = valueAt(time);
      return { AngleZ: value * 1.4, PositionX: value * 1.2 };
    },
  };
}

// 只累积待机时间；启停用包络淡入淡出，所有输出都是增量。
export function createIdleMotion({ seed = 31 } = {}) {
  const shift = createWeightShift({ seed });
  const restSway = createRestSway({ seed:seed+17 });
  const legShake = createLegShake({ seed:seed+31 });
  let previous = null;
  let elapsed = 0;
  let weight = 0;
  let restingTime = 0, wasResting = false;
  let latestTime = 0;
  const bodyShown = { PositionX:0, PositionZ:0, AngleZ:0 };
  return {
    get swaying() { return Math.abs(bodyShown.PositionX)+Math.abs(bodyShown.PositionZ)>0.02; },
    get shaking() { return legShake.shaking; },
    get legState() { return { active:legShake.shaking, angle:legShake.current, nextAt:legShake.nextAt }; },
    triggerLegShake() { return legShake.trigger(latestTime); },
    cancelLegShake(time = latestTime) { legShake.cancel(Number.isFinite(time) ? time : latestTime); },
    valueAt(time, enabled = true, { resting = enabled } = {}) {
      if (!Number.isFinite(time)) return {};
      latestTime = time;
      const dt = previous === null ? 0 : Math.max(0, Math.min(0.05, time - previous));
      previous = time;
      if (enabled) elapsed += dt;
      if (resting) {
        if (!wasResting) {
          restingTime = 0;
          restSway.reset();
          legShake.reset(time);
        }
        restingTime += dt;
      } else if (wasResting) {
        restingTime = 0;
        restSway.reset();
        legShake.reset(time);
      }
      wasResting = resting;
      weight = Math.max(0, Math.min(1, weight + (enabled ? 1 : -1) * dt / 0.4));
      const values = {
        AngleX: noise1D(elapsed / 5, seed + 1) * 1.8,
        AngleY: noise1D(elapsed / 6, seed + 2) * 1.2,
        ...shift.valueAt(elapsed),
      };
      const output=Object.fromEntries(Object.entries(values).map(([id, value]) => [id, value * smoothstep(weight)]));
      const bodyTarget=enabled&&resting?restSway.valueAt(restingTime,{blocked:legShake.shaking}):{};
      const alpha=1-Math.exp(-dt/0.2);
      for(const id of Object.keys(bodyShown)){
        bodyShown[id]+=((bodyTarget[id]||0)-bodyShown[id])*alpha;
        if(Math.abs(bodyShown[id])<1e-6)bodyShown[id]=0;
        output[id]=(output[id]||0)+bodyShown[id];
      }
      const bodyBusy=Object.values(bodyShown).some(value=>Math.abs(value)>1e-5)
        || Object.values(bodyTarget).some(value=>Math.abs(value)>1e-5);
      Object.assign(output,legShake.valueAt(time,enabled&&resting,{blocked:bodyBusy}));
      return output;
    },
  };
}
