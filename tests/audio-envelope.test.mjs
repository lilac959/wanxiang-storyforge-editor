import test from "node:test";
import assert from "node:assert/strict";
import { audioVolume } from "../outputs/storyforge/studio/audio-envelope.mjs";

test("audio fades follow scene time and preserve configured volume", () => {
  const clip = {
    startMs: 1000,
    endMs: 6000,
    volume: 0.8,
    fadeInMs: 1000,
    fadeOutMs: 2000,
  };
  assert.equal(audioVolume(clip, 1000), 0);
  assert.equal(audioVolume(clip, 1500), 0.4);
  assert.equal(audioVolume(clip, 3000), 0.8);
  assert.equal(audioVolume(clip, 5000), 0.4);
  assert.equal(audioVolume(clip, 6000), 0);
  assert.equal(audioVolume({ ...clip, fadeInMs: 0, fadeOutMs: 0 }, 2000), 0.8);
});
