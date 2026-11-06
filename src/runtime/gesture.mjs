/** Classify a press as a click, a double-click, or a drag.
 * A movement of `slop` pixels, or a hold of `holdMs`, cancels the click.
 * The single click is delayed by `doubleMs` so it is not also played as a double-click. */

export function createGestureRecognizer({ slop = 5, holdMs = 180, doubleMs = 260 } = {}) {
  let down = null;
  let armed = null;

  return {
    cancel() {
      down = null;
      armed = null;
    },
    pointerDown(x, y, time) {
      if (armed && time - armed.time <= doubleMs && Math.hypot(x - armed.x, y - armed.y) <= slop) {
        armed = null;
        down = { x, y, time, kind: 'double', dragging: false };
        return { type: 'pending-double' };
      }
      down = { x, y, time, kind: 'single', dragging: false };
      return { type: 'down' };
    },
    pointerMove(x, y) {
      if (!down || down.dragging) return null;
      if (Math.hypot(x - down.x, y - down.y) < slop) return null;
      down.dragging = true;
      armed = null;
      return { type: 'drag-start', x: down.x, y: down.y };
    },
    pointerUp(x, y, time) {
      if (!down) return null;
      const start = down;
      down = null;
      if (start.dragging) return { type: 'drag-end' };
      if (time - start.time >= holdMs) return { type: 'cancel' };
      if (start.kind === 'double') return { type: 'double-click', x, y };
      armed = { x, y, time };
      return { type: 'click-arm', x, y };
    },
    expire(time) {
      if (!armed || time - armed.time < doubleMs) return null;
      const click = armed;
      armed = null;
      return { type: 'click', x: click.x, y: click.y };
    },
  };
}
