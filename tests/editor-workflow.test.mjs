import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newEvent,
  newScene,
  validate,
  migrate,
  duration,
  clone,
} from "../outputs/storyforge/studio/model.mjs";
import {
  appendVisual,
  splitClip,
  moveClip,
  reorderClip,
  removeClip,
  duplicateClip,
  mediaAt,
  visualClips,
} from "../outputs/storyforge/studio/timeline.mjs";
import {
  copyScenes,
  deleteScenes,
} from "../outputs/storyforge/studio/graph-commands.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";
const fixture = () => {
  const p = newProject();
  const a = {
    id: "asset-a",
    name: "A",
    kind: "video",
    durationMs: 5000,
    source: "assets/demo/original.mp4",
    mime: "video/mp4",
  };
  p.assets[a.id] = a;
  appendVisual(p.scenes[0], a);
  return p;
};
test("legacy trim maps to sequence without changing source or event times", () => {
  const p = newProject(),
    s = p.scenes[0];
  s.video = { id: "clip-old", assetId: "asset-a", inMs: 1000, outMs: 4000 };
  p.schemaVersion = 2;
  p.assets["asset-a"] = {
    id: "asset-a",
    name: "A",
    kind: "video",
    source: "assets/a.mp4",
    mime: "video/mp4",
    durationMs: 5000,
  };
  const m = migrate(p);
  appendVisual(m.scenes[0], p.assets["asset-a"]);
  assert.equal(duration(m.scenes[0]), 8000);
  assert.equal(mediaAt(m.scenes[0], 3500).startMs, 3000);
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.scenes[0].source, "video");
  assert.deepEqual(
    validate(m).filter((x) => x.level === "error"),
    [],
  );
});
test("split keeps source continuity and reassigns linked events", () => {
  const p = fixture(),
    s = p.scenes[0],
    first = s.clips[0],
    e = newEvent(3000);
  e.endMs = 4000;
  e.linkedClipId = first.id;
  s.events.push(e);
  const right = splitClip(s, first.id, 2000);
  assert.equal(first.outMs, right.inMs);
  assert.equal(right.startMs, 2000);
  assert.equal(e.linkedClipId, right.id);
  assert.equal(duration(s), 5000);
  assert.equal(mediaAt(s, 1999).id, first.id);
  assert.equal(mediaAt(s, 2000).id, right.id);
  assert.deepEqual(
    validate(p).filter((x) => x.level === "error"),
    [],
  );
});
test("move keeps linked content and gap; overlap rejection is transactional", () => {
  const p = fixture(),
    s = p.scenes[0],
    c = s.clips[0];
  s.subtitles.push({
    id: "sub-a",
    linkedClipId: c.id,
    startMs: 500,
    endMs: 1200,
  });
  moveClip(s, c.id, 2000);
  assert.equal(s.subtitles[0].startMs, 2500);
  assert.equal(mediaAt(s, 1000), null);
  const second = appendVisual(s, p.assets["asset-a"]);
  const history = new History(p);
  const before = clone(history.project);
  assert.throws(
    () => history.commit("move", (p) => moveClip(p.scenes[0], second.id, 1000)),
    /重叠/,
  );
  assert.deepEqual(history.project, before);
  assert.equal(history.past.length, 0);
});
test("reorder and duplicate follow linked timing; ripple deletion removes only requested data", () => {
  const p = fixture(),
    s = p.scenes[0],
    c = s.clips[0];
  s.audio.push({ id: "audio-a", linkedClipId: c.id, startMs: 100, endMs: 900 });
  const b = appendVisual(s, p.assets["asset-a"]);
  reorderClip(s, b.id, -1);
  assert.equal(s.audio[0].startMs, 5100);
  const copy = duplicateClip(s, c.id);
  assert.equal(s.audio.length, 2);
  assert.equal(s.audio[1].linkedClipId, copy.id);
  removeClip(s, c.id, true, true);
  assert.equal(s.audio.length, 1);
  assert.equal(s.audio[0].startMs, 5100);
  assert.equal(s.clips.find((x) => x.id === copy.id).startMs, 5000);
});
test("copy group regenerates content IDs, preserves internal links and marks external exits", () => {
  const p = fixture(),
    s = p.scenes[0],
    b = newScene("B"),
    outside = newScene("outside");
  p.scenes.push(b, outside);
  s.next = { kind: "scene", sceneId: b.id };
  b.next = { kind: "scene", sceneId: outside.id };
  const copies = copyScenes(p, [s.id, b.id]);
  assert.equal(copies[0].next.sceneId, copies[1].id);
  assert.equal(copies[1].next.kind, "unlinked");
  assert.notEqual(copies[0].clips[0].id, s.clips[0].id);
  assert.equal(copies[0].clips[0].assetId, s.clips[0].assetId);
  assert.equal(
    validate(p).some((x) => x.code === "structure"),
    false,
  );
});
test("delete entry requires replacement; undo restores cards and inbound edges", () => {
  const p = fixture(),
    b = newScene("B");
  p.scenes.push(b);
  b.next = { kind: "scene", sceneId: p.entryId };
  const history = new History(p),
    old = p.entryId;
  assert.throws(() => deleteScenes(clone(p), [old]), /入口/);
  history.commit("delete", (p) => deleteScenes(p, [old], b.id));
  assert.equal(history.project.entryId, b.id);
  assert.equal(history.project.scenes[0].next.kind, "unlinked");
  assert.equal(
    validate(history.project, { publish: true }).some((x) =>
      x.message.includes("未连接"),
    ),
    true,
  );
  history.undo();
  assert.deepEqual(history.project, p);
});

test("opening layout survives migration and rejects invalid positions", () => {
  const p = newProject("Opening layout");
  p.loading.layout = {
    title: { x: 23, y: 31, size: 96, width: 32, color: "#e5d6b1" },
  };
  p.splash.startText = "点击开始故事";
  assert.deepEqual(migrate(p).loading.layout, p.loading.layout);
  assert.equal(
    validate(p).some((x) => x.message.includes("开场")),
    false,
  );
  p.loading.layout.title.x = 101;
  assert.equal(
    validate(p).some((x) => x.message.includes("开场元素")),
    true,
  );
  p.loading.layout.title.x = 23;
  p.loading.layout.title.color = "invalid";
  assert.equal(
    validate(p).some((x) => x.message.includes("开场元素")),
    true,
  );
});

test("removed simple UI migrates to original components without changing story options", () => {
  const p = newProject();
  p.theme.preset = "simple";
  const e = newEvent(0, "choice", 1000);
  e.uiComponent = "simple-choice@1";
  e.uiPreset = "simple";
  p.scenes[0].events = [e];
  const options = clone(e.options);
  const restored = migrate(p);
  assert.equal(restored.theme.preset, "classic");
  assert.equal(restored.scenes[0].events[0].uiComponent, "classic-choice@1");
  assert.equal(restored.scenes[0].events[0].uiPreset, "classic");
  assert.deepEqual(restored.scenes[0].events[0].options, options);
});
