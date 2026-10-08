import { esc } from "./storage.mjs";
import { duration } from "./model.mjs";
import { visualClips } from "./timeline.mjs";
export class StoryBoard {
  constructor(host, api) {
    this.host = host;
    this.api = api;
    this.scale = 1;
    this.selected = new Set();
    this.mode = "pan";
    this.pending = null;
    host.addEventListener("pointerdown", (e) => this.pointer(e));
    host.addEventListener("dblclick", (e) => {
      const c = e.target.closest("[data-graph-scene]");
      if (c && !e.target.closest("button")) api.open(c.dataset.graphScene);
    });
    host.addEventListener("click", (e) => this.click(e));
    host.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const c = e.target.closest("[data-graph-scene]");
      if (c) {
        this.selected = new Set([c.dataset.graphScene]);
        api.select(c.dataset.graphScene);
        api.menu(c.dataset.graphScene);
      } else api.create();
    });
    host.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
        }
      },
      { passive: false },
    );
    host.addEventListener("dragover", (e) => e.preventDefault());
    host.addEventListener("drop", (e) => {
      e.preventDefault();
      api.drop(e.dataTransfer);
    });
  }
  render(project, selected) {
    this.project = project;
    this.selected = new Set(
      [...this.selected].filter((id) =>
        project.scenes.some((s) => s.id === id),
      ),
    );
    if (!this.selected.has(selected)) this.selected = new Set([selected]);
    const pos = project.editor.positions,
      ports = this.api.ports;
    this.size = {
      width: Math.max(
        1400,
        ...project.scenes.map((s) => (pos[s.id]?.x || 60) + 370),
      ),
      height: Math.max(
        900,
        ...project.scenes.map(
          (s) => (pos[s.id]?.y || 60) + 240 + ports(s).length * 34,
        ),
      ),
    };
    const edges = project.scenes.flatMap((s) =>
      ports(s)
        .filter((x) => x.target.kind === "scene")
        .map((x) => ({ s, port: x, index: ports(s).indexOf(x) })),
    );
    this.host.innerHTML = `<div class="graph-space" style="width:${this.size.width * this.scale}px;height:${this.size.height * this.scale}px"><div class="graph-board" style="width:${this.size.width}px;height:${this.size.height}px;transform:scale(${this.scale})"><svg class="graph-lines">${edges
      .map(({ s, port, index }) => {
        const f = pos[s.id] || { x: 60, y: 60 },
          t = pos[port.target.sceneId];
        if (!t) return "";
        const x = f.x + 268,
          y = f.y + 174 + index * 34;
        return `<path data-line-from="${s.id}" data-line-path="${port.path}" d="M${x},${y} C${x + 90},${y} ${t.x - 90},${t.y + 40} ${t.x},${t.y + 40}"/>`;
      })
      .join("")}</svg>${project.scenes
      .map((s) => {
        const xy = pos[s.id] || { x: 60, y: 60 };
        return `<article tabindex="0" aria-label="场景 ${esc(s.name)}" class="graph-card ${this.selected.has(s.id) ? "selected" : ""}" data-graph-scene="${s.id}" style="left:${xy.x}px;top:${xy.y}px"><div class="node-title"><i class="node-icon ${s.role}">${s.role === "ending" ? "◈" : "▣"}</i><h3>${esc(s.name)}</h3><button data-node-menu="${s.id}" aria-label="${esc(s.name)}菜单">···</button></div><div class="node-thumb" data-thumb="${s.id}"><span>${s.role === "ending" ? "结局" : "场景"}</span></div><div class="node-meta"><span>${project.entryId === s.id ? "入口 · " : ""}${(duration(s) / 1000).toFixed(1)}s</span><span>${s.events.length} 处互动</span><button data-node-open="${s.id}" title="进入编辑">编辑 ↗</button></div>${ports(
          s,
        )
          .map(
            (port) =>
              `<button class="node-port ${this.pending?.sceneId === s.id && this.pending.path === port.path ? "pending" : ""} ${port.target.kind === "unlinked" ? "unlinked" : ""}" data-port="${port.path}" data-from="${s.id}" title="${esc(port.label)}"><span>${esc(port.label)}</span><small>${esc(port.target.kind === "scene" ? project.scenes.find((x) => x.id === port.target.sceneId)?.name || "目标缺失" : { continue: "继续", end: "结束", seek: "定位", unlinked: "待连接" }[port.target.kind])}</small><i></i></button>`,
          )
          .join("")}</article>`;
      })
      .join("")}</div></div>`;
    for (const s of project.scenes) {
      const c = visualClips(s)[0],
        a = project.assets[c?.assetId];
      if (!a) continue;
      const host = this.host.querySelector(`[data-thumb="${s.id}"]`);
      this.api
        .assetUrl(a)
        .then((url) => {
          if (!host.isConnected) return;
          const el = document.createElement(
            a.kind === "video" ? "video" : "img",
          );
          if (a.kind === "video") {
            el.muted = true;
            el.playsInline = true;
            el.preload = "metadata";
          }
          el.src = url;
          host.replaceChildren(el);
        })
        .catch(() => {});
    }
    this.api.selection(this.selected.size);
    this.drawMini();
  }
  highlight() {
    for (const el of this.host.querySelectorAll("[data-graph-scene]"))
      el.classList.toggle("selected", this.selected.has(el.dataset.graphScene));
    this.api.selection(this.selected.size);
    this.drawMini();
  }
  drawMini() {
    const mini = this.api.mini();
    if (!mini) return;
    mini.innerHTML = `<svg viewBox="0 0 ${this.size.width} ${this.size.height}">${this.project.scenes
      .map((s) => {
        const p = this.project.editor.positions[s.id] || { x: 60, y: 60 };
        return `<rect data-mini="${s.id}" x="${p.x}" y="${p.y}" width="268" height="150" rx="15" fill="${this.selected.has(s.id) ? "#7770ed" : "#c8cbd7"}"/>`;
      })
      .join("")}</svg>`;
    mini.onclick = (e) => {
      const id = e.target.dataset.mini;
      if (id) this.locate(id);
    };
  }
  zoom(factor) {
    this.scale = Math.max(0.25, Math.min(2, this.scale * factor));
    this.render(this.project, [...this.selected][0]);
    this.api.zoom(this.scale);
  }
  fit() {
    this.scale = Math.max(
      0.25,
      Math.min(
        1,
        (this.host.clientWidth - 60) / this.size.width,
        (this.host.clientHeight - 50) / this.size.height,
      ),
    );
    this.render(this.project, [...this.selected][0]);
    this.host.scrollTo(0, 0);
    this.api.zoom(this.scale);
  }
  locate(id) {
    const p = this.project.editor.positions[id];
    if (!p) return;
    this.host.scrollTo({
      left: Math.max(
        0,
        p.x * this.scale - this.host.clientWidth / 2 + 134 * this.scale,
      ),
      top: Math.max(0, p.y * this.scale - 80),
      behavior: "smooth",
    });
  }
  click(e) {
    if (this.moved) {
      this.moved = false;
      return;
    }
    const open = e.target.closest("[data-node-open]"),
      menu = e.target.closest("[data-node-menu]"),
      line = e.target.closest("[data-line-from]"),
      port = e.target.closest("[data-port]"),
      card = e.target.closest("[data-graph-scene]");
    if (open) {
      this.api.open(open.dataset.nodeOpen);
      return;
    }
    if (menu) {
      this.selected = new Set([menu.dataset.nodeMenu]);
      this.api.select(menu.dataset.nodeMenu);
      this.api.menu(menu.dataset.nodeMenu);
      return;
    }
    if (line) {
      this.api.connection(line.dataset.lineFrom, line.dataset.linePath);
      return;
    }
    if (port) {
      this.pending = { sceneId: port.dataset.from, path: port.dataset.port };
      this.api.connection(this.pending.sceneId, this.pending.path);
      return;
    }
    if (card) {
      const id = card.dataset.graphScene;
      if (this.pending) {
        this.api.connect(this.pending.sceneId, this.pending.path, id);
        this.pending = null;
        return;
      }
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        this.selected.has(id)
          ? this.selected.delete(id)
          : this.selected.add(id);
        if (!this.selected.size) this.selected.add(id);
      } else this.selected = new Set([id]);
      this.api.select(id);
    }
  }
  portDrag(e, port) {
    const start = { x: e.clientX, y: e.clientY },
      from = port.dataset.from,
      path = port.dataset.port,
      ctrl = new AbortController();
    let moved = false;
    const svg = this.host.querySelector(".graph-lines"),
      line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.style.cssText =
      "stroke:#8470ef;stroke-dasharray:5 4;pointer-events:none";
    svg.append(line);
    window.addEventListener(
      "pointermove",
      (ev) => {
        moved =
          Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 5;
        const r = svg.getBoundingClientRect(),
          x1 = (start.x - r.left) / this.scale,
          y1 = (start.y - r.top) / this.scale,
          x2 = (ev.clientX - r.left) / this.scale,
          y2 = (ev.clientY - r.top) / this.scale;
        line.setAttribute(
          "d",
          "M" +
            x1 +
            "," +
            y1 +
            " C" +
            (x1 + 80) +
            "," +
            y1 +
            " " +
            (x2 - 80) +
            "," +
            y2 +
            " " +
            x2 +
            "," +
            y2,
        );
      },
      { signal: ctrl.signal },
    );
    const finish = (ev) => {
      ctrl.abort();
      line.remove();
      if (!moved) return;
      this.moved = true;
      if (ev.type === "pointercancel") return;
      const target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-graph-scene]");
      if (target) this.api.connect(from, path, target.dataset.graphScene);
    };
    window.addEventListener("pointerup", finish, {
      once: true,
      signal: ctrl.signal,
    });
    window.addEventListener("pointercancel", finish, {
      once: true,
      signal: ctrl.signal,
    });
  }
  pointer(e) {
    const port = e.target.closest("[data-port]");
    if (port && e.button === 0) {
      this.portDrag(e, port);
      return;
    }
    if (e.button !== 0 || e.target.closest("button,[data-line-from]")) return;
    const card = e.target.closest("[data-graph-scene]"),
      x = e.clientX,
      y = e.clientY,
      scrollX = this.host.scrollLeft,
      scrollY = this.host.scrollTop,
      base = new Map(),
      mode = card
        ? "move"
        : e.shiftKey || this.mode === "select"
          ? "select"
          : "pan";
    if (card) {
      const id = card.dataset.graphScene;
      if (!this.selected.has(id)) this.selected = new Set([id]);
      for (const sid of this.selected)
        base.set(sid, { ...this.project.editor.positions[sid] });
    }
    let dx = 0,
      dy = 0,
      box;
    const ctrl = new AbortController();
    if (mode === "select") {
      box = document.createElement("div");
      box.className = "selection-box";
      this.host.append(box);
    }
    window.addEventListener(
      "pointermove",
      (ev) => {
        dx = ev.clientX - x;
        dy = ev.clientY - y;
        if (mode === "pan") {
          this.host.scrollLeft = scrollX - dx;
          this.host.scrollTop = scrollY - dy;
        } else if (mode === "move")
          for (const [id, p] of base) {
            const el = this.host.querySelector(`[data-graph-scene="${id}"]`);
            el.style.left = Math.max(0, p.x + dx / this.scale) + "px";
            el.style.top = Math.max(0, p.y + dy / this.scale) + "px";
          }
        else {
          const r = this.host.getBoundingClientRect();
          box.style.cssText = `left:${Math.min(x, ev.clientX) - r.left + scrollX}px;top:${Math.min(y, ev.clientY) - r.top + scrollY}px;width:${Math.abs(dx)}px;height:${Math.abs(dy)}px`;
        }
      },
      { signal: ctrl.signal },
    );
    const finish = (ev) => {
      ctrl.abort();
      box?.remove();
      if (ev.type === "pointercancel") {
        this.render(this.project, [...this.selected][0]);
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      this.moved = true;
      if (mode === "move")
        this.api.move(
          [...base].map(([id, p]) => ({
            id,
            x: Math.round(Math.max(0, p.x + dx / this.scale)),
            y: Math.round(Math.max(0, p.y + dy / this.scale)),
          })),
        );
      if (mode === "select") {
        const rect = {
          left: Math.min(x, x + dx),
          right: Math.max(x, x + dx),
          top: Math.min(y, y + dy),
          bottom: Math.max(y, y + dy),
        };
        this.selected = new Set(
          [...this.host.querySelectorAll("[data-graph-scene]")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.left < rect.right &&
                r.right > rect.left &&
                r.top < rect.bottom &&
                r.bottom > rect.top
              );
            })
            .map((el) => el.dataset.graphScene),
        );
        if (this.selected.size) this.api.select([...this.selected][0]);
      }
    };
    window.addEventListener("pointerup", finish, {
      once: true,
      signal: ctrl.signal,
    });
    window.addEventListener("pointercancel", finish, {
      once: true,
      signal: ctrl.signal,
    });
  }
}
