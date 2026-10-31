export function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax, v0y = cy - ay, v1x = bx - ax, v1y = by - ay, v2x = px - ax, v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y, dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
  const denom = dot00 * dot11 - dot01 * dot01;
  if (!denom) return false;
  const inv = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= -0.001 && v >= -0.001 && u + v < 1.001;
}

export function hitDrawableList(localX, localY, drawables) {
  for (const drawable of drawables) {
    if (localX < drawable.minX || localX > drawable.maxX || localY < drawable.minY || localY > drawable.maxY) continue;
    const { vertices, indices } = drawable;
    for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
      const a = indices[triangle] * 2, b = indices[triangle + 1] * 2, c = indices[triangle + 2] * 2;
      if (pointInTriangle(localX, localY, vertices[a], vertices[a + 1], vertices[b], vertices[b + 1], vertices[c], vertices[c + 1])) return true;
    }
  }
  return false;
}
