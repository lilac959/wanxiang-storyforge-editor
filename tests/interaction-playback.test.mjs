import test from "node:test";
import assert from "node:assert/strict";
import { PlayerView } from "../outputs/storyforge/studio/player-view.mjs";
import { continuousVideo } from "../outputs/storyforge/studio/timeline.mjs";
import { newProject, newEvent, validate } from "../outputs/storyforge/studio/model.mjs";

const first = { id: "a", kind: "video", assetId: "video", startMs: 0, inMs: 0, outMs: 12000 };
const second = { ...first, id: "b", startMs: 12000, inMs: 12000, outMs: 13000 };

test("25% hotspot and QTE sizes validate and hotspot markup uses the authored scale", () => {
  for (const kind of ["hotspot", "qte"]) {
    const p = newProject();
    const event = newEvent(0, kind);
    event.kind = kind;
    event.scale = 25;
    p.scenes[0].events.push(event);
    assert.ok(!validate(p).some(x => x.message === "互动位置或操作要求无效"));
    const host = { dataset: {}, innerHTML: "" };
    PlayerView.prototype.paintEvent.call({ editing: true }, event, host);
    assert.match(host.innerHTML, /--scale:0\.25/);
    event.scale = 0;
    assert.ok(validate(p).some(x => x.message === "互动位置或操作要求无效"));
  }
});

test("continuous cut reuses decoder without seeking or clearing active interactions", async () => {
  let seeks = 0;
  const video = {
    get currentTime() { return 12.015; },
    set currentTime(value) { seeks++; },
  };
  const view = {
    video, currentClip: first, mountedSceneId: "scene", token: 7,
    runtime: { rate: 0.5 }, muted: false, eventId: "active-interaction",
  };
  const next = { ...second, playbackRate: 0.5, volume: 0.3, audioDetached: true };
  await PlayerView.prototype.mount.call(view, { id: "scene", source: "sequence", clips: [first, next] }, 12000);
  assert.equal(view.video, video);
  assert.equal(view.currentClip, next);
  assert.equal(view.mountedClipId, "b");
  assert.equal(view.token, 7);
  assert.equal(view.eventId, "active-interaction");
  assert.equal(seeks, 0);
  assert.equal(video.playbackRate, 0.25);
  assert.equal(video.volume, 0.3);
  assert.equal(video.muted, true);
});

test("gaps, source jumps, other assets and reverse cuts require a normal transition", () => {
  assert.equal(continuousVideo(first, second), true);
  for (const patch of [
    { startMs: 12100 }, { inMs: 12500 }, { assetId: "another" }, { kind: "image" },
  ]) assert.equal(continuousVideo(first, { ...second, ...patch }), false);
  assert.equal(continuousVideo(second, first), false);
  assert.equal(continuousVideo(null, second), false);
});
