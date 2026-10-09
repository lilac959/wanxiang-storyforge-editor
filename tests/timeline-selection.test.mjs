import test from "node:test";
import assert from "node:assert/strict";
import {
  moveSelection,
  copySelection,
  pasteSelection,
} from "../outputs/storyforge/studio/timeline-selection.mjs";
const scene = () => ({
  source: "sequence",
  clips: [
    {
      id: "a",
      kind: "image",
      assetId: "img",
      startMs: 0,
      inMs: 0,
      outMs: 1000,
    },
    {
      id: "b",
      kind: "image",
      assetId: "img",
      startMs: 4000,
      inMs: 0,
      outMs: 1000,
    },
  ],
  events: [
    {
      id: "event",
      startMs: 100,
      endMs: 900,
      linkedClipId: "a",
      options: [{ id: "option" }],
    },
  ],
  audio: [],
  subtitles: [],
  overlays: [],
  effects: [],
});
test("group movement shifts linked content exactly once and rejects occupied main-track destinations", () => {
  const s = scene();
  moveSelection(s, ["a", "event"], 1000);
  assert.equal(s.events[0].startMs, 1100);
  assert.equal(s.clips[0].startMs, 1000);
  const before = structuredClone(s);
  assert.throws(() => moveSelection(s, ["a"], 3000), /重叠/);
  assert.deepEqual(s, before);
});
test("paste regenerates IDs, preserves internal links and shifts later content together", () => {
  const s = scene(),
    clipboard = copySelection(s, ["a", "event"]);
  let seq = 0;
  const result = pasteSelection(s, clipboard, 4000, () => `new-${++seq}`);
  assert.equal(s.clips.find((x) => x.id === "b").startMs, 5000);
  assert.equal(result[1].item.linkedClipId, result[0].item.id);
  assert.equal(result[1].item.startMs, 4100);
  assert.notEqual(result[1].item.options[0].id, "option");
  assert.equal(clipboard.entries[0].item.id, "a");
});
