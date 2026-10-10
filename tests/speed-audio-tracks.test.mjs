import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newEvent,
  validate,
} from "../outputs/storyforge/studio/model.mjs";
import {
  appendVisual,
  clipLength,
  splitClip,
  trimVisual,
  sourceTime,
  timelineTime,
} from "../outputs/storyforge/studio/timeline.mjs";
import {
  setMediaSpeed,
  separateAudio,
  splitRange,
  repairTimelineData,
  migrateLegacySpeed,
} from "../outputs/storyforge/studio/media-editing.mjs";
import {
  trackRows,
  assignTrack,
  consolidateInteractionTracks,
} from "../outputs/storyforge/studio/tracks.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";
function setup() {
  const p = newProject(),
    s = p.scenes[0];
  p.assets.a = {
    id: "a",
    kind: "video",
    name: "video",
    source: "assets/a.mp4",
    durationMs: 10000,
  };
  const c = appendVisual(s, p.assets.a);
  return { p, s, c };
}
test("speed retimes source, preserves gaps, shifts linked content and leaves independent audio untouched", () => {
  const { p, s, c } = setup(),
    next = appendVisual(s, p.assets.a);
  next.startMs += 2000;
  const e = newEvent(13000);
  e.endMs = 14000;
  e.linkedClipId = next.id;
  s.events.push(e);
  const a = separateAudio(s, c),
    before = structuredClone(a);
  setMediaSpeed(s, c, 0.5);
  assert.equal(clipLength(c), 20000);
  assert.equal(next.startMs, 22000);
  assert.equal(e.startMs, 23000);
  assert.deepEqual(a, before);
  assert.equal(sourceTime(c, 10000), 5000);
  assert.equal(timelineTime(c, 5000), 10000);
  assert.equal(
    validate(p).some((x) => /音频.*素材类型|倍速无效|范围超过/.test(x.message)),
    false,
  );
});
test("speed-aware split and trim retain continuous source frames", () => {
  const { s, c } = setup();
  setMediaSpeed(s, c, 0.5);
  const right = splitClip(s, c.id, 8000);
  assert.equal(c.outMs, 4000);
  assert.equal(right.inMs, 4000);
  assert.equal(clipLength(right), 12000);
  trimVisual(s, right.id, "left", 2000, 10000);
  assert.equal(right.inMs, 5000);
  assert.equal(right.startMs, 10000);
  trimVisual(s, right.id, "right", -2000, 10000);
  assert.equal(right.outMs, 9000);
});
test("audio separation, split, speed and undo are independent and reversible", () => {
  const { p } = setup(),
    h = new History(p),
    before = structuredClone(p);
  h.commit("separate", (p) => separateAudio(p.scenes[0], p.scenes[0].clips[0]));
  const s = h.project.scenes[0],
    c = s.clips[0],
    a = s.audio[0];
  assert.equal(c.audioDetached, true);
  assert.equal(a.startMs, c.startMs);
  assert.throws(() => separateAudio(s, c), /已分离/);
  setMediaSpeed(s, a, 2, "audio");
  assert.equal(a.endMs, 5000);
  assert.equal(clipLength(c), 10000);
  const right = splitRange(s, a, "audio", 2000);
  assert.equal(right.inMs, 4000);
  s.audio = [];
  assert.equal(c.audioDetached, true);
  h.undo();
  assert.deepEqual(h.project, before);
});
test("legacy repair recovers numeric strings and untrimmed ends without inventing missing positions", () => {
  const { p, s, c } = setup();
  c.startMs = "0";
  c.outMs = null;
  const e = newEvent(1000);
  e.startMs = null;
  s.events.push(e);
  assert.equal(repairTimelineData(p), 2);
  assert.equal(c.outMs, 10000);
  assert.equal(e.startMs, null);
  assert.equal(repairTimelineData(p), 0);
});
test("unambiguous legacy speed migrates once while ambiguous ranges remain intact", () => {
  const { p, s } = setup();
  s.effects = [
    { id: "speed", kind: "speed", startMs: 2000, endMs: 6000, value: 0.5 },
  ];
  assert.equal(migrateLegacySpeed(p), 1);
  assert.equal(s.effects.length, 0);
  assert.deepEqual(
    s.clips.map((c) => [c.startMs, clipLength(c)]),
    [
      [0, 2000],
      [2000, 8000],
      [10000, 4000],
    ],
  );
  assert.equal(migrateLegacySpeed(p), 0);
  s.effects = [
    { id: "a", kind: "speed", startMs: 0, endMs: 4000, value: 0.5 },
    { id: "b", kind: "speed", startMs: 3000, endMs: 5000, value: 2 },
  ];
  const before = structuredClone(s);
  assert.equal(migrateLegacySpeed(p), 0);
  assert.deepEqual(s, before);
});
test("sequential interactions share one stable track; overlap creates a separate row", () => {
  const { s } = setup();
  for (const [start, end] of [
    [0, 1000],
    [2000, 3000],
    [500, 1500],
  ]) {
    const e = newEvent(start);
    e.endMs = end;
    s.events.push(e);
  }
  consolidateInteractionTracks(s);
  assert.equal(trackRows(s).filter((r) => r.kind === "event").length, 2);
  assert.equal(s.events[0].trackId, s.events[1].trackId);
  assert.notEqual(s.events[0].trackId, s.events[2].trackId);
  const next = newEvent(4000);
  next.endMs = 5000;
  s.events.push(next);
  assignTrack(s, "event", next);
  assert.equal(trackRows(s).filter((r) => r.kind === "event").length, 2);
  assert.equal(consolidateInteractionTracks(s), false);
});
