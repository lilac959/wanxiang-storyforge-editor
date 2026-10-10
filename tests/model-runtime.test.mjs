import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  newProject,
  newScene,
  newEvent,
  duration,
  validate,
  migrate,
  clone,
  sceneTarget,
} from "../outputs/storyforge/studio/model.mjs";
import { demoProject } from "../outputs/storyforge/studio/demo.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
import { History, SaveQueue } from "../outputs/storyforge/studio/history.mjs";
function advance(r, ms) {
  for (let t = 0; t < ms; t += 50) r.tick(Math.min(50, ms - t));
}
function project() {
  const p = newProject("测试作品");
  p.scenes[0].durationMs = 10000;
  return p;
}
test("demonstration has a playable video, subtitles, audio, two routes and distinct endings", () => {
  const p = demoProject();
  assert.deepEqual(
    validate(p, { publish: true }).filter((x) => x.level === "error"),
    [],
  );
  assert.equal(p.scenes.length, 5);
  assert.equal(p.scenes[0].events.length, 2);
  assert.ok(p.scenes[0].audio.length && p.scenes[0].subtitles.length);
});
test("schema rejects scripts, invalid targets, duplicate IDs and overlapping events", () => {
  const p = project();
  const e = newEvent(1000);
  e.endMs = 4000;
  p.scenes[0].events.push(e, clone(e));
  p.scenes[0].next = { kind: "scene", sceneId: "missing" };
  p.assets.a = {
    id: "a",
    name: "a",
    kind: "video",
    mime: "video/mp4",
    source: "javascript:alert(1)",
  };
  const issues = validate(p);
  assert.ok(issues.some((x) => x.message.includes("重复")));
  assert.ok(issues.some((x) => x.message.includes("重叠")));
  assert.ok(issues.some((x) => x.message.includes("不存在")));
  assert.ok(issues.some((x) => x.message.includes("地址")));
});
test("pause and buffering freeze both scene and real operation clocks", () => {
  const p = project(),
    e = newEvent(1000);
  e.endMs = 5000;
  p.scenes[0].events = [e];
  const r = new Runtime(p);
  r.start();
  advance(r, 1000);
  advance(r, 1000);
  const time = r.timeMs,
    elapsed = r.active.elapsedMs;
  r.pause();
  advance(r, 2000);
  assert.equal(r.timeMs, time);
  assert.equal(r.active.elapsedMs, elapsed);
  r.resume();
  r.tick(200, null, true);
  assert.equal(r.active.elapsedMs, elapsed);
  advance(r, 3000);
  assert.equal(r.active, null);
});
test("slow motion has an independent real countdown and restores only the current interval", () => {
  const p = project(),
    e = newEvent(1000);
  e.endMs = 5000;
  e.timeoutMs = 1000;
  e.success.restoreSpeed = true;
  p.scenes[0].events = [e];
  p.scenes[0].effects = [
    { id: "slow", kind: "speed", startMs: 1000, endMs: 5000, value: 0.25 },
    { id: "later", kind: "speed", startMs: 6000, endMs: 8000, value: 0.5 },
  ];
  const r = new Runtime(p);
  r.start();
  advance(r, 1000);
  r.beginOperation();
  advance(r, 500);
  assert.equal(r.active.elapsedMs, 500);
  assert.ok(r.timeMs < 1200);
  r.resolve(true);
  assert.equal(r.rate, 1);
  advance(r, 5000);
  assert.equal(r.rate, 0.5);
});
test("multiple events inside one video execute once; duplicate choice cannot add score twice", () => {
  const p = project();
  p.variables = { score: 0 };
  const q = newEvent(1000);
  q.endMs = 2000;
  q.success.actions = [{ variable: "score", op: "add", value: 1 }];
  const c = newEvent(3000, "choice");
  c.endMs = 4000;
  c.options[0].target = { kind: "continue" };
  c.options[0].actions = [{ variable: "score", op: "add", value: 5 }];
  p.scenes[0].events = [q, c];
  const r = new Runtime(p);
  r.start();
  advance(r, 1000);
  r.resolve(true);
  r.resolve(true);
  assert.equal(r.variables.score, 1);
  advance(r, 2000);
  const id = r.active.event.options[0].id;
  r.resolve(true, id);
  r.resolve(true, id);
  assert.equal(r.variables.score, 6);
});
test("forward seek skips events; explicit backwards retry re-arms without implicit variable rollback", () => {
  const p = project();
  p.variables = { score: 0 };
  const e = newEvent(2000);
  e.endMs = 3000;
  e.success.actions = [{ variable: "score", op: "add", value: 1 }];
  p.scenes[0].events = [e];
  const r = new Runtime(p);
  r.start();
  r.seek(5000);
  advance(r, 100);
  assert.equal(r.variables.score, 0);
  assert.equal(r.active, null);
  r.seek(1000);
  advance(r, 1000);
  r.resolve(true);
  assert.equal(r.variables.score, 1);
  r.seek(1000);
  advance(r, 1000);
  r.resolve(true);
  assert.equal(r.variables.score, 2);
});
test("scene-end success continues the current clip, then jumps; restart clears variables and events", () => {
  const p = project();
  p.variables = { score: 0 };
  const b = newScene("下一段");
  p.scenes.push(b);
  const e = newEvent(1000);
  e.endMs = 3000;
  e.success = {
    target: sceneTarget(b.id),
    timing: "sceneEnd",
    restoreSpeed: true,
    actions: [{ op: "set", variable: "score", value: 3 }],
  };
  p.scenes[0].events = [e];
  const r = new Runtime(p);
  r.start();
  advance(r, 1000);
  r.resolve(true);
  assert.equal(r.scene.id, p.entryId);
  advance(r, 9000);
  assert.equal(r.scene.id, b.id);
  assert.equal(r.variables.score, 3);
  r.start();
  assert.equal(r.variables.score, 0);
  assert.equal(r.processed.size, 0);
});
test("video source time mapping respects trims; scene runtime accepts local milliseconds", () => {
  const p = project();
  p.scenes[0].video = { id: "clip", assetId: "a", inMs: 10000, outMs: 40000 };
  assert.equal(duration(p.scenes[0]), 30000);
  const r = new Runtime(p);
  r.start();
  r.tick(50, 15000 - p.scenes[0].video.inMs);
  assert.equal(r.timeMs, 5000);
});
test("conditions use typed comparisons and permitted variable actions", () => {
  const p = project();
  p.variables = { key: false };
  const e = newEvent(1000);
  e.endMs = 2000;
  e.condition = { variable: "key", op: "eq", value: true };
  p.scenes[0].events = [e];
  const r = new Runtime(p);
  r.start();
  advance(r, 2000);
  assert.equal(r.active, null);
  p.scenes[0].events[0].success.actions = [
    { op: "eval", variable: "key", value: true },
  ];
  assert.ok(validate(p).some((x) => x.message === "变量动作无效"));
});
test("undo/redo restores a replacement reference without altering original media identity", () => {
  const p = project();
  p.assets.a = { id: "a", source: "asset-original" };
  const h = new History(p);
  h.commit("replace", (p) => (p.assets.a.source = "asset-replacement"));
  h.undo();
  assert.equal(h.project.assets.a.source, "asset-original");
  h.redo();
  assert.equal(h.project.assets.a.source, "asset-replacement");
});
test("serialized autosave coalesces new edits and updates revisions only after acknowledgment", async () => {
  let release;
  const calls = [];
  const queue = new SaveQueue(async (p, rev) => {
    calls.push([p.name, rev]);
    if (calls.length === 1) await new Promise((r) => (release = r));
    return { revision: "r" + calls.length };
  });
  const one = queue.enqueue({ name: "one" });
  queue.enqueue({ name: "two" });
  queue.enqueue({ name: "three" });
  release();
  await one;
  assert.deepEqual(calls, [
    ["one", "none"],
    ["three", "r1"],
  ]);
  assert.equal(queue.revision, "r2");
});
test("failed saves retain the newest pending edit and never report success", async () => {
  const states = [];
  let fail = true;
  const queue = new SaveQueue(
    async () => {
      if (fail) throw Object.assign(Error("conflict"), { status: 409 });
      return { revision: "r1" };
    },
    (state) => states.push(state),
  );
  await queue.enqueue({ name: "newest" });
  assert.equal(queue.pending.project.name, "newest");
  assert.equal(queue.revision, "none");
  assert.ok(!states.includes("saved"));
  fail = false;
  await queue.enqueue({ name: "newer" });
  assert.equal(queue.revision, "r1");
});
test("the actual repository project snapshot migrates and round-trips without touching original bytes", () => {
  const file = fs.readFileSync(
    "project-snapshot/wanxiang-current.storyforge.zip",
  );
  if (file.subarray(0, 4).toString() === "vers")
    throw Error(
      "Fetch Git LFS project snapshot before running migration checks",
    );
  let pos = 0,
    raw;
  while (file.readUInt32LE(pos) === 0x04034b50) {
    const length = file.readUInt32LE(pos + 18),
      nameLength = file.readUInt16LE(pos + 26),
      extra = file.readUInt16LE(pos + 28),
      name = file.subarray(pos + 30, pos + 30 + nameLength).toString(),
      start = pos + 30 + nameLength + extra;
    if (name === "project.storyforge.json") {
      raw = JSON.parse(file.subarray(start, start + length));
      break;
    }
    pos = start + length;
  }
  assert.ok(raw);
  const before = JSON.stringify(raw),
    p = migrate(raw);
  assert.equal(
    p.scenes.filter((s) => !["loading", "splash"].includes(s.role)).length,
    raw.nodes.length,
  );
  assert.equal(
    p.scenes.filter((s) => ["loading", "splash"].includes(s.role)).length,
    2,
  );
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(
    validate(p).filter((x) => x.level === "error"),
    [],
  );
  assert.deepEqual(
    migrate(JSON.parse(JSON.stringify(p))),
    JSON.parse(JSON.stringify(p)),
  );
  for (const old of raw.nodes.filter((n) => n.tailQte)) {
    const scene = p.scenes.find((s) => s.id === old.id);
    assert.ok(scene.effects.some((e) => e.kind === "speed"));
    assert.equal(scene.events[0].success.timing, "sceneEnd");
    assert.equal(scene.events[0].gesture, old.qteGesture || "click");
  }
});

test("waiting window and operation deadline are independent; pause freezes both", () => {
  const p = project(),
    e = newEvent(2000);
  e.endMs = 6000;
  e.timeoutMs = 3000;
  e.failure.target = { kind: "continue" };
  p.scenes[0].events = [e];
  const r = new Runtime(p);
  r.start();
  advance(r, 5000);
  assert.equal(r.active.elapsedMs, 0);
  assert.equal(r.mediaPaused, false);
  r.beginOperation();
  advance(r, 2000);
  assert.equal(r.timeMs, 5000);
  assert.equal(r.active.elapsedMs, 2000);
  r.pause();
  advance(r, 5000);
  assert.equal(r.active.elapsedMs, 2000);
  r.resume();
  advance(r, 1000);
  assert.equal(r.active, null);
  advance(r, 500);
  assert.equal(r.timeMs, 5500);
  r.start();
  advance(r, 6000);
  assert.equal(r.active, null);
  assert.equal(r.timeMs, 6000);
  assert.equal(r.playing, true);
});
test("unanswered interaction follows configured failure branch once", () => {
  const p = project(),
    e = newEvent(1000),
    next = newScene("失败分支");
  e.endMs = 2000;
  e.failure.target = { kind: "scene", sceneId: next.id };
  p.scenes[0].events = [e];
  p.scenes.push(next);
  const r = new Runtime(p);
  r.start();
  advance(r, 2000);
  assert.equal(r.scene.id, next.id);
});
