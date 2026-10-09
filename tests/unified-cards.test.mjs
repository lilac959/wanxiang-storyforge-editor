import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newScene,
  newEvent,
  migrate,
  unifyCards,
  openingCard,
  changeRole,
  setCardNext,
  clone,
  validate,
  resolveOpeningDuration,
} from "../outputs/storyforge/studio/model.mjs";
test("old opening videos without metadata adopt their real duration and keep default element ranges aligned", () => {
  const p = newProject();
  p.assets.v = {
    id: "v",
    kind: "video",
    source: "assets/v.mp4",
    name: "v.mp4",
  };
  p.loading.video = "v";
  unifyCards(p);
  const load = openingCard(p, "loading");
  assert.equal(load.clips[0].outMs, 8000);
  resolveOpeningDuration(p, "v", 6080);
  assert.equal(load.clips[0].outMs, 6080);
  assert.equal(load.opening.elements.progress.endMs, 6080);
  load.clips[0].outMs = 5000;
  resolveOpeningDuration(p, "v", 6080);
  assert.equal(load.clips[0].outMs, 5000);
});
import {
  copyScenes,
  deleteScenes,
} from "../outputs/storyforge/studio/graph-commands.mjs";
import {
  flowNodes,
  flowPorts,
  arrangeFlow,
} from "../outputs/storyforge/studio/flow-layout.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";

test("old opening settings become real cards once, preserving timeline and layouts", () => {
  const p = newProject("旧作品");
  p.loading.layout = {
    title: { x: 22, y: 35, size: 90, width: 30, color: "#e5d6b1" },
  };
  const original = clone(p),
    result = migrate(p);
  assert.deepEqual(p, original);
  assert.equal(result.scenes.length, 3);
  assert.deepEqual(result.scenes[0], p.scenes[0]);
  assert.deepEqual(
    openingCard(result, "loading").opening.layout,
    p.loading.layout,
  );
  assert.deepEqual(migrate(result), result);
  assert.equal(flowNodes(result).length, 3);
  assert.equal(
    flowPorts(result, openingCard(result, "loading"), () => [])[0].label,
    "加载完成",
  );
  assert.ok(
    arrangeFlow(result, (s) => [{ path: "next", target: s.next }])[
      result.entryId
    ],
  );
});
test("purpose replacement keeps media and suspended interactions, copy is an ordinary card", () => {
  const p = unifyCards(newProject()),
    next = newScene("下一张");
  p.scenes.push(next);
  const old = openingCard(p, "splash"),
    source = p.scenes[0];
  source.events = [newEvent(0, "qte", 1000)];
  source.next = { kind: "scene", sceneId: next.id };
  const content = clone(source.events),
    routes = clone(source.next);
  changeRole(p, source.id, "splash");
  assert.equal(old.role, "story");
  assert.equal(p.entryId, next.id);
  assert.equal(p.scenes.filter((s) => s.role === "splash").length, 1);
  assert.deepEqual(source.events, content);
  const [copy] = copyScenes(p, [source.id]);
  assert.equal(copy.role, "story");
  changeRole(p, source.id, "story");
  assert.deepEqual(source.next, routes);
  assert.deepEqual(source.events, content);
});
test("opening cards can be removed, deleting splash makes loading enter the story", () => {
  const p = unifyCards(newProject()),
    load = openingCard(p, "loading"),
    splash = openingCard(p, "splash");
  deleteScenes(p, [splash.id], p.entryId);
  assert.equal(load.next.sceneId, p.entryId);
  deleteScenes(p, [load.id], p.entryId);
  assert.equal(flowNodes(p).length, 1);
  assert.equal(openingCard(p, "splash"), undefined);
  assert.deepEqual(migrate(p), p);
});
test("opening timeline cannot auto-start story or execute dormant branch actions", () => {
  const p = unifyCards(newProject()),
    splash = openingCard(p, "splash");
  splash.durationMs = 1000;
  splash.opening.loop = false;
  splash.events = [newEvent(0, "qte", 1000)];
  const r = new Runtime(p);
  r.start(splash.id);
  r.tick(250, 1000);
  assert.equal(r.scene.id, splash.id);
  assert.equal(r.active, null);
  assert.equal(r.playing, false);
  r.follow(splash.next);
  assert.equal(r.scene.id, p.entryId);
  splash.opening.loop = true;
  const loop = new Runtime(p);
  loop.start(splash.id);
  loop.tick(250, 1000);
  assert.equal(loop.scene.id, splash.id);
  assert.equal(loop.timeMs, 0);
  assert.equal(loop.playing, true);
});
test("invalid opening roles, layout and loading cycles cannot pass validation", () => {
  const p = unifyCards(newProject()),
    load = openingCard(p, "loading");
  load.next = { kind: "scene", sceneId: load.id };
  load.opening.layout = {
    title: { x: -1, y: 50, size: 40, width: 50, color: "#ffffff" },
  };
  assert.ok(validate(p).some((x) => x.message === "开场卡片连接无效"));
  assert.ok(validate(p).some((x) => x.message === "开场元素位置或样式无效"));
  const splash = openingCard(p, "splash");
  splash.opening.elements.start.hidden = true;
  assert.ok(
    validate(p, { publish: true }).some(
      (x) => x.level === "error" && x.message.includes("可点击的开始按钮"),
    ),
  );
});
test("switching between loading and splash keeps each configuration and a valid start route", () => {
  const p = unifyCards(newProject()),
    scene = openingCard(p, "splash"),
    load = openingCard(p, "loading"),
    next = newScene("新入口");
  p.scenes.push(next);
  scene.opening.startText = "开始冒险";
  changeRole(p, scene.id, "loading");
  assert.equal(load.role, "story");
  assert.equal(scene.opening.minimumMs, 1000);
  changeRole(p, scene.id, "splash");
  assert.equal(scene.opening.startText, "开始冒险");
  setCardNext(p, scene.id, { kind: "scene", sceneId: next.id });
  assert.equal(p.entryId, next.id);
  assert.throws(
    () => setCardNext(p, scene.id, { kind: "scene", sceneId: scene.id }),
    /开屏/,
  );
  assert.deepEqual(
    validate(p).filter((x) => x.level === "error"),
    [],
  );
});
