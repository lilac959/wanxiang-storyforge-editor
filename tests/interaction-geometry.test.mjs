import test from "node:test";
import assert from "node:assert/strict";
import {
  fittedStage,
  swipeProgress,
} from "../outputs/storyforge/studio/interaction-geometry.mjs";
test("media and UI share one aspect-preserving design space in every device", () => {
  const desktop = fittedStage(960, 540),
    portrait = fittedStage(240, 440),
    landscape = fittedStage(844, 390);
  for (const fit of [desktop, portrait, landscape]) {
    assert.equal(fit.width / fit.height, 16 / 9);
    assert.ok(fit.scale > 0);
  }
  assert.equal(portrait.scale, desktop.scale / 4);
  const square = fittedStage(300, 500, 1);
  assert.equal(square.width, square.height);
});
test("swipe progress follows distance, rejects wrong directions and stays invariant across previews", () => {
  for (const scale of [0.125, 0.5, 1]) {
    assert.equal(swipeProgress("up", 0, -80 * scale, 80, scale), 0.5);
    assert.equal(swipeProgress("up", 0, -160 * scale, 80, scale), 1);
    assert.equal(swipeProgress("up", 0, 160 * scale, 80, scale), 0);
    assert.equal(swipeProgress("up", 200 * scale, -80 * scale, 80, scale), 0);
  }
});
