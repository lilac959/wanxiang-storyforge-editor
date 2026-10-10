import test from "node:test";
import assert from "node:assert/strict";
import {
  shortcutAction,
  splitAt,
  trimRight,
  packMain,
  copyProperties,
  pasteProperties,
  restoreAudio,
} from "../outputs/storyforge/studio/timeline-shortcuts.mjs";
import {
  newProject,
  newScene,
  newEvent,
} from "../outputs/storyforge/studio/model.mjs";
import { clipLength, mediaAt } from "../outputs/storyforge/studio/timeline.mjs";
import { separateAudio } from "../outputs/storyforge/studio/media-editing.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
const scene = () => ({
  ...newScene("测试"),
  source: "sequence",
  clips: [
    {
      id: "a",
      kind: "video",
      assetId: "video",
      startMs: 0,
      inMs: 0,
      outMs: 2000,
    },
    {
      id: "b",
      kind: "video",
      assetId: "video",
      startMs: 3000,
      inMs: 2000,
      outMs: 4000,
    },
  ],
});
test("shortcut modifier combinations never fall through to single keys", () => {
  const key = (key, extra = {}) => shortcutAction({ key, ...extra });
  assert.equal(key("c"), "split");
  assert.equal(key("C", { ctrlKey: true, shiftKey: true }), "copy-properties");
  assert.equal(key("b", { ctrlKey: true, shiftKey: true }), "split-all");
  assert.equal(key("b", { ctrlKey: true }), null);
  assert.equal(key("s", { ctrlKey: true, shiftKey: true }), "toggle-audio");
  assert.equal(key("z", { shiftKey: true }), "fit");
  assert.equal(key("B"), "toggle-enabled");
  assert.equal(key("~", { shiftKey: true }), "linkage");
  assert.equal(key("c", { isComposing: true }), null);
  assert.equal(key("c", { altKey: true }), null);
});
test("batch split uses original trim and skips locked tracks; right trim preserves source speed", () => {
  const s = scene();
  s.clips[0].playbackRate = 0.5;
  s.subtitles = [{ id: "sub", startMs: 0, endMs: 3000, text: "字幕" }];
  splitAt(s, 1000, null, new Set(["sub"]));
  assert.equal(s.clips[0].outMs, 500);
  assert.equal(s.clips[1].inMs, 500);
  assert.equal(s.subtitles.length, 1);
  trimRight(s, new Set([s.clips[1].id]), 2000);
  assert.equal(s.clips[1].outMs, 1000);
});
test("main magnet packs clips and linkage independently controls associated items", () => {
  const s = scene();
  s.subtitles = [{ id: "sub", linkedClipId: "b", startMs: 3500, endMs: 4000 }];
  packMain(s);
  assert.equal(s.clips[1].startMs, 2000);
  assert.equal(s.subtitles[0].startMs, 2500);
  const off = scene();
  off.editorTimeline = { linkage: false };
  off.subtitles = [
    { id: "sub", linkedClipId: "b", startMs: 3500, endMs: 4000 },
  ];
  packMain(off);
  assert.equal(off.subtitles[0].startMs, 3500);
});
test("property paste preserves content and ids while retiming speed; restoring audio removes only paired sound", () => {
  const s = scene();
  s.clips[0].scale = 70;
  s.clips[0].playbackRate = 0.5;
  pasteProperties(s, new Set(["b"]), copyProperties(s, "a"));
  assert.equal(s.clips[1].scale, 70);
  assert.equal(s.clips[1].id, "b");
  assert.equal(s.clips[1].inMs, 2000);
  assert.equal(clipLength(s.clips[1]), 4000);
  const audio = separateAudio(s, s.clips[0]);
  s.audio.push({ id: "independent", startMs: 0, endMs: 2000 });
  assert.equal(restoreAudio(s, s.clips[0])[0].id, audio.id);
  assert.equal(s.audio[0].id, "independent");
  assert.equal(s.clips[0].audioDetached, false);
});
test("disabled media retains its timeline space and disabled interactions never execute", () => {
  const s = scene();
  s.clips[0].enabled = false;
  assert.equal(mediaAt(s, 1000), null);
  assert.equal(clipLength(s.clips[0]), 2000);
  const p = newProject();
  p.scenes = [s];
  p.entryId = s.id;
  const e = newEvent(0);
  e.endMs = 1000;
  e.enabled = false;
  s.events = [e];
  const r = new Runtime(p);
  r.start(s.id);
  r.tick(100, 500);
  assert.equal(r.interactions.size, 0);
});
