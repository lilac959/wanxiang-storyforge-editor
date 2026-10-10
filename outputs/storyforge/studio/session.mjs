import { visualClips } from "./timeline.mjs";
import { PlayerView } from "./player-view.mjs";
import { inspect, resolveOpeningMedia } from "./assets.mjs";
import { esc } from "./storage.mjs";
import { qteAudio } from "./audio.mjs";
import { openingCard } from "./model.mjs";
export class Session {
  constructor(
    root,
    assets,
    { onExit = () => {}, onBlocked = () => {}, editor = false } = {},
  ) {
    this.root = root;
    this.assets = assets;
    this.onExit = onExit;
    this.editor = editor;
    this.onBlocked = onBlocked;
    this.token = 0;
  }
  clear() {
    this.token++;
    this.openingObserver?.disconnect();
    this.player?.dispose();
    this.player = null;
    this.root.querySelectorAll("video,audio").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
    if (this.key) {
      document.removeEventListener("keydown", this.key, true);
      this.key = null;
    }
    this.root.innerHTML = "";
  }
  fitOpening(media) {
    const opening = this.root.querySelector(".opening");
    const frame = opening.querySelector(".opening-frame");
    const fit = () => {
      const ratio = Number(this.project?.canvasRatio) || 16 / 9;
      const style = getComputedStyle(opening);
      const width =
        opening.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const height =
        opening.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const fittedWidth = Math.min(width, height * ratio);
      frame.style.width = `${fittedWidth}px`;
      frame.style.height = `${fittedWidth / ratio}px`;
    };
    this.openingObserver?.disconnect();
    this.openingObserver = new ResizeObserver(fit);
    this.openingObserver.observe(opening);
    media?.addEventListener("loadedmetadata", fit, { once: true });
    media?.addEventListener("load", fit, { once: true });
    fit();
  }
  async open(
    project,
    { sceneId = null, time = 0, only = null, design = false } = {},
  ) {
    this.clear();
    this.project = structuredClone(project);
    const p = this.project,
      token = this.token;
    if (p.unifiedCards) {
      await resolveOpeningMedia(p, this.assets);
      if (token !== this.token) return;
      const scene = p.scenes.find((s) => s.id === sceneId);
      if (sceneId && scene?.role !== "loading") {
        this.play(sceneId, time);
        return;
      }
      await this.openUnified({ only, design, sceneId });
      return;
    }
    if (sceneId) {
      this.play(sceneId, time);
      return;
    }
    try {
      this.root.innerHTML = `<div class="opening loading-opening ${p.loading.titleLayout === "square" ? "square" : ""}" style="--loading-color:${p.loading.color}"><div class="opening-frame"><div class="opening-content"><h1>${
        p.loading.titleLayout === "square"
          ? Array.from(p.loading.title)
              .map((char) => `<span>${esc(char)}</span>`)
              .join("")
          : esc(p.loading.title)
      }</h1><p>${esc(p.loading.subtitle)}</p></div><div class="load-progress"><span>${esc(p.loading.text)}</span><progress max="100" value="0"></progress><small ${this.editor ? "" : "hidden"}>准备开场资源</small></div></div></div>`;
      this.fitOpening();
      const bg = p.loading.video || p.loading.image;
      if (bg) {
        const a = p.assets[bg],
          el = document.createElement(a.kind === "video" ? "video" : "img");
        if (a.kind === "video") {
          el.autoplay = true;
          el.muted = true;
          el.loop = true;
          el.playsInline = true;
          if (p.loading.image)
            el.poster = await this.assets.url(p.assets[p.loading.image]);
        } else el.alt = "加载封面";
        el.src = await this.assets.url(a);
        if (token !== this.token) return;
        this.root.querySelector(".opening-frame").prepend(el);
        this.fitOpening(el);
      }
      this.applyOpeningLayout(p.loading);
      if (design) return;
      const entry = p.scenes.find((s) => s.id === p.entryId);
      const ids = [
        ...new Set(
          [
            bg,
            p.splash.video,
            entry ? visualClips(entry)[0]?.assetId : null,
            ...(entry?.audio || []).map((x) => x.assetId),
          ].filter(Boolean),
        ),
      ];
      const began = performance.now();
      let ready = 0;
      await Promise.all(
        ids.map(async (id) => {
          const a = p.assets[id];
          await inspect(await this.assets.url(a), a.kind);
          if (token !== this.token) return;
          ready++;
          if (this.player)
            this.player.loadingProgress = Math.round(
              (ready / ids.length) * 100,
            );
          this.root.querySelector("progress").value = Math.round(
            (ready / ids.length) * 100,
          );
          this.root.querySelector(".load-progress small").textContent =
            `${ready} / ${ids.length} 项开场资源就绪`;
        }),
      );
      if (token !== this.token) return;
      await new Promise((r) =>
        setTimeout(
          r,
          Math.max(0, p.loading.minimumMs - (performance.now() - began)),
        ),
      );
      if (token !== this.token) return;
      if (only === "loading") {
        this.root.querySelector(".load-progress small").textContent =
          "加载页预览完成";
        this.root.querySelector("video")?.pause();
        return;
      }
      await this.home();
    } catch (error) {
      if (token === this.token) {
        this.clear();
        this.root.innerHTML = `<div class="opening"><div class="opening-error"><h2>暂时无法开始</h2><p>${esc(error.message)}</p><button data-retry>重试加载</button></div></div>`;
        this.root.querySelector("button").onclick = () => this.open(p);
      }
    }
  }
  async home(design = false) {
    if (this.project.unifiedCards) {
      this.play(
        openingCard(this.project, "splash")?.id || this.project.entryId,
      );
      return;
    }
    this.clear();
    const token = this.token,
      p = this.project,
      c = p.splash;
    this.root.innerHTML = `<div class="opening ${esc(c.effect)}"><div class="opening-frame"><div class="opening-content"><h1>${esc(c.title)}</h1><p>${esc(c.subtitle)}</p></div><button class="opening-start">点击或按任意键开始</button></div></div>`;
    this.fitOpening();
    if (c.video) {
      try {
        const url = await this.assets.url(p.assets[c.video]);
        if (token !== this.token) return;
        const v = document.createElement("video");
        v.src = url;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        this.root.querySelector(".opening-frame").prepend(v);
        this.fitOpening(v);
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      } catch (error) {
        this.root.querySelector(".opening-content p").textContent =
          error.message;
      }
    }
    this.applyOpeningLayout(c);
    if (design) return;
    const start = () => {
      if (token !== this.token) return;
      qteAudio.unlock();
      this.play(p.entryId);
    };
    this.root.querySelector(".opening-start").onclick = start;
    this.root.querySelector(".opening").onclick = (e) => {
      if (!e.target.closest("[data-leave]")) start();
    };
    this.root.querySelector("[data-leave]")?.addEventListener("click", () => {
      this.clear();
      this.onExit();
    });
    this.key = (e) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.key === "Tab" ||
        e.key === "Escape"
      )
        return;
      e.preventDefault();
      start();
    };
    document.addEventListener("keydown", this.key, true);
  }
  applyOpeningLayout(c) {
    const selectors = {
      title: ".opening-content h1",
      subtitle: ".opening-content p",
      progress: ".load-progress",
      start: ".opening-start",
    };
    const frame = this.root.querySelector(".opening-frame");
    for (const [kind, selector] of Object.entries(selectors)) {
      const el = frame?.querySelector(selector),
        style = c.layout?.[kind];
      if (!el) continue;
      el.dataset.openingElement = kind;
      if (!style) continue;
      frame.append(el);
      Object.assign(el.style, {
        position: "absolute",
        left: (style.x ?? 50) + "%",
        top: (style.y ?? 50) + "%",
        right: "auto",
        bottom: "auto",
        transform: "translate(-50%,-50%)",
        margin: "0",
        animation: "none",
      });
      if (style.size) el.style.fontSize = style.size / 19.2 + "cqw";
      if (style.width) el.style.width = style.width + "%";
      if (style.color) el.style.color = style.color;
    }
    if (c.startText !== undefined) {
      const el = frame?.querySelector(".opening-start");
      if (el) el.textContent = c.startText;
    }
  }
  play(sceneId, time = 0) {
    if (
      this.project.unifiedCards &&
      this.project.scenes.find((s) => s.id === sceneId)?.role === "loading"
    ) {
      this.openUnified({ sceneId });
      return;
    }
    this.clear();
    this.root.innerHTML = '<div class="player-root"></div>';
    this.player = new PlayerView(this.root.firstElementChild, this.assets, {
      onHome: () => this.home(),
      onExit: () => (this.editor ? this.onExit() : this.home()),
      canExit: this.editor,
      onChange: (event, runtime) => {
        if (!this.editor || !["blocked", "media-error"].includes(event.type))
          return;
        const message = this.player.message;
        message.hidden = false;
        message.innerHTML = `<p>${esc(runtime?.scene?.name || "当前节点")}：${esc(event.message)}</p><button data-locate-blocked>返回编辑并定位</button><button data-exit-blocked>退出试玩</button>`;
        message.querySelector("[data-locate-blocked]").onclick = () =>
          this.onBlocked(event.sceneId || runtime?.scene?.id, event.eventId);
        message.querySelector("[data-exit-blocked]").onclick = () =>
          this.onExit();
      },
    });
    this.player.start(this.project, sceneId, time);
    if (this.project.unifiedCards) {
      this.key = (e) => {
        const r = this.player?.runtime;
        if (
          r?.scene.role !== "splash" ||
          this.player.menuOpen ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          ["Tab", "Escape"].includes(e.key) ||
          e.target.closest("input,textarea,select")
        )
          return;
        e.preventDefault();
        qteAudio.unlock();
        r.follow(r.scene.next);
      };
      document.addEventListener("keydown", this.key, true);
    }
  }
  async openUnified({ only = null, design = false, sceneId = null } = {}) {
    this.clear();
    const p = this.project,
      token = this.token,
      loading = sceneId
        ? p.scenes.find((s) => s.id === sceneId)
        : openingCard(p, "loading"),
      splash = openingCard(p, "splash");
    try {
      if (loading) {
        this.root.innerHTML = '<div class="player-root"></div>';
        this.player = new PlayerView(this.root.firstElementChild, this.assets, {
          onHome: () => this.home(),
          onExit: () => (this.editor ? this.onExit() : this.home()),
          canExit: this.editor,
        });
        await this.player.start(p, loading.id);
      } else {
        this.root.innerHTML =
          '<div class="opening"><div class="opening-frame" style="width:70%;height:100px"><div class="load-progress" style="width:100%;left:0;bottom:30%"><span>正在准备资源</span><progress max="100" value="0"></progress></div></div></div>';
      }
      if (design) return;
      const entry = p.scenes.find((s) => s.id === p.entryId),
        ids = [
          ...new Set(
            [loading, splash, entry]
              .filter(Boolean)
              .flatMap((s) => [
                ...visualClips(s).map((c) => c.assetId),
                ...(s.opening?.image ? [s.opening.image] : []),
                ...(s.audio || []).map((c) => c.assetId),
                ...(s.overlays || []).map((c) => c.assetId),
              ]),
          ),
        ];
      const began = performance.now();
      let ready = 0;
      await Promise.all(
        ids.map(async (id) => {
          const a = p.assets[id];
          if (!a) throw Error("开场素材缺失");
          await inspect(await this.assets.url(a), a.kind);
          if (token !== this.token) return;
          ready++;
          const progress = this.root.querySelector("progress");
          if (progress) progress.value = Math.round((ready / ids.length) * 100);
        }),
      );
      if (token !== this.token) return;
      if (this.player) this.player.loadingProgress = 100;
      const progress = this.root.querySelector("progress");
      if (progress) progress.value = 100;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(
            0,
            (loading?.opening?.minimumMs || 0) - (performance.now() - began),
          ),
        ),
      );
      if (token !== this.token) return;
      if (only === "loading") {
        this.player?.runtime?.pause();
        return;
      }
      const target = loading?.next;
      if (target?.kind === "scene") this.play(target.sceneId);
      else if (target?.kind === "unlinked")
        throw Error("加载节点尚未连接后续节点");
      else this.play(splash?.id || p.entryId);
    } catch (error) {
      if (token !== this.token) return;
      this.clear();
      this.root.innerHTML = `<div class="opening"><div class="opening-error"><h2>暂时无法开始</h2><p>${esc(error.message)}</p><button>重试加载</button></div></div>`;
      this.root.querySelector("button").onclick = () => this.open(p);
      if (this.editor) {
        const locate = document.createElement("button");
        locate.textContent = "返回编辑并定位";
        locate.onclick = () => this.onBlocked(loading?.id || p.entryId);
        this.root.querySelector(".opening-error").append(locate);
        const exit = document.createElement("button");
        exit.textContent = "退出试玩";
        exit.onclick = () => this.onExit();
        this.root.querySelector(".opening-error").append(exit);
      }
    }
  }
  dispose() {
    this.clear();
  }
}
