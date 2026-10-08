import test from "node:test";
import assert from "node:assert/strict";
import {
  Projects,
  ProjectCoordinator,
} from "../outputs/cloudflare/projects.mjs";
import { demoProject } from "../outputs/storyforge/studio/demo.mjs";
const token = "test-only",
  hash = "a".repeat(64);
function setup() {
  const map = new Map();
  const storage = {
    get: async (k) => map.get(k) || null,
    put: async (k, v) => {
      map.set(k, v);
    },
  };
  let media = true;
  const service = new Projects(storage, async () => media);
  return { service, map, storage, removeMedia: () => (media = false) };
}
function req(
  path,
  method = "GET",
  data = null,
  revision = "none",
  auth = true,
) {
  return new Request("http://test/api/v2" + path, {
    method,
    headers: {
      ...(auth ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
      "If-Match": revision,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
function project() {
  const p = demoProject();
  for (const a of Object.values(p.assets)) a.source = "/api/media/" + hash;
  return p;
}
test("drafts require authorization, revisions prevent lost updates, releases remain immutable", async () => {
  const { service } = setup(),
    p = project();
  const call = (r) => service.fetch(r, { token });
  assert.equal(
    (await call(req("/draft?id=" + p.id, "GET", null, "none", false))).status,
    401,
  );
  const saved = await call(req("/draft", "PUT", { project: p }));
  assert.equal(saved.status, 200);
  const { revision } = await saved.json();
  p.name = "new";
  assert.equal((await call(req("/draft", "PUT", { project: p }))).status, 409);
  assert.equal(
    (await call(req("/draft", "PUT", { project: p }, revision))).status,
    200,
  );
  const published = await call(req("/publish", "POST", { project: p }));
  assert.equal(published.status, 200);
  const v = await published.json();
  p.name = "draft change";
  const release = await (
    await call(req("/release/" + v.version, "GET", null, "none", false))
  ).json();
  assert.equal(release.project.name, "new");
  assert.deepEqual(release.project.editor, { positions: {} });
  assert.equal(
    (await call(req("/publish", "POST", { project: p }, "none"))).status,
    409,
  );
  const newer = await (
    await call(req("/publish", "POST", { project: p }, v.version))
  ).json();
  assert.equal(
    (await call(req("/restore", "POST", { version: v.version }, newer.version)))
      .status,
    200,
  );
  assert.equal(
    (await (await call(req("/published", "GET", null, "none", false))).json())
      .version,
    v.version,
  );
});
test("missing media never changes the published pointer, including rollback", async () => {
  const { service, removeMedia, map } = setup(),
    p = project();
  const call = (r) => service.fetch(r, { token });
  const first = await (
    await call(req("/publish", "POST", { project: p }))
  ).json();
  const previous = map.get("latest");
  removeMedia();
  assert.equal(
    (await call(req("/publish", "POST", { project: p }, first.version))).status,
    400,
  );
  assert.equal(map.get("latest"), previous);
  assert.equal(
    (
      await call(
        req("/restore", "POST", { version: first.version }, first.version),
      )
    ).status,
    400,
  );
});
test("game service refuses private reads and writes even when a valid token is supplied", async () => {
  const { service } = setup();
  assert.equal(
    (
      await service.fetch(req("/draft", "PUT", { project: project() }), {
        token,
        gameOnly: true,
      })
    ).status,
    401,
  );
  assert.equal(
    (await service.fetch(req("/versions"), { token, gameOnly: true })).status,
    401,
  );
});
test("Durable Object coordinator serializes competing draft updates", async () => {
  const { storage } = setup();
  const coordinator = new ProjectCoordinator(
    { storage },
    { PUBLISH_TOKEN: token },
  );
  const p = project();
  const results = await Promise.all([
    coordinator.fetch(req("/draft", "PUT", { project: p })),
    coordinator.fetch(req("/draft", "PUT", { project: p })),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 409],
  );
});
test("malformed input and undeclared operations are rejected before storage", async () => {
  const { service, map } = setup();
  for (const payload of [
    { schemaVersion: 2 },
    null,
    { ...project(), scenes: [null] },
  ])
    assert.equal(
      (
        await service.fetch(req("/draft", "PUT", { project: payload }), {
          token,
        })
      ).status,
      400,
    );
  assert.equal(map.size, 0);
});
