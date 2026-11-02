/**
 * 鼠标跟随。
 *
 * 内置的 model.focus() 把指针方向算成单位向量再乘 30 度：不管离多远，只要方向变了
 * 就是满偏，而且内置缓动很快 —— 所以看起来"一动就甩头、停住又甩回来"。
 * 软饱和映射 + 独立眼球/头部临界阻尼；范围内保持注视，移出后平滑回正。
 */

export const DEFAULT_MOUSE_FOLLOW = Object.freeze({ enabled: true, radius: 1200 });
export const FOLLOW_RADIUS_MIN = 100;
export const FOLLOW_RADIUS_MAX = 4000;

export function lookOrigin(rect) {
  // 本项目为全身模型，脸位于画面上方；原来的 0.42 实际落在胸口。
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.24 };
}

export function normalizeMouseFollow(value, previous = DEFAULT_MOUSE_FOLLOW) {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : previous.enabled,
    radius: value?.radius === 0 ? 0 : Number.isFinite(value?.radius) && value.radius >= FOLLOW_RADIUS_MIN && value.radius <= FOLLOW_RADIUS_MAX ? Math.round(value.radius) : previous.radius,
  };
}

export function inFollowRange(pointerX, pointerY, rect, settings = DEFAULT_MOUSE_FOLLOW) {
  const center = lookOrigin(rect);
  return settings.enabled && Number.isFinite(pointerX) && Number.isFinite(pointerY)
    && (settings.radius === 0 || Math.hypot(pointerX - center.x, pointerY - center.y) <= settings.radius);
}

export function lookTarget(pointerX, pointerY, rect, { radius = DEFAULT_MOUSE_FOLLOW.radius, max = 1 } = {}) {
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return {x:0,y:0};
  const center = lookOrigin(rect);
  const scale = Math.max(180, (radius || 1200) * 0.55);
  const dx = pointerX - center.x, dy = center.y - pointerY;
  // 圆滑饱和，没有硬死区或刚离开脸部就满偏的问题；斜向幅度也有界。
  const denominator = Math.hypot(scale, dx, dy);
  return {x: dx / denominator * max, y: dy / denominator * max};
}

function spring(value, velocity, target, omega, dt) {
  const offset = value - target;
  const impulse = velocity + omega * offset;
  const decay = Math.exp(-omega * dt);
  return [target + (offset + impulse * dt) * decay, (velocity - omega * impulse * dt) * decay];
}

export function createLookFollower({ smoothing = 0.18, idleMs = Infinity } = {}) {
  let head = {x:0,y:0}, eye = {x:0,y:0};
  let headVelocity = {x:0,y:0}, eyeVelocity = {x:0,y:0};
  let targetX = 0;
  let targetY = 0;
  let lastInput = -Infinity;
  let lastTime = null;
  let tracking = false;
  let headTarget = {x:0,y:0};
  let headChangedAt = -Infinity;
  const clamp = value => Math.max(-1, Math.min(1, value));

  return {
    setTarget(point, now) {
      const nextX = clamp(Number.isFinite(point.x) ? point.x : 0);
      const nextY = clamp(Number.isFinite(point.y) ? point.y : 0);
      // 小移动也保留；头部略晚于眼睛响应，但连续移动不能不断重置延迟。
      if (!tracking || Math.hypot(nextX-targetX,nextY-targetY)>0.65) headChangedAt = now;
      targetX = nextX;
      targetY = nextY;
      lastInput = now;
      tracking = true;
    },
    release() { tracking=false; targetX=targetY=0; headTarget={x:0,y:0}; },
    update(now) {
      const gap = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
      const dt = lastTime === null || gap > 0.2 ? 1 / 60 : Math.min(0.1, gap);
      lastTime = now;
      if (now-lastInput>idleMs) tracking=false;
      if (!tracking || now-headChangedAt>=55) headTarget={x:tracking?targetX:0,y:tracking?targetY:0};
      for (const axis of ['x','y']) {
        [head[axis],headVelocity[axis]]=spring(head[axis],headVelocity[axis],headTarget[axis],1.8/smoothing,dt);
        head[axis]=clamp(head[axis]);
        const target=tracking?(axis==='x'?targetX:targetY):0;
        // 眼睛先捕获目标，头转过去后眼球稍微回收，避免两者同幅同速粘在一起。
        const eyeTarget=clamp(target*0.6+(target-head[axis])*0.4);
        [eye[axis],eyeVelocity[axis]]=spring(eye[axis],eyeVelocity[axis],eyeTarget,20,dt);
        eye[axis]=clamp(eye[axis]);
      }
      return { x:head.x, y:head.y, eyeX:eye.x, eyeY:eye.y, active:tracking };
    },
    get active() {
      return tracking || Math.hypot(head.x,head.y,eye.x,eye.y)>0.015;
    },
    get moving() { return Math.hypot(head.x-headTarget.x,head.y-headTarget.y,headVelocity.x,headVelocity.y,eyeVelocity.x,eyeVelocity.y)>0.02; },
    reset() {
      head={x:0,y:0};eye={x:0,y:0};headVelocity={x:0,y:0};eyeVelocity={x:0,y:0};headTarget={x:0,y:0};tracking=false;
      targetX = 0;
      targetY = 0;
      lastInput = -Infinity;
      lastTime = null;
    },
  };
}

/** 头部和眼球分别输出增量；眼球包含捕获目标和头部转动后的补偿。 */
export const LOOK_GAIN = { headX: 10, headY: 6.5, eyeX: 0.5, eyeY: 0.4 };

export function lookParameters({ x, y, eyeX = x, eyeY = y }) {
  return {
    ParamAngleX: x * LOOK_GAIN.headX,
    ParamAngleY: y * LOOK_GAIN.headY,
    ParamEyeBallX: eyeX * LOOK_GAIN.eyeX,
    ParamEyeBallY: eyeY * LOOK_GAIN.eyeY,
  };
}
