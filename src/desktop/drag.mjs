export function dragCursorOrigin(bounds, origin, current) {
  if (Number.isFinite(origin?.x) && Number.isFinite(origin?.y) && origin.x >= 0 && origin.y >= 0 && origin.x <= bounds.width && origin.y <= bounds.height) {
    return { x: bounds.x + origin.x, y: bounds.y + origin.y };
  }
  return current;
}

export function movedWindowBounds(start, from, to) {
  return {
    x: Math.round(start.x + to.x - from.x),
    y: Math.round(start.y + to.y - from.y),
    width: start.width,
    height: start.height,
  };
}

function clampInto(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/** Grow or shrink the window from its center, keeping the whole rectangle inside the work area. */
export function scaledWindowBounds(current, factor, workArea, base = { width: 460, height: 700 }) {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  let width = Math.round(current.width * safeFactor);
  let height = Math.round(current.height * safeFactor);
  const minWidth = Math.round(base.width * 0.45);
  const minHeight = Math.round(base.height * 0.45);
  if (width < minWidth || height < minHeight) {
    const grow = Math.max(minWidth / width, minHeight / height);
    width = Math.round(width * grow);
    height = Math.round(height * grow);
  }
  if (width > workArea.width || height > workArea.height) {
    const shrink = Math.min(workArea.width / width, workArea.height / height);
    width = Math.round(width * shrink);
    height = Math.round(height * shrink);
  }
  const x = Math.round(current.x + current.width / 2 - width / 2);
  const y = Math.round(current.y + current.height - height);
  return clampInto({ x, y, width, height }, workArea);
}

export function resetWindowBounds(current, workArea, base = { width: 460, height: 700 }) {
  const x = Math.round(current.x + current.width / 2 - base.width / 2);
  const y = Math.round(current.y + current.height - base.height);
  return clampInto({ x, y, width: base.width, height: base.height }, workArea);
}
