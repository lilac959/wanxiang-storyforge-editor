import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newScene,
  clone,
  validate,
} from "../outputs/storyforge/studio/model.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
import {
  LOADING,
  SPLASH,
  arrangeFlow,
  flowPositions,
  flowPorts,
  routeFlow,
} from "../outputs/storyforge/studio/flow-layout.mjs";
const ports = (s) => [
  { path: "next", label: "播放结束", target: s.next },
  ...s.events.flatMap((e, i) =>
    e.options.map((o, j) => ({
      path: `events.${i}.options.${j}.target`,
      label: o.text,
      target: o.target,
    })),
  ),
];
test("flow ranks branch and convergence, separates disconnected nodes and preserves story", () => {
  const p = newProject("flow"),
    a = p.scenes[0],
    b = newScene("B"),
    c = newScene("C"),
    d = newScene("D"),
    loose = newScene("Loose");
  p.scenes.push(b, c, d, loose);
  a.next = { kind: "scene", sceneId: b.id };
  a.events = [
    { options: [{ text: "C", target: { kind: "scene", sceneId: c.id } }] },
  ];
  b.next = c.next = { kind: "scene", sceneId: d.id };
  d.next = { kind: "scene", sceneId: a.id };
  const before = clone(p),
    xy = arrangeFlow(p, ports);
  assert.ok(xy[LOADING].x < xy[SPLASH].x && xy[SPLASH].x < xy[a.id].x);
  assert.equal(xy[b.id].x, xy[c.id].x);
  assert.notEqual(xy[b.id].y, xy[c.id].y);
  assert.ok(xy[d.id].x > xy[b.id].x);
  assert.ok(xy[loose.id].y > xy[d.id].y + 150);
  assert.deepEqual(p, before);
  p.editor.positions = xy;
  const sub = arrangeFlow(p, ports, new Set([b.id, c.id]));
  assert.deepEqual(sub[a.id], xy[a.id]);
  assert.deepEqual(sub[d.id], xy[d.id]);
});
test("opening nodes are unique and ordinary continue/seek remain inside a scene", () => {
  const p = newProject(),
    s = p.scenes[0];
  assert.equal(flowPorts(p, { id: LOADING }, ports)[0].target.sceneId, SPLASH);
  assert.equal(
    flowPorts(p, { id: SPLASH }, ports)[0].target.sceneId,
    p.entryId,
  );
  s.next = { kind: "continue" };
  assert.equal(flowPorts(p, s, ports).length, 0);
  s.next = { kind: "home" };
  assert.equal(flowPorts(p, s, ports)[0].target.sceneId, SPLASH);
  const old = clone(p.editor.positions),
    xy = flowPositions(p);
  assert.deepEqual(p.editor.positions, old);
  p.editor.positions = xy;
  assert.deepEqual(flowPositions(p), xy);
});
test("orthogonal routing avoids intervening cards and sends returns outside", () => {
  const boxes = [
    { x: 0, y: 100, w: 240, h: 180 },
    { x: 350, y: 80, w: 240, h: 230 },
    { x: 700, y: 100, w: 240, h: 180 },
  ];
  const points = routeFlow({ x: 240, y: 180 }, { x: 700, y: 140 }, boxes);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    assert.ok(a.x === b.x || a.y === b.y);
    const r = boxes[1];
    const crossing =
      a.x === b.x
        ? a.x > r.x &&
          a.x < r.x + r.w &&
          Math.max(a.y, b.y) > r.y &&
          Math.min(a.y, b.y) < r.y + r.h
        : a.y > r.y &&
          a.y < r.y + r.h &&
          Math.max(a.x, b.x) > r.x &&
          Math.min(a.x, b.x) < r.x + r.w;
    assert.equal(crossing, false);
  }
  const back = routeFlow({ x: 940, y: 180 }, { x: 0, y: 140 }, boxes, {
    back: true,
  });
  assert.ok(Math.max(...back.map((p) => p.y)) > 310);
});
test("return to splash is a validated playback action and stops the scene clock", () => {
  const p = newProject(),
    s = p.scenes[0];
  s.next = { kind: "home" };
  assert.equal(validate(p).filter((x) => x.level === "error").length, 0);
  let home = 0;
  const r = new Runtime(p, (e) => {
    if (e.type === "home") home++;
  });
  r.start();
  r.follow(s.next);
  assert.equal(home, 1);
  assert.equal(r.playing, false);
  assert.equal(r.state, "idle");
});
