import { audioVolume } from "./audio-envelope.mjs";
import { visualLayer, itemTrackId } from "./tracks.mjs";
import { GESTURE_PATHS } from "./ui-components.mjs";
import { mediaAt, clipLength, visualClips } from "./timeline.mjs";
import { Runtime } from "./runtime.mjs";
import {
  duration,
  clamp,
  gestures,
  openingRole,
  openingCard,
} from "./model.mjs";
import { esc } from "./storage.mjs";
import { qteAudio } from "./audio.mjs";
import { fittedStage, swipeProgress } from "./interaction-geometry.mjs";

export class PlayerView {
  constructor(
    root,
    assets,
    {
      onExit = () => {},
      onHome = null,
      canExit = false,
      onChange = () => {},
      editing = false,
      onSelect = () => {},
    } = {},
  ) {
    this.root = root;
    this.assets = assets;
    this.onExit = onExit;
    this.onHome = onHome;
    this.onChange = onChange;
    this.editing = editing;
    this.onSelect = onSelect;
    this.token = 0;
    this.audio = new Map();
    this.disposed = false;
    this.muted = false;
    this.pointer = null;
    this.loading = false;
    this.last = performance.now();
    this.eventId = null;
    root.innerHTML =
      '<div class="play-stage"><div class="visual"></div><div class="bars"><i></i><i></i></div><div class="scene-title"></div><div class="captions"></div><div class="interaction"></div><div class="feedback" aria-live="polite"></div><div class="play-message" hidden></div></div><button class="settings-toggle" data-player="settings" aria-label="设置" aria-expanded="false">⚙</button><div class="settings-shade" hidden></div>';
    this.stage = root.querySelector(".play-stage");
    this.menuMarkup(canExit);
    this.stageObserver = new ResizeObserver(() => this.fitStage());
    this.stageObserver.observe(root);
    this.fitStage();
    this.visual = root.querySelector(".visual");
    this.hud = root.querySelector(".interaction");
    this.message = root.querySelector(".play-message");
    this.settingsButton = root.querySelector(".settings-toggle");
    this.settingsButton.hidden = editing;
    this.menu = root.querySelector(".settings-shade");
    this.reveal = (e) => {
      if (
        editing ||
        this.menuOpen ||
        this.runtime?.active?.event.kind === "qte" ||
        this.pointer ||
        performance.now() < (this.interactionUntil || 0)
      )
        return;
      if (e?.type === "pointermove" && e.pointerType !== "mouse") return;
      if (e?.target.closest("button,.interaction,.play-controls")) return;
      this.showSettingsButton();
    };
    root.addEventListener("pointermove", this.reveal);
    root.addEventListener("click", this.reveal);
    this.menuKey = (e) => {
      if (editing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this.menuOpen ? this.closeSettings() : this.openSettings();
      }
      if (e.key === "Tab" && this.menuOpen) {
        const buttons = [...this.menu.querySelectorAll("button")].filter(
          (b) => !b.closest("[hidden]"),
        );
        const first = buttons[0],
          last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", this.menuKey);
    this.settingsButton.addEventListener("focus", () =>
      this.showSettingsButton(),
    );
    this.showSettingsButton();
    this.clickHandler = (e) => {
      const command = e.target.closest("[data-player]")?.dataset.player;
      if (command) {
        if (command === "settings") this.openSettings();
        if (command === "close-settings" || command === "pause")
          this.closeSettings();
        if (command === "restart") {
          if (!this.menuOpen) this.openSettings();
          this.confirmAction = command;
          this.menu.querySelector(".settings-options").hidden = true;
          this.menu.querySelector(".settings-confirm").hidden = false;
          this.menu.querySelector(".settings-confirm p").textContent =
            "重新开始会清除本次进度，确定重新开始？";
          this.menu.querySelector('[data-player="cancel-action"]').focus();
        }
        if (command === "cancel-action") {
          this.resetConfirmation();
          this.menu.querySelector('[data-player="pause"]').focus();
        }
        if (command === "confirm-action") {
          const action = this.confirmAction;
          this.closeSettings(false, false);
          if (action === "restart") this.start(this.project);
        }
        if (command === "sound") {
          this.muted = !this.muted;
          if (this.video) this.video.muted = this.muted;
          for (const a of this.audio.values()) a.muted = this.muted;
          const sound = this.root.querySelector('[data-player="sound"]');
          sound.setAttribute("aria-pressed", String(!this.muted));
          sound.querySelector(".sound-state").textContent = this.muted
            ? "关闭"
            : "开启";
          if (this.muted) qteAudio.stop();
        }
        return;
      }
      if (this.menuOpen) return;
      const choice = e.target.closest("[data-option-id]");
      if (choice && !this.editing) {
        choice.classList.add("choice-confirmed");
        this.runtime?.resolve(true, choice.dataset.optionId);
      }
      const hot = e.target.closest("[data-hotspot]");
      if (hot && !this.editing) this.runtime?.resolve(true);
      const select = e.target.closest("[data-edit-event],[data-edit-item]");
      if (select && this.editing)
        this.onSelect(
          select.dataset.editEvent || select.dataset.editItem,
          select.dataset.editKind || "event",
        );
    };
    root.addEventListener("click", this.clickHandler);
    this.down = (e) => {
      if (
        this.editing ||
        !this.runtime?.playing ||
        this.loading ||
        !this.runtime.active ||
        e.button !== 0 ||
        e.target.closest("button")
      )
        return;
      const event = this.runtime.active.event;
      if (event.kind !== "qte") return;
      e.preventDefault();
      this.pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        began: this.runtime.active.elapsedMs,
        scale: this.stageScale,
      };
      this.hud.querySelector(".qte")?.classList.add("qte-input");
      this.stage.setPointerCapture?.(e.pointerId);
      qteAudio.input(event.gesture);
    };
    this.move = (e) => {
      const active = this.runtime?.active;
      if (
        !this.pointer ||
        this.pointer.id !== e.pointerId ||
        !active ||
        !this.runtime.playing
      )
        return;
      const event = active.event;
      if (!["left", "right", "up", "down"].includes(event.gesture)) return;
      active.progress = swipeProgress(
        event.gesture,
        e.clientX - this.pointer.x,
        e.clientY - this.pointer.y,
        event.distance,
        this.pointer.scale,
      );
      if (!this.muted) qteAudio.progress(active.progress);
      this.paintHud();
      if (active.progress >= 1) {
        this.pointer = null;
        this.runtime.resolve(true);
      }
    };
    this.up = (e) => {
      if (!this.pointer || this.pointer.id !== e.pointerId) return;
      const p = this.pointer;
      this.pointer = null;
      const active = this.runtime?.active;
      if (!active || !this.runtime.playing) return;
      const event = active.event,
        dx = e.clientX - p.x,
        dy = e.clientY - p.y,
        dist = Math.hypot(dx, dy) / Math.max(0.001, p.scale * 2);
      this.hud.querySelector(".qte")?.classList.remove("qte-input");
      if (event.gesture === "click" && dist < 20) this.runtime.resolve(true);
      else if (event.gesture === "multi" && dist < 20) {
        active.clicks = (active.clicks || 0) + 1;
        active.progress = active.clicks / event.clicks;
        if (active.clicks >= event.clicks) this.runtime.resolve(true);
      } else if (["left", "right", "up", "down"].includes(event.gesture)) {
        if (swipeProgress(event.gesture, dx, dy, event.distance, p.scale) >= 1)
          this.runtime.resolve(true);
        else active.progress = 0;
      } else if (event.gesture === "hold") active.progress = 0;
      this.paintHud();
    };
    this.cancel = () => {
      this.pointer = null;
      if (this.runtime?.active) this.runtime.active.progress = 0;
      this.hud.querySelector(".qte")?.classList.remove("qte-input");
      this.paintHud();
    };
    this.visibility = () => {
      if (document.hidden && !this.editing) this.openSettings();
    };
    this.blur = () => {
      this.cancel();
      if (!this.editing) this.openSettings();
    };
    this.stage.addEventListener("pointerdown", this.down);
    this.stage.addEventListener("pointermove", this.move);
    this.stage.addEventListener("pointerup", this.up);
    this.stage.addEventListener("pointercancel", this.cancel);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }
  menuMarkup(canExit) {
    const icon = (paths) =>
      `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    const icons = {
      menu: icon('<path d="M4 6h16M4 12h16M4 18h16"/>'),
      close: icon('<path d="m6 6 12 12M18 6 6 18"/>'),
      play: icon('<path d="m8 5 11 7-11 7Z"/>'),
      sound: icon('<path d="M4 9h4l5-4v14l-5-4H4Z M17 8a6 6 0 0 1 0 8"/>'),
      restart: icon('<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>'),
      home: icon('<path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7"/>'),
      full: icon('<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>'),
      exit: icon('<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>'),
    };
    const button = (key, text) =>
      `<button data-player="${key}"${key === "sound" ? ' aria-pressed="true"' : ""}>${icons[key === "pause" ? "play" : key === "fullscreen" ? "full" : key]}<span>${text}</span>${key === "sound" ? '<b class="sound-state">开启</b>' : ""}</button>`;
    this.root.querySelector(".settings-toggle").innerHTML = icons.menu;
    this.root
      .querySelector(".settings-toggle")
      .setAttribute("aria-label", "暂停与设置");
    this.root.querySelector(".settings-shade").innerHTML =
      `<section class="play-controls" role="dialog" aria-modal="true" aria-label="暂停与设置"><header><span>暂停与设置</span><button data-player="close-settings" aria-label="关闭暂停与设置">${icons.close}</button></header><div class="settings-options">${button("pause", "继续游玩")}${button("sound", "声音")}${button("restart", "重新开始")}</div><div class="settings-confirm" hidden><p></p><button data-player="confirm-action">确定</button><button data-player="cancel-action">取消</button></div><span class="play-status" role="status"></span></section>`;
  }
  fitStage() {
    const media = this.visual?.querySelector("video,img");
    const ratio =
      (media?.videoWidth || media?.naturalWidth || 16) /
      (media?.videoHeight || media?.naturalHeight || 9);
    const fit = fittedStage(
      this.root.clientWidth,
      this.root.clientHeight,
      ratio,
    );
    this.stageScale = fit.scale;
    this.stage.style.width = fit.width + "px";
    this.stage.style.height = fit.height + "px";
    this.stage.style.transform = `translate(-50%, -50%) scale(${fit.scale})`;
    this.fitOpeningLayer();
  }
  showSettingsButton() {
    if (this.editing) return;
    this.root.classList.add("settings-visible");
    clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      if (!this.menuOpen && document.activeElement !== this.settingsButton)
        this.root.classList.remove("settings-visible");
    }, 3000);
  }
  resetConfirmation() {
    this.confirmAction = null;
    this.menu.querySelector(".settings-options").hidden = false;
    this.menu.querySelector(".settings-confirm").hidden = true;
  }
  openSettings() {
    if (this.editing || this.menuOpen || !this.runtime) return;
    this.wasPlaying = this.runtime.playing;
    this.menuOpen = true;
    this.runtime.pause();
    this.cancel();
    this.menu.hidden = false;
    this.resetConfirmation();
    this.settingsButton.setAttribute("aria-expanded", "true");
    this.stage.inert = true;
    this.showSettingsButton();
    this.menu.querySelector('[data-player="pause"] span').textContent =
      "继续游玩";
    this.menu.querySelector('[data-player="pause"]').focus();
  }
  closeSettings(forceResume = false, restore = true) {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menu.hidden = true;
    this.stage.inert = false;
    this.settingsButton.setAttribute("aria-expanded", "false");
    if (restore && (this.wasPlaying || forceResume)) this.runtime?.resume();
    this.settingsButton.focus();
    this.settingsButton.blur();
    this.showSettingsButton();
  }
  async start(project, sceneId = project.entryId, time = 0) {
    this.stop();
    this.project = project;
    this.applyTheme(project);
    this.runtime = new Runtime(project, (event, runtime) =>
      this.update(event, runtime),
    );
    // Browsers may keep audio activation pending until a real user gesture.
    // Video and opening UI must render without waiting for that permission.
    qteAudio.unlock();
    this.runtime.start(sceneId, time);
    this.showSettingsButton();
  }
  stop() {
    this.token++;
    this.runtime?.stop();
    this.runtime = null;
    this.cleanupMedia();
    this.hud.innerHTML = "";
    delete this.hud.dataset.key;
    this.message.hidden = true;
    this.eventId = null;
  }
  cleanupMedia() {
    for (const v of this.root.querySelectorAll(".picture-overlays video"))
      v.pause();
    this.video?.pause();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    this.video = null;
    for (const el of this.audio.values()) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    this.audio.clear();
    for (const v of this.prefetch || []) {
      v.removeAttribute("src");
      v.load();
    }
    this.prefetch = [];
    this.pointer = null;
    this.loading = false;
    qteAudio.stop();
  }
  dispose() {
    this.openingObserver?.disconnect();
    this.stageObserver?.disconnect();
    this.stop();
    this.disposed = true;
    clearTimeout(this.settingsTimer);
    this.root.removeEventListener("pointermove", this.reveal);
    this.root.removeEventListener("click", this.reveal);
    document.removeEventListener("keydown", this.menuKey);
    cancelAnimationFrame(this.frame);
    this.root.removeEventListener("click", this.clickHandler);
    this.stage.removeEventListener("pointerdown", this.down);
    this.stage.removeEventListener("pointermove", this.move);
    this.stage.removeEventListener("pointerup", this.up);
    this.stage.removeEventListener("pointercancel", this.cancel);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
  }
  applyTheme(project) {
    const theme = project.theme || {
      preset: "classic",
      accent: "#e5d6b1",
      text: "#f8f0e4",
    };

    this.root.style.setProperty("--work-accent", theme.accent);
    this.root.style.setProperty("--work-text", theme.text);
  }
  async renderStill(project, scene, time = 0, focusEvent = null) {
    const request = (this.stillRequest = (this.stillRequest || 0) + 1);
    this.project = project;
    this.applyTheme(project);
    this.still = { scene, time, focusEvent };
    const current = mediaAt(scene, time);
    const source = JSON.stringify([
      scene.id,
      current?.kind,
      current?.assetId,
      project.assets[current?.assetId],
    ]);
    if (this.stillId !== scene.id || this.stillSource !== source) {
      this.stillId = scene.id;
      this.stillSource = source;
      this.stillMountPromise = this.mount(scene, time);
    }
    await this.stillMountPromise;
    if (request !== this.stillRequest) return;
    this.currentClip = current;
    this.mountedClipId = current?.id || "gap";
    if (this.video && Number.isFinite(this.video.duration)) {
      const wanted =
        (this.currentClip.inMs + time - this.currentClip.startMs) / 1000;
      if (
        Math.abs(this.video.currentTime - wanted) >
        (this.timelinePlaying ? 0.2 : 0.03)
      )
        this.video.currentTime = Math.min(wanted, this.video.duration);
      if (this.timelinePlaying) {
        this.video.playbackRate = this.timelineRate || 1;
        if (this.video.paused) this.video.play().catch(() => {});
      } else this.video.pause();
    }
    this.paintScene(scene, time);
    const event =
      !openingRole(scene) &&
      (scene.events.find((e) => e.id === focusEvent) ||
        scene.events.find(
          (e) =>
            time >= e.startMs &&
            (time <= e.endMs || e.startMs === duration(scene)),
        ));
    this.paintEvent(event);
    for (const clip of scene.audio) {
      const audio = this.audio.get(clip.id);
      if (!audio) continue;
      const active =
        this.timelinePlaying &&
        !this.previewHiddenTracks?.has(itemTrackId(scene, clip, "audio")) &&
        time >= clip.startMs &&
        time < clip.endMs;
      if (!active) {
        audio.pause();
        continue;
      }
      const wanted = (time - clip.startMs + clip.inMs) / 1000;
      if (audio.readyState && Math.abs(audio.currentTime - wanted) > 0.2)
        audio.currentTime = wanted;
      audio.playbackRate = this.timelineRate || 1;
      audio.volume = audioVolume(clip, time);
      if (audio.paused) audio.play().catch(() => {});
    }
  }
  async mount(scene, time = 0) {
    const token = ++this.token;
    const current = mediaAt(scene, time);
    this.currentClip = current;
    this.mountedClipId = current?.id || "gap";
    this.cleanupMedia();
    this.visual.innerHTML = "";
    this.message.hidden = true;
    this.eventId = null;
    this.hud.innerHTML = "";
    this.loading = true;
    this.message.hidden = false;
    this.message.textContent = "正在读取素材…";
    this.stillImage = null;
    this.stage.classList.toggle("grayscale", scene.grayscale);
    this.stage.classList.toggle("death", scene.role === "death");
    try {
      if (current?.kind === "video") {
        const v = document.createElement("video");
        v.playsInline = true;
        v.preload = "auto";
        v.muted = this.muted || scene.role === "loading";
        if (
          scene.role === "loading" &&
          scene.opening?.image &&
          this.project.assets[scene.opening.image]
        )
          v.poster = await this.assets.url(
            this.project.assets[scene.opening.image],
          );
        this.video = v;
        this.visual.append(v);
        const url = await this.assets.url(this.project.assets[current.assetId]);
        if (token !== this.token) return;
        await new Promise((resolve, reject) => {
          let timer;
          const clean = () => {
            clearTimeout(timer);
            v.onloadedmetadata = null;
            v.onerror = null;
          };
          v.onloadedmetadata = () => {
            clean();
            this.fitStage();
            resolve();
          };
          v.onerror = () => {
            clean();
            reject(Error("视频无法播放，请检查格式或重新加载"));
          };
          timer = setTimeout(() => {
            clean();
            reject(Error("视频读取超时，请重试"));
          }, 30000);
          v.src = url;
          v.load();
        });
        if (token !== this.token) return;
        if (current.outMs > v.duration * 1000 + 100)
          throw Error("视频时长短于节点设置，请检查素材与出点");
        v.currentTime =
          (this.currentClip.inMs + time - this.currentClip.startMs) / 1000;
        v.onerror = () => {
          if (token === this.token)
            this.showError("视频播放中断，请重新加载当前节点");
        };
        v.onwaiting = () => {
          if (token === this.token) {
            this.buffering = true;
            this.status("正在缓冲…");
          }
        };
        v.onplaying = () => {
          this.buffering = false;
          this.status("");
        };
        v.oncanplay = () => {
          this.buffering = false;
        };
        v.onended = () => {
          this.buffering = false;
        };
      } else if (current?.kind === "image") {
        const img = new Image();
        img.alt = scene.name;
        this.visual.append(img);
        this.image = img;
        img.onload = () => this.fitStage();
        if (scene.source === "sequence")
          img.src = await this.assets.url(this.project.assets[current.assetId]);
        else await this.paintImage(scene, time, token);
      } else {
        this.visual.innerHTML =
          scene.source === "sequence"
            ? ""
            : '<div class="scenery"><div></div></div>';
      }
      if (token !== this.token) return;
      for (const clip of scene.audio) {
        const audio = new Audio();
        audio.preload = "metadata";
        audio.volume = clip.volume;
        audio.muted = this.muted;
        this.audio.set(clip.id, audio);
        audio.src = await this.assets.url(this.project.assets[clip.assetId]);
        audio.onerror = () => {
          if (token === this.token)
            this.showError("配音或音乐无法播放，请检查素材后重试");
        };
        if (token !== this.token) {
          audio.pause();
          return;
        }
      }
      this.loading = false;
      this.buffering = false;
      this.message.hidden = true;
      this.paintScene(scene, time);
      if (!this.editing) this.paintEvent(this.runtime?.active?.event);
      if (!this.editing && this.runtime?.playing) await this.syncMedia();
    } catch (error) {
      if (token === this.token) {
        this.loading = false;
        this.showError(
          `${this.project.assets[current?.assetId]?.name || scene.name}：${error.message}`,
        );
      }
    }
  }
  async paintImage(scene, time, token = this.token) {
    let offset = 0;
    const f = scene.images.find((f, i) => {
      offset += f.durationMs;
      return time < offset || i === scene.images.length - 1;
    });
    if (!f || this.stillImage === f.id) return;
    this.stillImage = f.id;
    const url = await this.assets.url(this.project.assets[f.assetId]);
    if (token !== this.token) return;
    const img = this.visual.querySelector("img");
    if (img) {
      img.onerror = () => this.showError("图片无法读取，请重试或检查素材");
      img.src = url;
      img.alt = this.project.assets[f.assetId]?.name || scene.name;
    }
  }
  status(text) {
    this.root.querySelector(".play-status").textContent = text;
  }
  update(event, runtime) {
    if (event.type === "home") {
      this.onExit();
      return;
    }
    if (event.type === "scene") {
      this.mount(runtime.scene, runtime.timeMs);
      this.preloadNext(runtime.scene);
    }
    if (event.type === "seek") {
      if (
        this.video &&
        mediaAt(runtime.scene, runtime.timeMs)?.id === this.currentClip?.id
      )
        this.video.currentTime =
          (this.currentClip.inMs + runtime.timeMs - this.currentClip.startMs) /
          1000;
      this.cancel();
      this.eventId = null;
    }
    if (event.type === "pause") {
      this.cancel();
      qteAudio.stop();
      this.pauseMedia();
    }
    if (event.type === "resume") {
      this.last = performance.now();
      if (runtime.active) this.startSound(runtime.active.event);
      this.syncMedia();
    }
    if (event.type === "event") {
      this.pointer = null;
      this.root.classList.remove("settings-visible");
      this.startSound(runtime.active.event);
    }
    if (event.type === "result") {
      this.interactionUntil = performance.now() + 500;
      this.pointer = null;
      qteAudio.result(event.ok);
      if (["qte", "choice"].includes(event.event.kind)) {
        const ghost = this.hud.cloneNode(true);
        ghost.classList.add("legacy-result");
        ghost.inert = true;
        const qte = ghost.querySelector(".qte");
        if (qte) {
          qte.classList.add(event.ok ? "qte-success" : "qte-failed");
          qte.style.setProperty("--qte-progress", event.ok ? "100" : "0");
        }
        this.stage.append(ghost);
        setTimeout(() => ghost.remove(), 260);
      }
      const el = this.root.querySelector(".feedback");
      el.textContent = event.ok ? "✓ 操作成功" : "操作超时";
      el.classList.remove("show");
      void el.offsetWidth;
      if (event.event.kind === "hotspot") el.classList.add("show");
      setTimeout(() => {
        if (!this.runtime?.active) qteAudio.stop();
      }, 300);
    }
    if (event.type === "complete") {
      this.cleanupMedia();
      this.visual.innerHTML = "";
      this.hud.innerHTML = "";
      this.message.hidden = false;
      this.message.innerHTML =
        '<h2>故事告一节点</h2><p>你可以重新开始，探索另一条路线。</p><button data-player="restart">重新开始</button><button data-player="exit">返回开屏</button>';
    }
    if (event.type === "stop") this.cleanupMedia();
    if (runtime.scene && runtime.state === "playing") {
      this.paintScene(runtime.scene, runtime.timeMs);
      this.paintEvent(runtime.active?.event);
      this.paintHud();
      this.syncMedia();
    }
    this.root.querySelector('[data-player="pause"] span').textContent =
      "继续游玩";
    this.onChange(event, runtime);
  }
  startSound(e) {
    if (e.kind === "qte" && !this.muted)
      qteAudio.start({
        qteSound: e.sound,
        qteVolume: e.volume,
        limit: e.timeoutMs / 1000,
      });
  }
  pauseMedia() {
    this.video?.pause();
    for (const video of this.root.querySelectorAll(".picture-overlays video"))
      video.pause();
    for (const a of this.audio.values()) a.pause();
  }
  async syncMedia() {
    const r = this.runtime;
    if (!r || this.loading || r.state !== "playing") return;
    if (this.video) {
      this.video.playbackRate = r.rate;
      if (r.mediaPaused || r.timeMs >= duration(r.scene)) {
        this.video.pause();
        if (
          r.active?.event.pause &&
          Math.abs(
            this.video.currentTime * 1000 -
              this.currentClip.inMs +
              this.currentClip.startMs -
              r.timeMs,
          ) > 100
        )
          this.video.currentTime =
            (this.currentClip.inMs + r.timeMs - this.currentClip.startMs) /
            1000;
      } else if (this.video.paused && !this.playAttempt) {
        this.playAttempt = true;
        try {
          try {
            await this.video.play();
          } catch (error) {
            if (!openingRole(r.scene)) throw error;
            this.video.muted = true;
            await this.video.play();
          }
        } catch {
          if (this.runtime === r) {
            r.pause();
            this.message.hidden = false;
            this.message.innerHTML =
              "<p>浏览器需要你点击后开始播放</p><button data-resume-media>点击播放</button>";
            this.message.querySelector("button").onclick = () => {
              this.message.hidden = true;
              r.resume();
            };
          }
        } finally {
          this.playAttempt = false;
        }
      }
    }
    for (const clip of r.scene.audio) {
      const a = this.audio.get(clip.id);
      if (!a) continue;
      const active =
        !r.scene.previewHiddenTracks?.includes(
          itemTrackId(r.scene, clip, "audio"),
        ) &&
        !r.mediaPaused &&
        r.timeMs >= clip.startMs &&
        r.timeMs < clip.endMs;
      if (!active) {
        a.pause();
        continue;
      }
      const wanted = (r.timeMs - clip.startMs + clip.inMs) / 1000;
      if (
        Number.isFinite(a.duration) &&
        Math.abs(a.currentTime - wanted) > 0.15
      )
        a.currentTime = wanted;
      a.playbackRate = r.rate;
      a.volume = audioVolume(clip, r.timeMs);
      if (a.paused) a.play().catch(() => {});
    }
  }
  paintOpening(scene, time) {
    if (!openingRole(scene)) {
      this.openingLayer?.remove();
      this.openingLayer = null;
      this.openingObserver?.disconnect();
      return;
    }
    const c = scene.opening || {},
      signature = JSON.stringify([scene.id, c, scene.role]);
    if (!this.openingLayer || this.openingSignature !== signature) {
      this.openingLayer?.remove();
      const layer = document.createElement("div");
      layer.className = `opening unified-opening ${scene.role === "loading" ? "loading-opening" : c.effect || "none"} ${c.titleLayout === "square" ? "square" : ""}`;
      layer.style.setProperty("--loading-color", c.color || "#e5d6b1");
      const title =
        scene.role === "loading" && c.titleLayout === "square"
          ? Array.from(c.title || "")
              .map((char) => `<span>${esc(char)}</span>`)
              .join("")
          : esc(c.title || "");
      layer.innerHTML = `<div class="opening-frame"><div class="opening-content"><h1 data-opening-element="title">${title}</h1><p data-opening-element="subtitle">${esc(c.subtitle || "")}</p></div>${scene.role === "loading" ? `<div class="load-progress" data-opening-element="progress"><span>${esc(c.text || "正在准备资源")}</span><progress max="100" value="${this.editing ? 45 : 0}"></progress><small hidden></small></div>` : `<button class="opening-start" data-opening-element="start">${esc(c.startText ?? "点击或按任意键开始")}</button>`}</div>`;
      this.stage.append(layer);
      this.openingLayer = layer;
      this.openingSignature = signature;
      layer.querySelector("button")?.addEventListener("click", () => {
        if (this.editing) this.onSelect("start", "opening");
        else if (this.runtime?.scene.id === scene.id) {
          qteAudio.unlock();
          this.runtime.follow(scene.next);
        }
      });
      if (this.editing)
        layer.addEventListener("click", (e) => {
          const el = e.target.closest("[data-opening-element]");
          if (el) this.onSelect(el.dataset.openingElement, "opening");
        });
      for (const [key, style] of Object.entries(c.layout || {})) {
        const el = layer.querySelector(`[data-opening-element="${key}"]`);
        if (!el) continue;
        layer.firstElementChild.append(el);
        Object.assign(el.style, {
          position: "absolute",
          left: (style.x ?? 50) + "%",
          top: (style.y ?? 50) + "%",
          right: "auto",
          bottom: "auto",
          transform: "translate(-50%,-50%)",
          translate: "none",
          margin: "0",
          animation: "none",
        });
        if (style.width) el.style.width = style.width + "%";
        if (style.size) el.style.fontSize = style.size / 19.2 + "cqw";
        if (style.color) el.style.color = style.color;
      }
      this.openingObserver?.disconnect();
      this.openingObserver = new ResizeObserver(() => this.fitOpeningLayer());
      this.openingObserver.observe(this.stage);
    }
    for (const el of this.openingLayer.querySelectorAll(
      "[data-opening-element]",
    )) {
      const range = c.elements?.[el.dataset.openingElement];
      el.hidden =
        range?.hidden ||
        (range && (time < range.startMs || time > range.endMs));
    }
    const progress = this.openingLayer.querySelector("progress");
    if (progress && !this.editing) progress.value = this.loadingProgress || 0;
    this.fitOpeningLayer();
  }
  fitOpeningLayer() {
    if (!this.openingLayer) return;
    const media = this.visual.querySelector("video,img"),
      ratio =
        (media?.videoWidth || media?.naturalWidth || 16) /
        (media?.videoHeight || media?.naturalHeight || 9);
    const width = Math.min(
        this.stage.clientWidth,
        this.stage.clientHeight * ratio,
      ),
      frame = this.openingLayer.firstElementChild;
    frame.style.width = width + "px";
    frame.style.height = width / ratio + "px";
  }
  paintScene(scene, time) {
    this.paintOpening(scene, time);
    if (
      scene.source === "sequence" &&
      !this.loading &&
      this.mountedClipId !== (mediaAt(scene, time)?.id || "gap")
    )
      this.mount(scene, time);
    this.paintOverlays(scene, time);
    if (scene.source === "images")
      this.paintImage(scene, time).catch((e) => this.showError(e.message));
    const title = this.root.querySelector(".scene-title");
    title.hidden =
      openingRole(scene) || (scene.clean && scene.role === "story");
    const text = `${scene.name}|${scene.subtitle}|${scene.role}`;
    if (title.dataset.text !== text) {
      title.dataset.text = text;
      title.innerHTML = `<small>${scene.role === "death" ? "◇" : scene.role === "ending" ? "THE END" : ""}</small><h2>${esc(scene.name)}</h2><p>${esc(scene.subtitle)}</p>`;
    }
    const captions = scene.subtitles
      .filter(
        (c) =>
          !scene.previewHiddenTracks?.includes(
            itemTrackId(scene, c, "subtitle"),
          ) &&
          (!this.editing ||
            !this.previewHiddenTracks?.has(itemTrackId(scene, c, "subtitle"))),
      )
      .filter((c) => time >= c.startMs && time < c.endMs);
    const html = captions
      .map(
        (c) =>
          `<span ${this.editing ? `data-edit-item="${esc(c.id)}" data-edit-kind="subtitle"` : ""} style="opacity:${c.entryMotion === "fade" ? clamp((time - c.startMs) / 250, 0, 1) : 1};z-index:${visualLayer(scene, c)};left:${c.x}%;top:${c.y}%;font-size:${c.size / 19.2}cqw;color:${c.color}" class="${c.background ? "caption-bg" : ""}">${esc(c.text)}</span>`,
      )
      .join("");
    const host = this.root.querySelector(".captions");
    if (host.innerHTML !== html) host.innerHTML = html;
    const bars = scene.effects.find(
      (e) => e.kind === "bars" && time >= e.startMs && time < e.endMs,
    );
    let height = 0;
    if (bars) {
      const ease = (x) => {
        x = clamp(x, 0, 1);
        return x * x * (3 - 2 * x);
      };
      height =
        bars.value *
        Math.min(
          ease((time - bars.startMs) / 800),
          ease((bars.endMs - time) / 800),
        );
    }
    this.root
      .querySelector(".bars")
      .style.setProperty("--bar-height", height + "%");
  }
  paintOverlays(scene, time) {
    let host = this.root.querySelector(".picture-overlays");
    if (!host) {
      host = document.createElement("div");
      host.className = "picture-overlays";
      this.stage.append(host);
    }
    const list = (scene.overlays || []).filter(
      (x) =>
        time >= x.startMs &&
        time < x.endMs &&
        !scene.previewHiddenTracks?.includes(
          itemTrackId(scene, x, "overlay"),
        ) &&
        (!this.editing ||
          !this.previewHiddenTracks?.has(itemTrackId(scene, x, "overlay"))),
    );
    const key =
      this.token +
      JSON.stringify([
        list,
        scene.timelineTracks,
        list.map((x) => this.project.assets[x.assetId]),
      ]);
    if (host.dataset.key !== key) {
      host.dataset.key = key;
      for (const el of host.querySelectorAll("video")) el.pause();
      host.replaceChildren();
      const token = this.token;
      for (const x of list) {
        const asset = this.project.assets[x.assetId],
          video = asset?.kind === "video";
        const el = document.createElement(video ? "video" : "img");
        el.dataset.overlayId = x.id;
        if (this.editing) {
          el.dataset.editItem = x.id;
          el.dataset.editKind = "overlay";
        }
        if (video) {
          el.playsInline = true;
          el.preload = "auto";
          el.muted = this.editing || this.muted;
          el.volume = clamp(x.volume ?? 1, 0, 1);
        } else el.alt = asset?.name || "";
        el.style.cssText = `left:${x.x}%;top:${x.y}%;width:${x.width}%;z-index:${visualLayer(scene, x)}`;
        host.append(el);
        el.onerror = () => this.showError("叠加素材无法读取");
        this.assets
          .url(asset)
          .then((url) => {
            if (token === this.token && el.isConnected) {
              el.src = url;
              if (video)
                el.onloadedmetadata = () => {
                  if (el.isConnected)
                    el.currentTime = Number(el.dataset.wanted || 0);
                };
            }
          })
          .catch(() => this.showError("叠加素材无法读取"));
      }
    }
    for (const el of host.querySelectorAll("video")) {
      const x = list.find((x) => x.id === el.dataset.overlayId);
      const wanted = (time - x.startMs + (x.inMs || 0)) / 1000;
      el.dataset.wanted = wanted;
      el.muted = (this.editing && !this.timelinePlaying) || this.muted;
      el.volume = clamp(x.volume ?? 1, 0, 1);
      if (el.readyState && Math.abs(el.currentTime - wanted) > 0.12)
        el.currentTime = wanted;
      if (
        this.timelinePlaying ||
        (!this.editing && this.runtime?.playing && !this.runtime.mediaPaused)
      ) {
        el.playbackRate = this.timelinePlaying
          ? this.timelineRate || 1
          : this.runtime.rate;
        if (el.paused) el.play().catch(() => {});
      } else el.pause();
    }
  }
  paintEvent(event) {
    const key = event
      ? JSON.stringify([event, this.editing ? null : this.runtime?.variables])
      : "";
    if (this.hud.dataset.key === key) return;
    this.hud.dataset.key = key;
    this.hud.innerHTML = "";
    this.eventId = event?.id;
    if (!event) return;
    this.hud.dataset.entryMotion = ["fade", "none"].includes(event.entryMotion)
      ? event.entryMotion
      : "classic";
    const edit = this.editing ? `data-edit-event="${esc(event.id)}"` : "";
    if (event.kind === "choice") {
      const opts = this.editing ? event.options : this.runtime.visibleOptions();
      this.hud.innerHTML = `<div class="choices">${opts.map((o, i) => `<button ${edit} data-option-id="${esc(o.id)}" style="translate:${o.x}cqw ${o.y}cqw"><span>${esc(o.text)}</span></button>`).join("")}</div>`;
      if (!opts.length && !this.editing)
        this.showError("当前条件下没有可用选项，请联系作品作者");
    } else if (event.kind === "hotspot")
      this.hud.innerHTML = `<button ${edit} class="hotspot" data-hotspot style="left:${event.x}%;top:${event.y}%" aria-label="${esc(event.hint || "点击热点")}">＋</button>`;
    else {
      const glyph = GESTURE_PATHS[event.gesture] || GESTURE_PATHS.click;
      this.hud.innerHTML = `<div ${edit} class="qte mechanical-qte psd-qte" style="left:${event.x}%;top:${event.y}%;--scale:${event.scale / 100}" aria-label="${esc(gestures[event.gesture])}"><div class="psd-qte-surface">${event.hint ? `<span class="qte-hint">${esc(event.hint)}</span>` : ""}<div class="psd-qte-tile"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="34"/><circle class="meter" cx="50" cy="50" r="34" pathLength="100"/><path class="psd-glyph" d="${glyph}"/></svg>${event.gesture === "multi" ? `<div class="qte-segments">${Array.from({ length: event.clicks }, () => "<i></i>").join("")}</div>` : ""}</div></div><small class="qte-count sr-only"></small></div>`;
    }
  }
  paintHud() {
    const active = this.runtime?.active;
    if (!active) return;
    const e = active.event;
    const remaining =
      e.endMode === "clock"
        ? Math.max(0, e.timeoutMs - active.elapsedMs)
        : e.endMode === "range"
          ? Math.max(0, e.endMs - this.runtime.timeMs)
          : null;
    const el = this.hud.querySelector(".qte");
    if (el) {
      el.style.setProperty("--progress", String((active.progress || 0) * 100));
      el.style.setProperty(
        "--qte-progress",
        String((active.progress || 0) * 100),
      );
      el.querySelectorAll(".qte-segments i").forEach((segment, i) =>
        segment.classList.toggle("filled", i < (active.clicks || 0)),
      );
      el.querySelector(".qte-count").classList.toggle(
        "sr-only",
        remaining === null,
      );
      el.querySelector(".qte-count").textContent =
        e.gesture === "multi"
          ? `${active.clicks || 0} / ${e.clicks}${remaining === null ? "" : " · " + (remaining / 1000).toFixed(1) + " 秒"}`
          : remaining === null
            ? ""
            : `${(remaining / 1000).toFixed(1)} 秒`;
      el.classList.toggle("urgent", remaining !== null && remaining < 1000);
    }
  }
  loop(now) {
    if (this.disposed) return;
    const dt = now - this.last;
    this.last = now;
    const r = this.runtime;
    if (r && !this.loading) {
      r.tick(
        dt,
        this.video && this.currentClip
          ? Math.min(
              this.video.currentTime * 1000 -
                this.currentClip.inMs +
                this.currentClip.startMs,
              this.currentClip.startMs + clipLength(this.currentClip),
            )
          : null,
        this.buffering,
      );
      if (
        this.pointer &&
        r.active &&
        r.playing &&
        !this.buffering &&
        r.active.event.gesture === "hold"
      ) {
        r.active.progress = clamp(
          (r.active.elapsedMs - this.pointer.began) / r.active.event.holdMs,
          0,
          1,
        );
        if (!this.muted) qteAudio.progress(r.active.progress);
        if (r.active.progress >= 1) {
          this.pointer = null;
          r.resolve(true);
        }
        this.paintHud();
      }
    }
    this.frame = requestAnimationFrame((t) => this.loop(t));
  }
  showError(text) {
    this.timelinePlaying = false;
    this.pauseMedia();
    this.runtime?.pause();
    this.message.hidden = false;
    this.message.innerHTML = `<h3>播放暂时中断</h3><p>${esc(text)}</p>${this.editing ? "" : '<button data-retry>重试当前节点</button><button data-player="exit">返回开屏</button>'}`;
    this.message
      .querySelector("[data-retry]")
      ?.addEventListener("click", () => {
        const r = this.runtime;
        const time = r.timeMs;
        this.mount(r.scene, time).then(() => r.resume());
      });
    this.onChange({ type: "media-error", message: text }, this.runtime);
  }
  preloadNext(scene) {
    for (const v of this.prefetch || []) {
      v.removeAttribute("src");
      v.load();
    }
    this.prefetch = [];
    const targets = [
      scene.next,
      ...scene.events.flatMap((e) => [
        e.success.target,
        e.failure.target,
        ...e.options.map((o) => o.target),
      ]),
    ];
    const ids = [
      ...new Set(
        targets.filter((t) => t.kind === "scene").map((t) => t.sceneId),
      ),
    ].slice(0, 2);
    const token = this.token;
    for (const id of ids) {
      const s = this.project.scenes.find((s) => s.id === id);
      if (!s?.video || s.source !== "video") continue;
      const v = document.createElement("video");
      v.preload = "metadata";
      this.prefetch.push(v);
      this.assets
        .url(this.project.assets[s.video.assetId])
        .then((url) => {
          if (token === this.token) v.src = url;
        })
        .catch(() => {});
    }
  }
}
