import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newEvent,
  validate,
  clone,
} from "../outputs/storyforge/studio/model.mjs";
import {
  appendVisual,
  insertVisual,
  moveVisual,
  trimVisual,
  clipLength,
} from "../outputs/storyforge/studio/timeline.mjs";
import {
  componentDemo,
  componentEvent,
  UI_COMPONENTS,
} from "../outputs/storyforge/studio/ui-components.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";
import {
  curveFlow,
  shortcutTarget,
  SPLASH,
} from "../outputs/storyforge/studio/flow-layout.mjs";
test("timeline insertion preserves original media and shifts linked interaction; undo restores all", () => {
  const p = newProject(),
    a = {
      id: "a",
      kind: "video",
      source: "assets/a.mp4",
      name: "a",
      durationMs: 4000,
    };
  p.assets.a = a;
  const scene = p.scenes[0],
    first = appendVisual(scene, a),
    second = appendVisual(scene, a);
  const event = newEvent(5000);
  event.endMs = 7000;
  event.linkedClipId = second.id;
  scene.events.push(event);
  const before = clone(p),
    h = new History(p);
  h.commit("insert", (p) => insertVisual(p.scenes[0], a, 3500));
  const s = h.project.scenes[0];
  assert.deepEqual(
    s.clips.map((c) => c.startMs),
    [0, 4000, 8000],
  );
  assert.equal(s.events[0].startMs, 9000);
  assert.equal(s.events[0].linkedClipId, second.id);
  assert.equal(s.clips.find((c) => c.id === first.id).outMs, 4000);
  h.undo();
  assert.deepEqual(h.project, before);
});
test("occupied visual drop reorders without overlap and follows linked content; trim cannot overwrite neighbor", () => {
  const p = newProject(),
    s = p.scenes[0],
    a = { id: "a", kind: "video", durationMs: 4000 };
  const first = appendVisual(s, a),
    second = appendVisual(s, a);
  const e = newEvent(4500);
  e.endMs = 6500;
  e.linkedClipId = second.id;
  s.events.push(e);
  moveVisual(s, second.id, 0);
  assert.equal(s.clips[0].id, second.id);
  assert.equal(e.startMs, 500);
  trimVisual(s, second.id, "right", 2000, 10000);
  assert.equal(clipLength(s.clips[0]), 4000);
  trimVisual(s, second.id, "left", 1000, 10000);
  assert.equal(s.clips[0].startMs, 1000);
  assert.equal(s.clips[0].inMs, 1000);
  assert.equal(s.clips[0].startMs + clipLength(s.clips[0]), 4000);
  assert.equal(s.clips[1].id, first.id);
});
test("UI components create independent interactions; demonstrations validate and wait for real input", () => {
  for (const c of UI_COMPONENTS) {
    const p = componentDemo(c.id);
    assert.deepEqual(
      validate(p).filter((x) => x.level === "error"),
      [],
    );
    assert.equal(p.scenes[0].events[0].endMode, "wait");
    assert.notEqual(componentEvent(c.id).id, componentEvent(c.id).id);
  }
});
test("normal routes use curves and shortcut destinations do not alter story targets", () => {
  const p = newProject(),
    t = { kind: "scene", sceneId: SPLASH };
  assert.equal(shortcutTarget(p, t), true);
  assert.equal(t.kind, "scene");
  const d = curveFlow({ x: 240, y: 80 }, { x: 400, y: 180 }, []);
  assert.match(d, / C/);
  assert.ok(!d.includes("NaN"));
});
