/**
 * 鼠标跟随。
 *
 * 内置的 model.focus() 把指针方向算成单位向量再乘 30 度：不管离多远，只要方向变了
 * 就是满偏，而且内置缓动很快 —— 所以看起来"一动就甩头、停住又甩回来"。
 * 这里改成：按距离成比例 + 死区 + 指数平滑 + 一段时间没动静就慢慢回正。
 */

export const DEFAULT_MOUSE_FOLLOW = Object.freeze({ enabled: true, radius: 400 });

export function normalizeMouseFollow(value, previous = DEFAULT_MOUSE_FOLLOW) {
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : previous.enabled,
    radius: [200, 400, 600].includes(value?.radius) ? value.radius : previous.radius,
  };
}

export function inFollowRange(pointerX, pointerY, rect, settings = DEFAULT_MOUSE_FOLLOW) {
  return settings.enabled && Number.isFinite(pointerX) && Number.isFinite(pointerY)
    && Math.hypot(pointerX - rect.left - rect.width / 2, pointerY - rect.top - rect.height * 0.42) <= settings.radius;
}

export function lookTarget(pointerX, pointerY, rect, { deadZone = 0.1, max = 1 } = {}) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height * 0.42; // 头的位置略高于画面中心
  const nx = (pointerX - centerX) / Math.max(1, rect.width * 0.5);
  const ny = (pointerY - centerY) / Math.max(1, rect.height * 0.5);
  const shape = value => {
    const magnitude = Math.abs(value);
    if (magnitude <= deadZone) return 0;
    const scaled = (magnitude - deadZone) / (1 - deadZone);
    return Math.sign(value) * Math.min(1, scaled) * max;
  };
  // 屏幕坐标 y 向下，模型参数 y 向上
  return { x: shape(nx), y: shape(-ny) };
}

export function createLookFollower({ smoothing = 0.18, idleMs = 2200 } = {}) {
  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;
  let lastInput = -Infinity;
  let lastTime = null;

  return {
    setTarget(point, now) {
      targetX = point.x ?? 0;
      targetY = point.y ?? 0;
      lastInput = now;
    },
    update(now) {
      const dt = lastTime === null ? 1 / 60 : Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const idleFor = now - lastInput;
      const goalX = idleFor > idleMs ? 0 : targetX;
      const goalY = idleFor > idleMs ? 0 : targetY;
      const alpha = 1 - Math.exp(-dt / smoothing);
      x += (goalX - x) * alpha;
      y += (goalY - y) * alpha;
      return { x, y, active: idleFor <= idleMs };
    },
    get active() {
      return lastInput !== -Infinity && (lastTime ?? 0) - lastInput <= idleMs;
    },
    reset() {
      x = 0;
      y = 0;
      targetX = 0;
      targetY = 0;
      lastInput = -Infinity;
      lastTime = null;
    },
  };
}

/** 把归一化的跟随量换算成参数增量（度/比例）。幅度故意压小，真人转头的幅度也就几度。 */
export const LOOK_GAIN = { headX: 7, headY: 5.5, eyeX: 0.42, eyeY: 0.3 };

export function lookParameters({ x, y }) {
  return {
    ParamAngleX: x * LOOK_GAIN.headX,
    ParamAngleY: y * LOOK_GAIN.headY,
    ParamEyeBallX: x * LOOK_GAIN.eyeX,
    ParamEyeBallY: y * LOOK_GAIN.eyeY,
  };
}
