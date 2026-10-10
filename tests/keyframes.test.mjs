import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newScene,
  newEvent,
  migrate,
  validate,
} from "../outputs/storyforge/studio/model.mjs";
import {
  putKeyframe,
  eventTransform,
  writeTransform,
  removeKeyframe,
  shiftKeyframeOrigin,
  keyframeError,
  keyframePoints,
  moveKeyframePoint,
  toggleTransformKeyframe,
} from "../outputs/storyforge/studio/keyframes.mjs";
import {
  splitRange,
  setMediaSpeed,
} from "../outputs/storyforge/studio/media-editing.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";
import { PlayerView } from "../outputs/storyforge/studio/player-view.mjs";

function fixture() {
  const event = newEvent(1000, "hotspot");
  event.endMs = 5000;
  event.x = 20;
  event.y = 30;
  return event;
}
test("keyframes animate each property independently, hold endpoints and support easing", () => {
  const event = fixture();
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 2000, { x: 80, y: 70 });
  putKeyframe(event, "scale", 1000, { scale: 50 });
  putKeyframe(event, "scale", 3000, { scale: 100 });
  assert.equal(eventTransform(event, event, 500).x, 20);
  assert.equal(eventTransform(event, event, 2000).x, 50);
  assert.equal(eventTransform(event, event, 2000).scale, 50);
  assert.equal(eventTransform(event, event, 3000).scale, 75);
  assert.equal(eventTransform(event, event, 6000).x, 80);
  event.keyframes.position[0].easing = "easeIn";
  assert.equal(eventTransform(event, event, 2000).x, 35);
  assert.equal(keyframeError(event), null);
});
test("editing animated values inserts or updates one frame and unanimated values remain static", () => {
  const event = fixture();
  writeTransform(event, event, 1000, { x: 25 });
  assert.equal(event.x, 25);
  assert.equal(event.keyframes, undefined);
  putKeyframe(event, "position", 0);
  writeTransform(event, event, 3000, { x: 75 });
  assert.deepEqual(event.keyframes.position[1].values, { x: 75, y: 30 });
  writeTransform(event, event, 3000, { y: 60, stretchX: 150 });
  assert.equal(event.keyframes.position.length, 2);
  assert.equal(event.keyframes.position[1].values.y, 60);
  assert.equal(event.stretchX, 150);
  removeKeyframe(event, "position", event.keyframes.position[0].id);
  removeKeyframe(event, "position", event.keyframes.position[0].id);
  assert.equal(event.x, 75);
});
test("moving, trimming and splitting animated interactions preserve motion including options", () => {
  const event = fixture();
  event.options = [{ id: "option", x: 0, y: 0, scale: 100 }];
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 4000, { x: 80, y: 70 });
  putKeyframe(event.options[0], "position", 0);
  putKeyframe(event.options[0], "position", 4000, { x: 40, y: 20 });
  const original = structuredClone(event);
  event.startMs += 1000;
  event.endMs += 1000;
  assert.equal(
    eventTransform(event, event, 3000).x,
    eventTransform(original, original, 2000).x,
  );
  event.startMs += 500;
  shiftKeyframeOrigin(event, 500);
  assert.equal(
    eventTransform(event, event, 3000).x,
    eventTransform(original, original, 2000).x,
  );
  const scene = { events: [event] };
  const right = splitRange(scene, event, "event", 4000);
  assert.equal(
    eventTransform(right, right, 4500).x,
    eventTransform(original, original, 3500).x,
  );
  assert.equal(
    eventTransform(right, right.options[0], 4500).x,
    eventTransform(original, original.options[0], 3500).x,
  );
  assert.notEqual(right.options[0].id, "option");
});
test("linked video retiming scales keyframes and linkage off preserves them", () => {
  const event = fixture();
  event.linkedClipId = "video";
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 2000, { x: 80, y: 70 });
  const scene = {
    source: "sequence",
    clips: [
      {
        id: "video",
        kind: "video",
        assetId: "v",
        startMs: 0,
        inMs: 0,
        outMs: 6000,
        playbackRate: 1,
      },
    ],
    events: [event],
    subtitles: [],
    audio: [],
    overlays: [],
    effects: [],
  };
  setMediaSpeed(scene, scene.clips[0], 0.5);
  assert.equal(event.startMs, 2000);
  assert.equal(event.keyframes.position[1].timeMs, 4000);
  assert.equal(eventTransform(event, event, 4000).x, 50);
  scene.editorTimeline = { linkage: false };
  setMediaSpeed(scene, scene.clips[0], 1);
  assert.equal(event.keyframes.position[1].timeMs, 4000);
});
test("keyframe data survives project migration and malformed positions are rejected", () => {
  const project = newProject(),
    scene = newScene("动画");
  scene.source = "sequence";
  scene.clips = [
    {
      id: "image",
      kind: "image",
      assetId: "img",
      startMs: 0,
      inMs: 0,
      outMs: 6000,
    },
  ];
  project.assets.img = {
    id: "img",
    kind: "image",
    name: "img",
    mime: "image/png",
    size: 1,
    source: "assets/img.png",
    durationMs: 0,
    width: 1920,
    height: 1080,
  };
  project.scenes.push(scene);
  const event = fixture();
  scene.events.push(event);
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 2000, { x: 80, y: 70 });
  const saved = migrate(structuredClone(project));
  assert.deepEqual(
    saved.scenes.find((s) => s.id === scene.id).events[0].keyframes,
    event.keyframes,
  );
  event.keyframes.position[0].values.x = 200;
  assert.match(keyframeError(event), /位置/);
  assert.ok(validate(project).some((i) => /关键帧/.test(i.message)));
});

test("extending an interaction to the left preserves its existing animation and permits new frames", () => {
  const event = fixture();
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 2000, { x: 80, y: 70 });
  const before = eventTransform(event, event, 2000).x;
  event.startMs -= 500;
  shiftKeyframeOrigin(event, -500);
  assert.equal(eventTransform(event, event, 2000).x, before);
  writeTransform(event, event, 500, { x: 10 });
  assert.equal(keyframeError(event), null);
  assert.equal(eventTransform(event, event, 500).x, 10);
});

test("player applies motion to the existing hit target and freezes when paused, buffering or operating", () => {
  const project = newProject(),
    scene = newScene("motion");
  scene.source = "sequence";
  scene.clips = [
    {
      id: "image",
      kind: "image",
      assetId: "img",
      startMs: 0,
      inMs: 0,
      outMs: 6000,
    },
  ];
  const event = fixture();
  event.endMode = "wait";
  event.pause = true;
  scene.events.push(event);
  project.scenes = [scene];
  project.entryId = scene.id;
  putKeyframe(event, "position", 0);
  putKeyframe(event, "position", 2000, { x: 80, y: 70 });
  putKeyframe(event, "scale", 0, { scale: 50 });
  putKeyframe(event, "scale", 2000, { scale: 100 });
  const runtime = new Runtime(project);
  runtime.start(scene.id);
  runtime.tick(100, 2000);
  const style = {
    setProperty(key, value) {
      this[key] = value;
    },
  };
  const target = { style },
    host = {
      querySelector() {
        return target;
      },
      set innerHTML(_) {
        throw Error("must not replace active target");
      },
    };
  const view = { editing: false, runtime };
  PlayerView.prototype.paintEventTransform.call(view, event, host);
  assert.equal(style.left, "50%");
  assert.equal(style["--scale-x"], 0.75);
  runtime.tick(100, 2500, true);
  assert.equal(runtime.timeMs, 2000);
  runtime.pause();
  runtime.tick(100, 2500);
  assert.equal(runtime.timeMs, 2000);
  runtime.resume();
  runtime.beginOperation();
  runtime.tick(100, 2500);
  assert.equal(runtime.timeMs, 2000);
  PlayerView.prototype.paintEventTransform.call(view, event, host);
  assert.equal(style.left, "50%");
  assert.equal(host.querySelector(), target);
});

test("animated property edits and deletion restore exactly through undo and redo", () => {
  const event = fixture(),
    history = new History(event);
  history.commit("first", (item) => putKeyframe(item, "position", 0));
  history.commit("second", (item) =>
    writeTransform(item, item, 3000, { x: 80 }),
  );
  const animated = structuredClone(history.project);
  history.commit("delete", (item) =>
    removeKeyframe(item, "position", item.keyframes.position[1].id),
  );
  assert.equal(history.project.keyframes.position.length, 1);
  history.undo();
  assert.deepEqual(history.project, animated);
  history.redo();
  assert.equal(history.project.keyframes.position.length, 1);
});

test("clip diamonds group coincident properties and move atomically", () => {
  const event = { startMs: 1000, endMs: 5000, x: 50, y: 50, scale: 100 };
  putKeyframe(event, "position", 0);
  putKeyframe(event, "scale", 0);
  putKeyframe(event, "position", 2000);
  const points = keyframePoints(event);
  assert.equal(points.length, 2);
  assert.equal(points[0].refs.length, 2);
  moveKeyframePoint(event, points[0].refs, 500);
  assert.equal(event.keyframes.position[0].timeMs, 500);
  assert.equal(event.keyframes.scale[0].timeMs, 500);
  assert.throws(() => moveKeyframePoint(event, points[0].refs, 2000));
  assert.equal(event.keyframes.scale[0].timeMs, 500);
  for (const ref of points[0].refs) removeKeyframe(event, ref.property, ref.id);
  assert.equal(keyframePoints(event).length, 1);
});

test("overall keyframe captures XY and sizes, fills partial frames and removes complete point", () => {
  const event = {
    startMs: 0,
    endMs: 4000,
    x: 30,
    y: 60,
    scale: 80,
    stretchX: 100,
    stretchY: 90,
  };
  putKeyframe(event, "position", 0);
  writeTransform(event, event, 1000, { y: 75 });
  assert.deepEqual(event.keyframes.position[1].values, { x: 30, y: 75 });
  toggleTransformKeyframe(event, 1000);
  assert.equal(keyframePoints(event)[1].refs.length, 4);
  assert.equal(event.keyframes.position[1].values.y, 75);
  toggleTransformKeyframe(event, 1000);
  assert.equal(keyframePoints(event).length, 1);
});
