import test from "node:test";
import assert from "node:assert/strict";
import { projectCatalog } from "../outputs/storyforge/studio/project-catalog.mjs";
test("catalog merges local and cloud by identity without losing either version", () => {
  const local = {
    a: {
      project: { id: "a", name: "本机名称" },
      revision: "old",
      updatedAt: "2026-10-08",
    },
  };
  const cloud = [
    { id: "a", name: "云端名称", updatedAt: "2026-10-09" },
    { id: "b", name: "另一作品", updatedAt: "2026-10-07" },
  ];
  const before = structuredClone({ local, cloud });
  const rows = projectCatalog(local, cloud);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "本机名称");
  assert.equal(rows[0].cloud.name, "云端名称");
  assert.equal(rows[0].local.revision, "old");
  assert.deepEqual({ local, cloud }, before);
});
test("catalog only hides works when no active local or cloud copy remains", () => {
  const local = {
    a: { project: { id: "a", name: "a" }, deleted: true },
    b: { project: { id: "b", name: "b" }, deleted: false },
  };
  const rows = projectCatalog(local, [
    { id: "a", name: "a", deleted: false },
    { id: "b", name: "b", deleted: true },
    { id: "c", name: "c", deleted: true },
  ]);
  assert.equal(rows.find((x) => x.id === "a").deleted, false);
  assert.equal(rows.find((x) => x.id === "b").deleted, false);
  assert.equal(rows.find((x) => x.id === "c").deleted, true);
});
