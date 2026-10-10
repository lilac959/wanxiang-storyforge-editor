import { esc } from "./storage.mjs";
import { UI_COMPONENTS, componentThumbnail } from "./ui-components.mjs";
import { references } from "./model.mjs";

export function deletionPlan(project, ids) {
  const used = new Set(references(project));
  const selected = [...new Set(ids)].filter((id) => project.assets[id]);
  return {
    unused: selected.filter((id) => !used.has(id)),
    used: selected.filter((id) => used.has(id)),
  };
}

const labels = {
  all: "全部",
  video: "视频",
  image: "图片",
  audio: "音频",
  ui: "互动 UI",
  text: "字幕",
  effect: "效果",
};
export function mediaUses(project, id) {
  const found = [];
  if (
    !project.unifiedCards &&
    [project.loading.image, project.loading.video].includes(id)
  )
    found.push({ id: "@loading", name: "加载" });
  if (!project.unifiedCards && project.splash.video === id)
    found.push({ id: "@splash", name: "开屏" });
  for (const s of project.scenes) {
    const ids = [
      s.video?.assetId,
      s.opening?.image,
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
    this.managing = false;
    this.selected = new Set();
    this.unusedOnly = false;
  }
  dispose() {
    this.signature = null;
    this.dragController?.abort();
    this.observer?.disconnect();
    this.host?.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
  }
  mount(host, project) {
    const signature = JSON.stringify([
      project.id,
      project.assets,
      references(project),
      document.body.dataset.view,
    ]);
    if (
      this.project?.id !== project.id ||
      !host.classList.contains("settings-page")
    ) {
      this.managing = false;
      this.selected.clear();
    }
    this.selected = new Set(
      [...this.selected].filter((id) => project.assets[id]),
    );
    this.project = project;
    if (
      this.host === host &&
      this.signature === signature &&
      host.querySelector(".media-grid")
    )
      return;
    this.dispose();
    this.host = host;
    this.project = project;
    this.signature = signature;
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
    if (host.classList.contains("settings-page")) {
      const controls = host.querySelector(".asset-controls");
      const filter = document.createElement("label");
      filter.className = "unused-filter";
      filter.innerHTML = `<input type="checkbox" ${this.unusedOnly ? "checked" : ""}>未使用`;
      filter.querySelector("input").onchange = (e) => {
        this.unusedOnly = e.target.checked;
        this.grid();
      };
      const manage = document.createElement("button");
      manage.textContent = "批量管理";
      manage.onclick = () => {
        this.managing = !this.managing;
        this.selected.clear();
        this.anchor = null;
        this.grid();
      };
      controls.append(filter, manage);
    }
  }
  grid() {
    this.observer?.disconnect();
    const grid = this.host.querySelector(".media-grid");
    grid.querySelectorAll("video").forEach((v) => {
      v.removeAttribute("src");
      v.load();
    });
    if (["text", "effect"].includes(this.category)) {
      const templates =
        this.category === "text"
          ? [["add-subtitle", "普通字幕", "Aa", "可修改文字、位置和样式"]]
          : [
              ["add-speed", "播放速度", "0.5×", "设置区间内的播放倍速"],
              ["add-bars", "电影黑边", "▰", "添加上下黑边"],
            ];
      grid.innerHTML = templates
        .map(
          ([action, name, symbol, description]) =>
            `<article class="media-card template-card"><div class="media-thumb template-symbol">${symbol}</div><strong>${name}</strong><small>${description}</small><button class="full" data-action="${action}">＋ 添加到时间轴</button></article>`,
        )
        .join("");
      return;
    }
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
    const used = new Set(references(this.project));
    if (this.unusedOnly)
      list = list.filter((a) => a.kind !== "ui" && !used.has(a.id));
    if (this.managing) list = list.filter((a) => a.kind !== "ui");
    this.visibleIds = list.map((a) => a.id);
    this.host.querySelector(".asset-batchbar")?.remove();
    if (this.managing) {
      const bar = document.createElement("div");
      bar.className = "asset-batchbar";
      bar.innerHTML = `<span>已选 ${this.selected.size} 项</span><button data-batch="all">全选当前结果</button><button data-action="batch-remove-assets" ${this.selected.size ? "" : "disabled"}>删除所选</button><button data-batch="done">完成</button>`;
      grid.before(bar);
      bar.querySelector('[data-batch="all"]').onclick = () => {
        this.selected = new Set(this.visibleIds);
        this.grid();
      };
      bar.querySelector('[data-batch="done"]').onclick = () => {
        this.managing = false;
        this.selected.clear();
        this.grid();
      };
    }
    grid.innerHTML =
      list
        .map(
          (a) =>
            `<article class="media-card"><button class="media-open" data-media-id="${esc(a.id)}" data-media-kind="${a.kind}" aria-label="预览 ${esc(a.name)}"><div class="media-thumb ${a.kind}">${a.kind === "ui" ? componentThumbnail(a) : a.kind === "audio" ? '<span class="audio-symbol">♫</span>' : "<span>加载缩略图…</span>"}</div><strong title="${esc(a.name)}">${esc(a.name)}</strong><small>${labels[a.kind]}${a.durationMs ? ` · ${(a.durationMs / 1000).toFixed(1)} 秒` : ""}${a.kind === "ui" ? " · 第 1 版" : ""}</small></button><button class="media-add" data-action="add-library-item" data-id="${esc(a.id)}" data-kind="${a.kind}" aria-label="添加 ${esc(a.name)}到时间轴" title="添加到播放指针位置">＋</button><details class="media-menu"><summary aria-label="${esc(a.name)}操作">···</summary><div>${a.kind === "ui" ? `<button data-action="preview-ui" data-id="${esc(a.id)}">预览并试用</button><button data-action="use-ui" data-id="${esc(a.id)}">添加到当前节点</button>` : `<button data-action="rename-asset" data-id="${esc(a.id)}">重命名</button><button data-action="asset-uses" data-id="${esc(a.id)}">查看使用位置</button><button data-action="replace-asset" data-id="${esc(a.id)}">替换素材</button><button data-action="remove-asset" data-id="${esc(a.id)}">删除</button>`}</div></details></article>`,
        )
        .join("") || '<p class="media-empty">没有找到素材</p>';
    if (this.managing) {
      grid.querySelectorAll(".media-card").forEach((card) => {
        const open = card.querySelector(".media-open"),
          id = open.dataset.mediaId;
        card.classList.toggle("batch-selected", this.selected.has(id));
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = this.selected.has(id);
        check.setAttribute(
          "aria-label",
          "选择 " + this.project.assets[id].name,
        );
        check.className = "asset-select";
        card.prepend(check);
        card.querySelector(".media-menu")?.remove();
        card.querySelector(".media-add")?.remove();
        card.onclick = (e) => {
          const index = this.visibleIds.indexOf(id),
            previous = this.visibleIds.indexOf(this.anchor);
          const select =
            e.target === check ? check.checked : !this.selected.has(id);
          const ids =
            e.shiftKey && previous >= 0
              ? this.visibleIds.slice(
                  Math.min(index, previous),
                  Math.max(index, previous) + 1,
                )
              : [id];
          for (const key of ids)
            select ? this.selected.add(key) : this.selected.delete(key);
          this.anchor = id;
          this.grid();
        };
      });
    }
    grid.querySelectorAll(".media-open").forEach((b) => {
      if (this.managing) {
        b.draggable = false;
        return;
      }
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
