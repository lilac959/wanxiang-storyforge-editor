import test from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newScene,
  unifyCards,
  openingCard,
} from "../outputs/storyforge/studio/model.mjs";
import {
  preloadProject,
  resourceList,
} from "../outputs/storyforge/studio/preload.mjs";
import { Runtime } from "../outputs/storyforge/studio/runtime.mjs";
import {
  firstVideoFrame,
  nativeOpeningLoop,
} from "../outputs/storyforge/studio/media-ready.mjs";

function fixture() {
  const p = unifyCards(newProject("全量加载"));
  for (const id of ["cover", "loading", "splash", "branch", "audio", "unused"])
    p.assets[id] = {
      id,
      name: id,
      kind: id === "cover" ? "image" : id === "audio" ? "audio" : "video",
      source: "/" + id,
      size: 4,
      mime: "video/mp4",
    };
  const clip = (id, assetId) => ({
    id,
    assetId,
    kind: "video",
    startMs: 0,
    inMs: 0,
    outMs: 1000,
  });
  openingCard(p, "loading").opening.image = "cover";
  openingCard(p, "loading").clips = [clip("load", "loading")];
  openingCard(p, "splash").clips = [clip("splash", "splash")];
  const branch = newScene("另一个分支");
  branch.source = "sequence";
  branch.clips = [clip("branch", "branch")];
  branch.audio = [{ id: "audio", assetId: "audio", startMs: 0, endMs: 1000 }];
  p.scenes.push(branch);
  return p;
}
function store() {
  const blobs = new Map();
  return {
    blobs,
    prepared: new Map(),
    cacheKey: (a) => a.source,
    cached: async (a) => blobs.get(a.source),
    prepare: async (a, b) => {
      blobs.set(a.source, b);
    },
    url: async (a) => a.source,
  };
}
const inspectAsset = async () => ({ durationMs: 1000 });
const response = () =>
  new Response(new Uint8Array(4), { headers: { "Content-Length": "4" } });

test("all referenced branches/audio are loaded once; unused assets excluded and loading media prioritized", async () => {
  const p = fixture(),
    s = store(),
    calls = [],
    progress = [];
  p.assets.alias = { ...p.assets.branch, id: "alias" };
  p.scenes[0].audio.push({ assetId: "alias" });
  assert.deepEqual(
    resourceList(p)
      .slice(0, 2)
      .map((a) => a.id),
    ["cover", "loading"],
  );
  assert.deepEqual(
    new Set(resourceList(p).map((a) => a.source)),
    new Set(["/cover", "/loading", "/splash", "/branch", "/audio"]),
  );
  await preloadProject(p, s, {
    inspectAsset,
    fetcher: async (url) => {
      calls.push(url);
      return response();
    },
    onProgress: (x) => progress.push(x),
  });
  assert.equal(calls.length, 5);
  assert.equal(p.assets.alias.durationMs, 1000);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(progress.at(-1).total, 20);
  assert.equal(s.blobs.size, 5);
  assert.ok(progress.slice(0, -1).every((x) => x.percent <= 100));
});

test("100% cannot be reached while any response body or readiness check is unfinished", async () => {
  const p = fixture(),
    s = store(),
    progress = [];
  let release, started;
  const waiting = new Promise((r) => (started = r));
  const done = preloadProject(p, s, {
    inspectAsset,
    onProgress: (x) => progress.push(x),
    fetcher: async (url) =>
      url !== "/audio"
        ? response()
        : new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array(2));
                release = () => {
                  c.enqueue(new Uint8Array(2));
                  c.close();
                };
                started();
              },
            }),
            { headers: { "Content-Length": "4" } },
          ),
  });
  await waiting;
  await new Promise((r) => setImmediate(r));
  assert.ok(progress.every((x) => x.percent < 100));
  assert.equal(s.blobs.has("/audio"), false);
  release();
  await done;
  assert.equal(progress.at(-1).percent, 100);
});

test("truncated downloads fail without caching partial bytes; retries reuse completed files", async () => {
  const p = fixture(),
    s = store();
  await assert.rejects(
    preloadProject(p, s, {
      inspectAsset,
      fetcher: async (url) =>
        url === "/audio"
          ? new Response(new Uint8Array(1), {
              headers: { "Content-Length": "4" },
            })
          : response(),
    }),
    /audio.*不完整/,
  );
  assert.equal(s.blobs.has("/audio"), false);
  const completed = new Set(s.blobs.keys()),
    fetched = [];
  await preloadProject(p, s, {
    inspectAsset,
    fetcher: async (url) => {
      fetched.push(url);
      return response();
    },
  });
  assert.ok(fetched.every((url) => !completed.has(url)));
  await preloadProject(p, s, {
    inspectAsset,
    fetcher: async () => {
      throw Error("cache should avoid network");
    },
  });
});

test("aborted loading cannot begin more requests or publish readiness", async () => {
  const controller = new AbortController(),
    s = store();
  controller.abort();
  await assert.rejects(
    preloadProject(fixture(), s, {
      signal: controller.signal,
      inspectAsset,
      fetcher: async () => {
        assert.fail("unexpected fetch");
      },
      onReady: () => assert.fail("unexpected ready"),
    }),
    { name: "AbortError" },
  );
});

test("video handoff waits for a decoded frame and seek completion; cancellation removes listeners", async () => {
  const v = Object.assign(new EventTarget(), { readyState: 1, seeking: false });
  let ready = false;
  const pending = firstVideoFrame(v).then(() => (ready = true));
  v.dispatchEvent(new Event("loadedmetadata"));
  await Promise.resolve();
  assert.equal(ready, false);
  v.readyState = 2;
  v.seeking = true;
  v.dispatchEvent(new Event("loadeddata"));
  await Promise.resolve();
  assert.equal(ready, false);
  v.seeking = false;
  v.dispatchEvent(new Event("seeked"));
  await pending;
  assert.equal(ready, true);
  const controller = new AbortController();
  v.readyState = 1;
  const cancelled = firstVideoFrame(v, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
});

test("opening loops retain runtime generation and native looping only applies to complete single videos", () => {
  const p = fixture(),
    splash = openingCard(p, "splash"),
    events = [];
  const runtime = new Runtime(p, (e) => events.push(e.type));
  runtime.start(splash.id);
  const generation = runtime.generation;
  for (let i = 0; i < 4; i++) runtime.tick(250, 1000);
  assert.equal(runtime.generation, generation);
  assert.equal(events.filter((x) => x === "scene").length, 1);
  assert.equal(events.filter((x) => x === "loop").length, 4);
  assert.equal(runtime.timeMs, 0);
  assert.equal(nativeOpeningLoop(splash, splash.clips[0], 1), true);
  assert.equal(
    nativeOpeningLoop(splash, { ...splash.clips[0], inMs: 100 }, 1),
    false,
  );
  assert.equal(
    nativeOpeningLoop(
      { ...splash, clips: [...splash.clips, ...splash.clips] },
      splash.clips[0],
      1,
    ),
    false,
  );
});
