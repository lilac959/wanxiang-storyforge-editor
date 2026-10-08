import { PlayerView } from "./player-view.mjs";
import { inspect } from "./assets.mjs";
import { esc } from "./storage.mjs";
import { qteAudio } from "./audio.mjs";
export class Session {
  constructor(root, assets, { onExit = () => {}, editor = false } = {}) {
    this.root = root;
    this.assets = assets;
    this.onExit = onExit;
    this.editor = editor;
    this.token = 0;
  }
  clear() {
    this.token++;
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
  async open(project, { sceneId = null, time = 0, only = null } = {}) {
    this.clear();
    this.project = structuredClone(project);
    const p = this.project,
      token = this.token;
    if (sceneId) {
      this.play(sceneId, time);
      return;
    }
    try {
      this.root.innerHTML = `<div class="opening ${p.loading.titleLayout === "square" ? "square" : ""}" style="--loading-color:${p.loading.color}"><div class="opening-content"><h1>${esc(p.loading.title)}</h1><p>${esc(p.loading.subtitle)}</p></div><div class="load-progress"><span>${esc(p.loading.text)}</span><progress max="100" value="0"></progress><small>准备开场资源</small></div></div>`;
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
        this.root.firstElementChild.prepend(el);
      }
      const entry = p.scenes.find((s) => s.id === p.entryId);
      const ids = [
        ...new Set(
          [
            bg,
            p.splash.video,
            entry?.source === "images"
              ? entry.images[0]?.assetId
              : entry?.video?.assetId,
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
  async home() {
    this.clear();
    const token = this.token,
      p = this.project,
      c = p.splash;
    this.root.innerHTML = `<div class="opening ${esc(c.effect)}"><div class="opening-content"><h1>${esc(c.title)}</h1><p>${esc(c.subtitle)}</p></div><button class="opening-start">点击或按任意键开始</button>${this.editor ? '<div class="game-home"><button data-leave>关闭试玩</button></div>' : ""}</div>`;
    if (c.video) {
      try {
        const url = await this.assets.url(p.assets[c.video]);
        if (token !== this.token) return;
        const v = document.createElement("video");
        v.src = url;
        v.loop = true;
        v.playsInline = true;
        v.preload = "auto";
        this.root.firstElementChild.prepend(v);
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      } catch (error) {
        this.root.querySelector(".opening-content p").textContent =
          error.message;
      }
    }
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
  play(sceneId, time = 0) {
    this.clear();
    this.root.innerHTML = '<div class="player-root"></div>';
    this.player = new PlayerView(this.root.firstElementChild, this.assets, {
      onExit: () => this.home(),
    });
    this.player.start(this.project, sceneId, time);
  }
  dispose() {
    this.clear();
  }
}
