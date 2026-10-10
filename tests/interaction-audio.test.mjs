import test from "node:test";
import assert from "node:assert/strict";
import { PlayerView } from "../outputs/storyforge/studio/player-view.mjs";
import { createQteAudio } from "../outputs/storyforge/studio/audio.mjs";

function view(events) {
  const calls = [];
  const v = Object.create(PlayerView.prototype);
  Object.assign(v, {
    editing: false,
    muted: false,
    loading: false,
    soundKey: null,
    cues: { start: (n) => calls.push(n), stop: () => calls.push("stop") },
    runtime: {
      playing: true,
      interactions: new Map(events.map((e) => [e.id, { event: e }])),
      active: null,
    },
  });
  return { v, calls };
}
test("hotspots and concurrent interactions receive one heartbeat, without restarting on ticks", () => {
  const { v, calls } = view([
    { id: "silent", kind: "choice", sound: "off" },
    {
      id: "hot",
      kind: "hotspot",
      sound: "heartbeat",
      volume: 0.35,
      timeoutMs: 4000,
    },
    {
      id: "qte",
      kind: "qte",
      sound: "heartbeat",
      volume: 0.5,
      timeoutMs: 5000,
    },
  ]);
  v.syncInteractionSound();
  v.syncInteractionSound();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].qteVolume, 0.35);
  v.runtime.interactions.delete("hot");
  v.syncInteractionSound();
  assert.equal(calls[1].qteVolume, 0.5);
  v.runtime.playing = false;
  v.syncInteractionSound();
  assert.equal(calls.at(-1), "stop");
  v.runtime.playing = true;
  v.syncInteractionSound();
  assert.equal(calls.at(-1).qteVolume, 0.5);
  v.muted = true;
  v.syncInteractionSound();
  assert.equal(calls.at(-1), "stop");
});
test("editor, loading, disabled sound and zero volume do not synthesize heartbeat", () => {
  const { v, calls } = view([
    { id: "off", sound: "off" },
    { id: "zero", volume: 0 },
  ]);
  v.syncInteractionSound();
  assert.equal(calls.length, 0);
  v.runtime.interactions.set("sound", { event: { id: "sound" } });
  v.editing = true;
  v.syncInteractionSound();
  v.editing = false;
  v.loading = true;
  v.syncInteractionSound();
  assert.equal(calls.length, 0);
});
test("audio starts after browser resume; separate players and canceled resumes cannot stop or restart each other", async () => {
  const oldWindow = globalThis.window;
  const contexts = [];
  const param = () => ({
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  class Context {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.starts = 0;
      contexts.push(this);
    }
    createGain() {
      return { gain: param(), connect() {}, disconnect() {} };
    }
    createOscillator() {
      return {
        frequency: param(),
        connect() {},
        disconnect() {},
        start: () => this.starts++,
        stop() {},
      };
    }
    resume() {
      return new Promise((resolve) => {
        this.ready = () => {
          this.state = "running";
          resolve();
        };
      });
    }
    close() {
      return Promise.resolve();
    }
  }
  globalThis.window = { AudioContext: Context };
  const a = createQteAudio({ listen: false }),
    b = createQteAudio({ listen: false });
  try {
    a.start({});
    b.start({});
    assert.equal(contexts[0].starts, 0);
    b.stop();
    contexts[0].ready();
    contexts[1].ready();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(contexts[0].starts, 4);
    assert.equal(contexts[1].starts, 0);
    b.stop();
    assert.equal(contexts[0].starts, 4);
  } finally {
    a.dispose();
    b.dispose();
    globalThis.window = oldWindow;
  }
});
