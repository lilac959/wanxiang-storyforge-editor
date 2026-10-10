import test from "node:test";
import assert from "node:assert/strict";
import {
  rulerTicks,
  zoomScroll,
  previewRate,
} from "../outputs/storyforge/studio/timeline-controls.mjs";
import { demoProject } from "../outputs/storyforge/studio/demo.mjs";
import { migrate } from "../outputs/storyforge/studio/model.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
import { previewTime } from "../outputs/storyforge/studio/timeline.mjs";

test("slow preview follows decoded time, freezes on seeks and crosses continuous cuts", () => {
  const clip = {
    id: "slow",
    kind: "video",
    assetId: "v",
    startMs: 1000,
    inMs: 1000,
    outMs: 2000,
    playbackRate: 0.25,
  };
  const next = {
    ...clip,
    id: "next",
    startMs: 5000,
    inMs: 2000,
    outMs: 3000,
    playbackRate: 1,
  };
  const scene = { source: "sequence", clips: [clip, next] };
  const video = {
    currentTime: 1.125,
    readyState: 4,
    paused: false,
    seeking: false,
  };
  assert.equal(previewTime(scene, 1400, 100, 1, clip, video), 1500);
  assert.equal(previewTime(scene, 1500, 100, 1, clip, video), 1500);
  assert.equal(
    previewTime(scene, 1400, 100, 1, clip, { ...video, seeking: true }),
    1400,
  );
  assert.equal(
    previewTime(scene, 1400, 100, 1, clip, { ...video, paused: true }),
    1400,
  );
  assert.equal(
    previewTime(scene, 4900, 100, 1, clip, { ...video, currentTime: 2.05 }),
    5000,
  );
  assert.equal(
    previewTime(scene, 5000, 16, 1, next, { ...video, currentTime: 2.05 }),
    5050,
  );
  assert.equal(
    previewTime({ source: "sequence", clips: [] }, 2000, 300, 0.5, null, null),
    2050,
  );
});

test("ruler density adapts to zoom and zoom preserves the chosen time under the pointer", () => {
  const small = rulerTicks(10000, 400),
    large = rulerTicks(10000, 1600);
  assert.ok(large.length > small.length);
  assert.equal(small[0], 0);
  assert.ok(small.every(Number.isFinite));
  const scroll = zoomScroll(0.4, 2000, 300);
  assert.equal((scroll + 300 - 70) / 2000, 0.4);
});

test("timeline preview obeys speed intervals and markers survive saving/reopening", () => {
  const p = demoProject(),
    scene = p.scenes[0];
  scene.markers = [{ id: "marker-one", name: "角色落地", timeMs: 2200 }];
  assert.equal(
    previewRate(
      { effects: [{ kind: "speed", startMs: 1000, endMs: 2000, value: 0.5 }] },
      1500,
    ),
    0.5,
  );
  assert.equal(
    previewRate(
      { effects: [{ kind: "speed", startMs: 1000, endMs: 2000, value: 0.5 }] },
      2000,
    ),
    1,
  );
  assert.deepEqual(
    migrate(JSON.parse(JSON.stringify(p))).scenes[0].markers,
    scene.markers,
  );
});

test("trial can start an unfinished story and reports only the missing route actually reached", () => {
  const p = demoProject(),
    seen = [];
  p.scenes[1].next = { kind: "scene", sceneId: "not-created" };
  const runtime = new Runtime(p, (event) => seen.push(event));
  runtime.start(p.scenes[0].id);
  assert.equal(runtime.state, "playing");
  assert.equal(
    seen.some((e) => e.type === "blocked"),
    false,
  );
  runtime.follow({ kind: "unlinked" });
  assert.equal(runtime.state, "complete");
  assert.equal(seen.at(-1).type, "blocked");
  assert.equal(seen.at(-1).sceneId, p.scenes[0].id);
  runtime.start(p.scenes[1].id);
  runtime.follow(p.scenes[1].next);
  assert.equal(seen.at(-1).message, "目标节点不存在");
});
