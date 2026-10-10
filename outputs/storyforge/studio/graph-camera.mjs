export function worldPoint(camera, x, y) {
  return { x: (x - camera.x) / camera.scale, y: (y - camera.y) / camera.scale };
}
export function zoomCamera(camera, factor, x, y) {
  const world = worldPoint(camera, x, y);
  const scale = Math.max(0.15, Math.min(2, camera.scale * factor));
  return { scale, x: x - world.x * scale, y: y - world.y * scale };
}
export function nodeBounds(nodes, positions, width, height) {
  const left = Math.min(...nodes.map((n) => positions[n.id].x), 0);
  const top = Math.min(...nodes.map((n) => positions[n.id].y), 0);
  const right = Math.max(
    ...nodes.map((n) => positions[n.id].x + width),
    left + 1,
  );
  const bottom = Math.max(
    ...nodes.map((n) => positions[n.id].y + height(n.id)),
    top + 1,
  );
  return { left, top, width: right - left, height: bottom - top };
}
