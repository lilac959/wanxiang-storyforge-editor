import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newEvent,
  clone,
  validate,
} from "../outputs/storyforge/studio/model.mjs";
import { appendVisual } from "../outputs/storyforge/studio/timeline.mjs";
import {
  repairTechnicalData,
  describeIssues,
} from "../outputs/storyforge/studio/check-project.mjs";
import { History } from "../outputs/storyforge/studio/history.mjs";

function fixture() {
  const p = newProject();
  const a = {
    id: "asset-a",
    name: "剧情视频.mp4",
    kind: "video",
    source: "assets/demo/original.mp4",
    mime: "video/mp4",
    durationMs: 10000,
  };
  p.assets[a.id] = a;
  appendVisual(p.scenes[0], a);
  return p;
}
test("technical repair fills metadata and missing content identifiers without choosing trims or routes; undo restores exact draft", async () => {
  const p = fixture(),
    s = p.scenes[0];
  delete p.assets["asset-a"].durationMs;
  delete s.clips[0].id;
  s.clips[0].outMs = 12000;
  const e = newEvent(2000, "choice");
  e.endMs = 4000;
  e.options[0].target = { kind: "unlinked" };
  s.events.push(e);
  const before = clone(p);
  const fixed = await repairTechnicalData(p, async () => ({
    durationMs: 10000,
    width: 1920,
    height: 1080,
  }));
  assert.deepEqual(p, before);
  assert.equal(fixed.project.scenes[0].clips[0].outMs, 12000);
  assert.deepEqual(fixed.project.scenes[0].events, before.scenes[0].events);
  assert.equal(fixed.repairs.length, 2);
  assert.ok(
    describeIssues(fixed.project, { publish: true }).some(
      (x) => x.message === "片段出点超过素材时长",
    ),
  );
  const history = new History(p);
  history.commit("作品检查自动修复", (x) => Object.assign(x, fixed.project));
  history.undo();
  assert.deepEqual(history.project, before);
});
test("failed metadata read preserves media and exposes a named manual action, unused media only warns", async () => {
  const p = fixture();
  delete p.assets["asset-a"].durationMs;
  p.assets["asset-unused"] = {
    ...p.assets["asset-a"],
    id: "asset-unused",
    name: "备用视频.mp4",
  };
  const fixed = await repairTechnicalData(p, async () => {
    throw Error("无法解码素材");
  });
  assert.deepEqual(fixed.project, p);
  const issues = describeIssues(p, { failures: fixed.failures });
  assert.equal(issues.find((x) => x.assetId === "asset-a").level, "error");
  assert.equal(
    issues.find((x) => x.assetId === "asset-unused").level,
    "warning",
  );
  assert.equal(issues.find((x) => x.assetId === "asset-a").action, "预览素材");
});
test("checks identify precise clips and root causes, detect nested interaction conflicts, and leave simultaneous subtitles/audio alone", () => {
  const p = fixture(),
    s = p.scenes[0];
  s.clips[0].outMs = NaN;
  const issues = describeIssues(p);
  const timing = issues.find((x) => x.message === "画面片段时间无效");
  assert.equal(timing.itemId, s.clips[0].id);
  assert.match(timing.detail, /剧情视频/);
  assert.equal(timing.field, "outMs");
  assert.ok(!issues.some((x) => x.message === "剧情时长无效"));
  s.clips[0].outMs = 10000;
  s.events = [newEvent(0, "qte"), newEvent(2000, "qte"), newEvent(4000, "qte")];
  s.events[0].endMs = 9000;
  s.events[1].endMs = 3000;
  s.events[2].endMs = 5000;
  const conflicts = describeIssues(p).filter((x) =>
    x.message?.startsWith("互动区间重叠"),
  );
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts[1].relatedId, s.events[0].id);
  assert.match(conflicts[1].detail, /字幕、叠加图片和音效可同时出现/);
  s.events = [];
  assert.ok(!validate(p).some((x) => x.message.includes("互动区间重叠")));
});
test("unknown video duration cannot create a broken timeline; unused placeholder does not block release until connected", () => {
  const p = fixture(),
    s = p.scenes[0],
    before = clone(s);
  assert.throws(
    () => appendVisual(s, { id: "asset-unknown", kind: "video" }),
    /时长尚未读取/,
  );
  assert.deepEqual(s, before);
  const spare = clone(s);
  spare.id = "scene-spare";
  spare.name = "备用卡片";
  spare.source = "video";
  spare.clips = [];
  spare.video = null;
  spare.pending = true;
  spare.next = { kind: "unlinked" };
  p.scenes.push(spare);
  assert.ok(
    !validate(p, { publish: true }).some(
      (x) => x.sceneId === spare.id && x.level === "error",
    ),
  );
  s.next = { kind: "scene", sceneId: spare.id };
  assert.ok(
    validate(p, { publish: true }).some(
      (x) => x.sceneId === spare.id && x.level === "error",
    ),
  );
});
