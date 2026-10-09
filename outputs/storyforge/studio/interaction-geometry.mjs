// A stable content coordinate system shared by all preview sizes.
export function fittedStage(width, height, ratio = 16 / 9) {
  const designWidth = 1920;
  const designHeight =
    designWidth / (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9);
  return {
    width: designWidth,
    height: designHeight,
    scale: Math.max(0, Math.min(width / designWidth, height / designHeight)),
  };
}
export function swipeProgress(gesture, dx, dy, distance, scale = 1) {
  const horizontal = gesture === "left" || gesture === "right";
  const along = { left: -dx, right: dx, up: -dy, down: dy }[gesture] || 0;
  const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
  if (along <= 0 || cross > along) return 0;
  // Existing distances were authored against a 960px wide player.
  return Math.min(1, along / Math.max(1, distance * 2 * scale));
}
