import { inFollowRange, DEFAULT_MOUSE_FOLLOW } from '../runtime/look.mjs';

// 只传识别范围内的相对坐标；范围外只发送一次离开事件，不记录全屏鼠标轨迹。
export function createPointerTracker() {
  let previous = null;
  return {
    sample(point, bounds, visible = true, settings = DEFAULT_MOUSE_FOLLOW) {
      const x = point.x - bounds.x, y = point.y - bounds.y;
      const inside = visible && inFollowRange(point.x, point.y, {left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height}, settings);
      if (!inside) {
        if (!previous) return null;
        previous = null;
        return { inside: false };
      }
      if (previous && previous.x === x && previous.y === y && previous.width === bounds.width && previous.height === bounds.height && previous.radius === settings.radius) return null;
      previous = { x, y, width: bounds.width, height: bounds.height, radius: settings.radius };
      return { inside: true, x, y };
    },
  };
}
