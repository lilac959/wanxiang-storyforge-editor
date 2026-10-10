import test from "node:test";
import assert from "node:assert/strict";
import {
  trackRows,
  assignTrack,
  reorderTrack,
  visualLayer,
  interactionConflicts,
} from "../outputs/storyforge/studio/tracks.mjs";
import {
  newProject,
  newEvent,
  migrate,
  validate,
  duration,
} from "../outputs/storyforge/studio/model.mjs";
import {
  appendVisual,
  liftVisual,
  insertVisual,
} from "../outputs/storyforge/studio/timeline.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";

function fixture() {
  const project = newProject(),
    scene = project.scenes[0];
  project.assets.v = {
    id: "v",
    name: "视频",
    kind: "video",
    source: "assets/v.mp4",
    mime: "video/mp4",
    durationMs: 10000,
  };
  project.assets.i = {
    id: "i",
    name: "人物",
    kind: "image",
    source: "assets/i.png",
    mime: "image/png",
    width: 100,
    height: 100,
  };
  appendVisual(scene, project.assets.v);
  return { project, scene };
}
test("legacy sequential packing preserves later overlays above earlier overlapping ones", () => {
  const { scene } = fixture();
  scene.overlays = [
    { id: "short", startMs: 0, endMs: 2000 },
    { id: "long", startMs: 0, endMs: 5000 },
    { id: "later", startMs: 3000, endMs: 5000 },
  ];
  assert.ok(
    visualLayer(scene, scene.overlays[2]) >
      visualLayer(scene, scene.overlays[1]),
  );
});
test("overlapping visuals occupy stable separate tracks; explicit layer order survives moving and save/reopen", () => {
  const { project, scene } = fixture();
  const a = {
    id: "a",
    assetId: "i",
    startMs: 1000,
    endMs: 4000,
    x: 50,
    y: 50,
    width: 35,
  };
  assignTrack(scene, "overlay", a);
  scene.overlays.push(a);
  const b = { ...a, id: "b", startMs: 2000, endMs: 5000 };
  assignTrack(scene, "overlay", b, a.trackId);
  scene.overlays.push(b);
  assert.notEqual(a.trackId, b.trackId);
  assert.ok(visualLayer(scene, b) > visualLayer(scene, a));
  reorderTrack(scene, b.trackId, 1);
  assert.ok(visualLayer(scene, a) > visualLayer(scene, b));
  const order = trackRows(scene).map((r) => r.id);
  b.startMs = 0;
  b.endMs = 3000;
  assignTrack(scene, "overlay", b, b.trackId);
  assert.deepEqual(
    trackRows(scene).map((r) => r.id),
    order,
  );
  const reopened = migrate(JSON.parse(JSON.stringify(project))).scenes[0];
  assert.deepEqual(
    trackRows(reopened).map((r) => r.id),
    order,
  );
  assert.deepEqual(
    validate(project).filter((i) => i.level === "error"),
    [],
  );
});
test("nonoverlapping material can reuse a track; moving into an occupied interval creates another without overwriting", () => {
  const { scene } = fixture();
  const a = { id: "a", startMs: 0, endMs: 2000 };
  assignTrack(scene, "audio", a);
  scene.audio.push(a);
  const b = { id: "b", startMs: 2000, endMs: 4000 };
  assignTrack(scene, "audio", b, a.trackId);
  scene.audio.push(b);
  assert.equal(a.trackId, b.trackId);
  b.startMs = 1000;
  b.endMs = 3000;
  assignTrack(scene, "audio", b, b.trackId);
  assert.notEqual(a.trackId, b.trackId);
  assert.equal(scene.audio.length, 2);
  assert.deepEqual([a.startMs, a.endMs], [0, 2000]);
});
test("lift keeps original trim, preserves associated content, supports video overlays and exact undo", () => {
  const { project, scene } = fixture();
  const clip = scene.clips[0];
  clip.inMs = 1000;
  clip.outMs = 8000;
  const event = newEvent(2000);
  event.endMs = 4000;
  event.linkedClipId = clip.id;
  scene.events.push(event);
  const history = new History(project),
    before = structuredClone(project);
  history.commit("lift", (p) => {
    const s = p.scenes[0],
      overlay = liftVisual(s, clip.id, 1000);
    assignTrack(s, "overlay", overlay);
  });
  const s = history.project.scenes[0],
    overlay = s.overlays[0];
  assert.deepEqual(
    [overlay.inMs, overlay.startMs, overlay.endMs],
    [1000, 1000, 8000],
  );
  assert.deepEqual([s.events[0].startMs, s.events[0].endMs], [3000, 5000]);
  assert.equal(s.events[0].linkedClipId, undefined);
  assert.equal(duration(s), 8000);
  assert.deepEqual(
    validate(history.project).filter((i) => i.level === "error"),
    [],
  );
  history.undo();
  assert.deepEqual(history.project, before);
});
test("one choice with many options is one operation; independent overlaps identify both events, including nested ranges", () => {
  const { scene } = fixture();
  const choice = newEvent(1000, "choice", 7000);
  scene.events.push(choice);
  assert.equal(interactionConflicts(scene).length, 0);
  const qte = newEvent(2000, "qte", 1000);
  scene.events.push(qte);
  assert.equal(interactionConflicts(scene).length, 0);
  const other = newEvent(2200, "qte", 500);
  scene.events.push(other);
  const conflict = interactionConflicts(scene)[0];
  assert.equal(conflict.kind, "occlusion");
  assert.deepEqual([conflict.start, conflict.end], [2200, 2700]);
  assert.deepEqual(
    new Set([conflict.a.id, conflict.b.id]),
    new Set([qte.id, other.id]),
  );
});
test("main insertion preserves overlay layers and pushes later material, video overlay source bounds are checked", () => {
  const { project, scene } = fixture();
  const overlay = {
    id: "ov",
    assetId: "v",
    inMs: 1000,
    startMs: 1000,
    endMs: 4000,
    x: 50,
    y: 50,
    width: 35,
    volume: 1,
  };
  assignTrack(scene, "overlay", overlay);
  scene.overlays.push(overlay);
  const trackId = overlay.trackId;
  insertVisual(scene, project.assets.i, 0);
  assert.equal(overlay.trackId, trackId);
  assert.deepEqual([overlay.startMs, overlay.endMs], [4000, 7000]);
  assert.deepEqual(
    validate(project).filter((x) => x.level === "error"),
    [],
  );
  overlay.inMs = 9000;
  assert.ok(validate(project).some((x) => x.message.includes("叠加视频截取")));
});
