// Pure timeline navigation helpers. Positions remain independent of media decoding.
export function rulerTicks(span, width) {
  const desired = span / Math.max(1, width / 90);
  const base = 10 ** Math.floor(Math.log10(Math.max(1, desired)));
  const step = [1, 2, 5, 10].map((x) => x * base).find((x) => x >= desired);
  const ticks = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);
  return ticks;
}
export function zoomScroll(anchor, newWidth, viewportX) {
  return Math.max(0, 70 + anchor * newWidth - viewportX);
}
export function previewRate(scene, time) {
  return (
    scene.effects?.find(
      (x) => x.kind === "speed" && time >= x.startMs && time < x.endMs,
    )?.value || 1
  );
}
