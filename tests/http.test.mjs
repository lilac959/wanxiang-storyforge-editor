import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { newProject } from "../outputs/storyforge/studio/model.mjs";

test("HTTP adapter uploads original bytes, serves ranges, isolates drafts, and persists releases across restart", async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const folder = await mkdtemp(join(tmpdir(), "storyforge-http-"));
  let child;
  async function start() {
    child = spawn(process.execPath, ["work/server.cjs"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        STORYFORGE_DATA: folder,
        PUBLISH_TOKEN: "http-test-only",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error("server failed to start");
      }),
    ]);
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const done = once(child, "exit");
      child.kill();
      await done;
    }
  }
  const root = `http://127.0.0.1:${port}`,
    auth = { Authorization: "Bearer http-test-only" };
  try {
    await start();
    assert.equal((await fetch(root + "/")).status, 200);
    const player = await (await fetch(root + "/game/")).text();
    assert.ok(player.includes("studio/game.mjs"));
    assert.ok(!player.includes("studio/editor.mjs"));
    const bytes = Buffer.from("RIFForiginal-media-bytes-WAVE"),
      hash = createHash("sha256").update(bytes).digest("hex"),
      media = "/api/media/" + hash;
    assert.equal(
      (await fetch(root + media + "/part/0", { method: "PUT", body: bytes }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(root + media + "/part/0", {
          method: "PUT",
          headers: { ...auth, "X-Total-Parts": "1" },
          body: bytes,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(root + media, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "audio/wav",
            size: bytes.length,
            parts: 1,
            partSizes: [bytes.length],
          }),
        })
      ).status,
      200,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(root + media)).arrayBuffer()),
      bytes,
    );
    const range = await fetch(root + media, {
      headers: { Range: "bytes=4-11" },
    });
    assert.equal(range.status, 206);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes.subarray(4, 12),
    );
    const p = newProject("HTTP publication");
    p.scenes[0].role = "ending";
    const save = await fetch(root + "/api/v2/draft", {
      method: "PUT",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        "If-Match": "none",
      },
      body: JSON.stringify({ project: p }),
    });
    assert.equal(save.status, 200);
    assert.equal((await fetch(root + "/api/v2/draft?id=" + p.id)).status, 401);
    const release = await fetch(root + "/api/v2/publish", {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        "If-Match": "none",
      },
      body: JSON.stringify({ project: p }),
    });
    assert.equal(release.status, 200);
    const version = (await release.json()).version;
    await stop();
    await start();
    const restored = await (await fetch(root + "/api/v2/published")).json();
    assert.equal(restored.version, version);
    assert.equal(restored.project.name, p.name);
    assert.deepEqual(
      Buffer.from(await (await fetch(root + media)).arrayBuffer()),
      bytes,
    );
  } finally {
    await stop();
    await rm(folder, { recursive: true, force: true });
  }
});
