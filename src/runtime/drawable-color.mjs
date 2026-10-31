/** Premultiplied Cubism 4.2 drawable color. Screen color is scaled by texture alpha. */
export function applyDrawableColor(rgb, alpha, multiply, screen) {
  const multiplied = rgb.map((channel, index) => channel * multiply[index]);
  return multiplied.map((channel, index) => channel + screen[index] * alpha - channel * screen[index]);
}
