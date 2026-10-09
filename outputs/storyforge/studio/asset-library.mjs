import { esc } from "./storage.mjs";
import { UI_COMPONENTS } from "./ui-components.mjs";

const labels = {
  all: "全部",
  video: "视频",
  image: "图片",
  audio: "音频",
  ui: "互动 UI",
};
export function mediaUses(project, id) {
  const found = [];
  if ([project.loading.image, project.loading.video].includes(id))
    found.push({ id: "@loading", name: "加载" });
  if (project.splash.video === id) found.push({ id: "@splash", name: "开屏" });
  for (const s of project.scenes) {
    const ids = [
      s.video?.assetId,
      ...(s.clips || []).map((c) => c.assetId),
      ...(s.images || []).map((c) => c.assetId),
      ...(s.audio || []).map((c) => c.assetId),
      ...(s.overlays || []).map((c) => c.assetId),
    ];
    if (ids.includes(id)) found.push({ id: s.id, name: s.name });
  }
  return found;
}
export class AssetLibrary {
  constructor(store, preview, drag) {
    this.store = store;
    this.preview = preview;
    this.drag = drag;
    this.category = "all";
    this.search = "";
    this.sort = "recent";
  }
  dispose() {
    this.dragController?.abort();
    this.observer?.disconnect();
    this.host?.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
  }
  mount(host, project) {
    this.dispose();
    this.host = host;
    this.project = project;
    host.innerHTML = `<div class="asset-toolbar"><div class="asset-tabs" role="group" aria-label="素材分类">${Object.entries(
      labels,
    )
      .map(
        ([k, v]) =>
          `<button data-category="${k}" aria-pressed="${this.category === k}">${v}</button>`,
      )
      .join(
        "",
      )}</div><div class="asset-controls"><input class="media-search" aria-label="搜索素材" placeholder="搜索素材名称" value="${esc(this.search)}"><select class="media-sort" aria-label="素材排序"><option value="recent">最近添加</option><option value="name" ${this.sort === "name" ? "selected" : ""}>名称</option></select><button data-action="upload-library">＋ 上传素材</button></div></div><div class="media-grid"></div>`;
    host.querySelectorAll("[data-category]").forEach(
      (b) =>
        (b.onclick = () => {
          this.category = b.dataset.category;
          host
            .querySelectorAll("[data-category]")
            .forEach((b) =>
              b.setAttribute(
                "aria-pressed",
                b.dataset.category === this.category,
              ),
            );
          this.grid();
        }),
    );
    host.querySelector(".media-search").oninput = (e) => {
      this.search = e.target.value;
      this.grid();
    };
    host.querySelector(".media-sort").onchange = (e) => {
      this.sort = e.target.value;
      this.grid();
    };
    this.grid();
  }
  grid() {
    this.observer?.disconnect();
    const grid = this.host.querySelector(".media-grid");
    grid.querySelectorAll("video").forEach((v) => {
      v.removeAttribute("src");
      v.load();
    });
    let list = [
      ...Object.values(this.project.assets).reverse(),
      ...UI_COMPONENTS.map((c) => ({
        ...c,
        kind: "ui",
        componentKind: c.kind,
      })),
    ];
    list = list.filter(
      (a) =>
        (this.category === "all" || a.kind === this.category) &&
        a.name.toLowerCase().includes(this.search.toLowerCase()),
    );
    if (this.sort === "name")
      list.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    grid.innerHTML =
      list
        .map(
          (a) =>
            `<article class="media-card"><button class="media-open" data-media-id="${esc(a.id)}" data-media-kind="${a.kind}" aria-label="预览 ${esc(a.name)}"><div class="media-thumb ${a.kind}">${a.kind === "ui" ? `<span class="ui-swatch ${a.preset || ""}">${esc(a.symbol)}</span>` : a.kind === "audio" ? '<span class="audio-symbol">♫</span>' : "<span>加载缩略图…</span>"}</div><strong title="${esc(a.name)}">${esc(a.name)}</strong><small>${labels[a.kind]}${a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} 秒` : ""}${a.kind === "ui" ? " · 第 1 版" : ""}</small></button><details class="media-menu"><summary aria-label="${esc(a.name)}操作">···</summary><div>${a.kind === "ui" ? `<button data-action="preview-ui" data-id="${esc(a.id)}">预览并试用</button><button data-action="use-ui" data-id="${esc(a.id)}">添加到当前场景</button>` : `<button data-action="rename-asset" data-id="${esc(a.id)}">重命名</button><button data-action="asset-uses" data-id="${esc(a.id)}">查看使用位置</button><button data-action="replace-asset" data-id="${esc(a.id)}">替换素材</button><button data-action="remove-asset" data-id="${esc(a.id)}">删除</button>`}</div></details></article>`,
        )
        .join("") || '<p class="media-empty">没有找到素材</p>';
    grid.querySelectorAll(".media-open").forEach((b) => {
      b.draggable = true;
      let dragged = false;
      b.onclick = () => {
        if (dragged) {
          dragged = false;
          return;
        }
        this.preview(b.dataset.mediaId, b.dataset.mediaKind);
      };
      if (this.drag)
        b.onpointerdown = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          dragged = false;
          this.dragController?.abort();
          const controller = (this.dragController = new AbortController());
          const send = (phase, ev) =>
            this.drag(b.dataset.mediaId, b.dataset.mediaKind, phase, ev);
          window.addEventListener(
            "pointermove",
            (ev) => {
              if (
                !dragged &&
                Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5
              )
                return;
              dragged = true;
              b.closest(".media-card").classList.add("dragging");
              send("move", ev);
            },
            { signal: controller.signal },
          );
          const finish = (ev) => {
            controller.abort();
            b.closest(".media-card")?.classList.remove("dragging");
            if (dragged)
              send(ev.type === "pointercancel" ? "cancel" : "drop", ev);
          };
          window.addEventListener("pointerup", finish, {
            signal: controller.signal,
          });
          window.addEventListener("pointercancel", finish, {
            signal: controller.signal,
          });
        };
      b.ondragstart = (e) => {
        const type =
          b.dataset.mediaKind === "ui"
            ? "application/storyforge-ui"
            : "application/storyforge-asset";
        e.dataTransfer.setData(type, b.dataset.mediaId);
        e.dataTransfer.effectAllowed = "copy";
        b.closest(".media-card").classList.add("dragging");
      };
      b.ondragend = () => b.closest(".media-card").classList.remove("dragging");
    });
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            this.observer.unobserve(entry.target);
            this.thumbnail(entry.target);
          }
      },
      { root: null, rootMargin: "100px" },
    );
    grid
      .querySelectorAll(
        '.media-open[data-media-kind="image"],.media-open[data-media-kind="video"]',
      )
      .forEach((b) => this.observer.observe(b));
  }
  async thumbnail(button) {
    const a = this.project.assets[button.dataset.mediaId],
      holder = button.querySelector(".media-thumb");
    try {
      const url = await this.store.url(a);
      if (!button.isConnected) return;
      const media = document.createElement(
        a.kind === "video" ? "video" : "img",
      );
      if (a.kind === "video") {
        media.muted = true;
        media.playsInline = true;
        media.preload = "metadata";
        media.onloadedmetadata = () => {
          if (Number.isFinite(media.duration))
            media.currentTime = Math.min(0.1, media.duration / 2);
        };
      } else {
        media.loading = "lazy";
        media.alt = a.name;
      }
      media.onerror = () => {
        if (holder.isConnected) holder.textContent = "缩略图不可用";
      };
      media.src = url;
      holder.replaceChildren(media);
    } catch {
      holder.textContent = "素材待重新上传";
    }
  }
}
