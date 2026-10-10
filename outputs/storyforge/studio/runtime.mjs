import {
  clone,
  duration,
  evaluate,
  applyActions,
  clamp,
  openingRole,
} from "./model.mjs";

// No DOM, media elements or editor selection state. A view supplies media time.
export class Runtime {
  constructor(project, changed = () => {}) {
    this.project = clone(project);
    this.changed = changed;
    this.variables = clone(project.variables);
    this.generation = 0;
    this.state = "idle";
    this.scene = null;
    this.timeMs = 0;
    this.playing = false;
    this.processed = new Set();
    this.active = null;
    this.pending = null;
    this.suppressedSpeeds = new Set();
  }
  emit(type = "tick", detail = {}) {
    this.changed({ type, ...detail }, this);
  }
  start(id = this.project.entryId, time = 0) {
    this.variables = clone(this.project.variables);
    this.enter(id, time, true);
  }
  enter(id, time = 0, skip = false) {
    const scene = this.project.scenes.find((s) => s.id === id);
    if (!scene) {
      this.complete();
      return;
    }
    this.generation++;
    this.scene = scene;
    this.pendingEventId = null;
    this.timeMs = clamp(Math.round(time), 0, duration(scene));
    this.playing = true;
    this.state = "playing";
    this.processed = new Set();
    this.active = null;
    this.pending = null;
    this.suppressedSpeeds = new Set();
    if (skip)
      for (const e of scene.events)
        if (e.startMs < this.timeMs) this.processed.add(e.id);
    this.emit("scene");
  }
  complete() {
    this.generation++;
    this.state = "complete";
    this.playing = false;
    this.active = null;
    this.emit("complete");
  }
  stop() {
    this.generation++;
    this.playing = false;
    this.state = "idle";
    this.active = null;
    this.pending = null;
    this.emit("stop");
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.emit("pause");
  }
  resume() {
    if (!this.scene || this.state !== "playing") return;
    this.playing = true;
    this.emit("resume");
  }
  get mediaPaused() {
    return !this.playing || !!this.active?.operating;
  }
  beginOperation() {
    if (!this.playing || !this.active || this.active.operating) return;
    this.active.operating = true;
    this.active.elapsedMs = 0;
    this.emit("operation");
  }
  get rate() {
    if (!this.scene) return 1;
    return (
      this.scene.effects.find(
        (e) =>
          e.kind === "speed" &&
          !this.suppressedSpeeds.has(e.id) &&
          this.timeMs >= e.startMs &&
          this.timeMs < e.endMs,
      )?.value || 1
    );
  }
  visibleOptions() {
    return (
      this.active?.event.options.filter((o) =>
        evaluate(o.condition, this.variables),
      ) || []
    );
  }
  tick(realMs, mediaTime = null, buffering = false) {
    if (!this.playing || this.state !== "playing" || !this.scene || buffering)
      return;
    const token = this.generation,
      d = duration(this.scene),
      dt = clamp(realMs, 0, 250);
    if (!this.active?.operating)
      this.timeMs = clamp(
        Math.round(
          mediaTime === null ? this.timeMs + dt * this.rate : mediaTime,
        ),
        0,
        d,
      );
    if (this.active) {
      if (this.active.operating) this.active.elapsedMs += dt;
      const e = this.active.event;
      if (
        (this.active.operating &&
          this.active.elapsedMs >= (e.timeoutMs || 4000)) ||
        (!this.active.operating && this.timeMs >= Math.min(e.endMs, d))
      )
        this.resolve(false);
    }
    if (token !== this.generation) return;
    if (!this.active && !openingRole(this.scene)) {
      const events = [...this.scene.events].sort(
        (a, b) => a.startMs - b.startMs,
      );
      for (const event of events) {
        if (this.processed.has(event.id) || event.startMs > this.timeMs)
          continue;
        this.processed.add(event.id);
        if (!evaluate(event.condition, this.variables)) continue;
        if (this.timeMs >= event.endMs) continue;
        this.active = { event, elapsedMs: 0, progress: 0, operating: false };
        this.emit("event");
        break;
      }
    }
    if (!this.active && this.timeMs >= d) {
      if (openingRole(this.scene)) {
        if (this.scene.opening?.loop) this.enter(this.scene.id);
        else {
          this.pause();
          this.emit("tick");
        }
        return;
      }
      const target = this.pending || this.scene.next;
      const eventId = this.pending ? this.pendingEventId : null;
      this.pending = null;
      this.pendingEventId = null;
      this.follow(target, eventId);
      if (token === this.generation && target.kind === "continue")
        this.complete();
      return;
    }
    this.emit();
  }
  resolve(ok, optionId = null) {
    if (!this.playing || !this.active) return false;
    const e = this.active.event;
    let result = ok ? e.success : e.failure;
    if (e.kind === "choice" && ok) {
      const o = this.visibleOptions().find((o) => o.id === optionId);
      if (!o) return false;
      result = {
        target: o.target,
        timing: "immediate",
        actions: o.actions,
        restoreSpeed: false,
      };
    }
    this.active = null;
    applyActions(result.actions, this.variables);
    if (result.restoreSpeed)
      for (const f of this.scene.effects)
        if (
          f.kind === "speed" &&
          f.startMs <= this.timeMs &&
          this.timeMs <= f.endMs
        )
          this.suppressedSpeeds.add(f.id);
    this.emit("result", { ok, event: e });
    if (result.timing === "sceneEnd" && result.target.kind !== "continue") {
      this.pending = clone(result.target);
      this.pendingEventId = e.id;
    } else this.follow(result.target, e.id);
    this.emit();
    return true;
  }
  follow(target, eventId = null) {
    if (
      target.kind === "unlinked" ||
      (target.kind === "scene" &&
        !this.project.scenes.some((s) => s.id === target.sceneId))
    ) {
      this.complete();
      this.emit("blocked", {
        sceneId: this.scene?.id,
        eventId,
        message:
          target.kind === "unlinked"
            ? "这条剧情出口还没有连接下一张节点"
            : "目标节点不存在",
      });
    } else if (target.kind === "scene") this.enter(target.sceneId);
    else if (target.kind === "home") {
      this.stop();
      this.emit("home");
    } else if (["end", "unlinked"].includes(target.kind)) this.complete();
    else if (target.kind === "seek") this.seek(target.timeMs);
  }
  seek(time) {
    const from = this.timeMs,
      to = clamp(Math.round(time), 0, duration(this.scene));
    this.active = null;
    this.pending = null;
    this.generation++;
    for (const e of this.scene.events) {
      if (e.startMs < to) this.processed.add(e.id);
      else if (to <= from) this.processed.delete(e.id);
    }
    if (to <= from) this.suppressedSpeeds.clear();
    this.timeMs = to;
    this.emit("seek");
  }
}
