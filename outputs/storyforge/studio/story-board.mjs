import { esc } from "./storage.mjs";
import { duration, reachable } from "./model.mjs";
import { visualClips } from "./timeline.mjs";
import {
  LOADING,
  SPLASH,
  NODE_WIDTH as W,
  specialNode,
  flowNodes,
  arrangeFlow,
  flowPorts,
  flowPositions,
  routeFlow,
  curveFlow,
  shortcutTarget,
  pathData,
} from "./flow-layout.mjs";
const svgEl = (name) =>
  document.createElementNS("http://www.w3.org/2000/svg", name);
export class StoryBoard {
  constructor(host, api) {
    this.lifecycle = new AbortController();
    this.listen = (target, type, fn) =>
      target.addEventListener(type, fn, { signal: this.lifecycle.signal });
    this.host = host;
    this.api = api;
    this.scale = 1;
    this.selected = new Set();
    this.mode = "select";
    this.pending = null;
    this.cards = new Map();
    this.edges = new Map();
    this.positions = {};
    host.innerHTML =
      '<div class="graph-space"><div class="graph-board"><svg class="graph-lines"><defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#9d94b6" stroke="none"/></marker></defs></svg><div class="graph-guides"></div></div></div>';
    this.space = host.firstElementChild;
    this.surface = this.space.firstElementChild;
    this.svg = this.surface.querySelector("svg");
    this.guides = this.surface.querySelector(".graph-guides");
    host.addEventListener("pointerdown", (e) => this.pointer(e));
    host.addEventListener("click", (e) => this.click(e));
    host.addEventListener("pointerover", (e) => {
      const t = e.target.closest("[data-reveal-from]");
      if (t) {
        this.revealed = t.dataset.revealFrom + "|" + t.dataset.revealPath;
        this.lines();
      }
    });
    host.addEventListener("pointerout", (e) => {
      if (e.target.closest("[data-reveal-from]")) {
        this.revealed = null;
        this.lines();
      }
    });
    host.addEventListener("dblclick", (e) => {
      if (e.target.closest("button,[data-line-from]")) return;
      const n = e.target.closest("[data-graph-scene]");
      n ? api.open(n.dataset.graphScene) : api.create(this.point(e));
    });
    host.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const n = e.target.closest("[data-graph-scene]");
      if (n) {
        this.choose(n.dataset.graphScene);
        api.menu(n.dataset.graphScene);
      } else api.create(this.point(e));
    });
    host.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoom(Math.exp(-e.deltaY * 0.002), e);
        }
      },
      { passive: false },
    );
    host.addEventListener("dragover", (e) => e.preventDefault());
    host.addEventListener("drop", (e) => {
      e.preventDefault();
      api.drop(e.dataTransfer, this.point(e));
    });
    this.listen(document, "keydown", (e) => {
      if (
        host.closest("[hidden]") ||
        host.clientWidth === 0 ||
        e.target.closest("input,textarea,select,dialog")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        this.spaceHeld = true;
        host.classList.add("panning");
      }
      if (e.key === "Escape") {
        this.cancelDrag?.();
        this.pending = null;
        this.activeEdge = null;
        this.highlight();
      }
    });
    this.listen(document, "keyup", (e) => {
      if (e.code === "Space") {
        this.spaceHeld = false;
        host.classList.remove("panning");
      }
    });
    this.listen(window, "blur", () => {
      this.spaceHeld = false;
      this.cancelDrag?.();
    });
  }
  dispose() {
    this.cancelDrag?.();
    this.lifecycle.abort();
  }
  point(e) {
    const r = this.host.getBoundingClientRect();
    return {
      x: Math.max(20, (e.clientX - r.left + this.host.scrollLeft) / this.scale),
      y: Math.max(20, (e.clientY - r.top + this.host.scrollTop) / this.scale),
    };
  }
  ports(n) {
    return flowPorts(this.project, n, this.api.ports);
  }
  render(project, selected) {
    if (this.project?.id !== project.id) {
      this.selected = new Set([selected]);
      this.activeEdge = null;
      this.scale = 1;
      this.host.scrollTo(0, 0);
    }
    this.project = project;
    this.nodes = flowNodes(project);
    this.logicalPositions = arrangeFlow(project, this.api.ports);
    this.positions = flowPositions(project);
    const ids = new Set(this.nodes.map((n) => n.id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    for (const [id, el] of this.cards)
      if (!ids.has(id)) {
        el.remove();
        this.cards.delete(id);
      }
    for (const n of this.nodes) {
      let el = this.cards.get(n.id);
      if (!el) {
        el = document.createElement("article");
        el.tabIndex = 0;
        el.className = "graph-card";
        el.dataset.graphScene = n.id;
        el.innerHTML =
          '<div class="node-title"><i class="node-icon"></i><h3></h3><button class="node-menu">···</button></div><div class="node-thumb"></div><div class="node-meta"><span></span><button>编辑 ↗</button></div><div class="node-ports"></div><div class="node-actions"><button class="node-edit">编辑</button><button class="node-play">从此处试玩</button></div><i class="node-input"></i>';
        this.surface.append(el);
        this.cards.set(n.id, el);
      }
      el.setAttribute(
        "aria-label",
        (specialNode(n.id) ? "特殊节点 " : "节点 ") + n.name,
      );
      el.querySelector("h3").textContent = n.name;
      el.querySelector("h3").title = n.name;
      const icon = el.querySelector(".node-icon");
      icon.className = "node-icon " + n.role;
      icon.textContent =
        { loading: "◌", splash: "◈", ending: "◆", death: "◇" }[n.role] || "▣";
      const menu = el.querySelector(".node-menu");
      menu.dataset.nodeMenu = n.id;
      menu.setAttribute("aria-label", n.name + "菜单");
      const open = el.querySelector(".node-meta button");
      open.dataset.nodeOpen = n.id;
      open.title = "进入编辑";
      el.querySelector(".node-edit").dataset.nodeOpen = n.id;
      el.querySelector(".node-play").dataset.nodePlay = n.id;
      const ps = this.ports(n);
      el.querySelector(".node-meta span").textContent = specialNode(n.id)
        ? n.id === LOADING
          ? "准备资源"
          : "等待开始"
        : (Number.isFinite(duration(n))
            ? (duration(n) / 1000).toFixed(1) + " 秒"
            : "时长待读取") +
          " · " +
          ps.filter((p) => p.target.kind !== "end").length +
          " 个去向";
      const signature = JSON.stringify([ps, this.nodes.map((n) => n.name)]);
      const ph = el.querySelector(".node-ports");
      if (ph.dataset.signature !== signature) {
        ph.dataset.signature = signature;
        ph.innerHTML = ps
          .map(
            (p) =>
              `<button class="node-port ${p.target.kind === "unlinked" ? "unlinked" : ""}" data-port="${esc(p.path)}" data-from="${esc(n.id)}" ${p.fixed ? 'data-fixed="true"' : ""} title="${esc(p.label)}"><span>${esc(p.label)}</span><small>${esc(p.target.kind === "scene" ? this.nodes.find((n) => n.id === p.target.sceneId)?.name || "目标缺失" : { end: "结束", unlinked: "待连接" }[p.target.kind] || "")}</small><i></i></button>${!p.fixed && shortcutTarget(project, p.target) ? `<button class="destination-tag" data-locate-node="${esc(p.target.sceneId)}" data-reveal-from="${esc(n.id)}" data-reveal-path="${esc(p.path)}" title="点击定位；悬停查看连线">↗ ${esc(this.nodes.find((n) => n.id === p.target.sceneId)?.name || "目标缺失")}</button>` : ""}`,
          )
          .join("");
      }
      const aid =
        n.id === LOADING
          ? project.loading.video || project.loading.image
          : n.id === SPLASH
            ? project.splash.video
            : visualClips(n)[0]?.assetId;
      const a = project.assets[aid],
        thumb = el.querySelector(".node-thumb"),
        key = JSON.stringify(a || null);
      if (thumb.dataset.asset !== key) {
        thumb.dataset.asset = key;
        thumb.textContent = specialNode(n.id)
          ? n.name
          : n.role === "ending"
            ? "结局"
            : "节点";
        if (a)
          this.api
            .assetUrl(a)
            .then((url) => {
              if (!thumb.isConnected || thumb.dataset.asset !== key) return;
              const media = document.createElement(
                a.kind === "video" ? "video" : "img",
              );
              if (a.kind === "video") {
                media.muted = true;
                media.playsInline = true;
                media.preload = "metadata";
              }
              media.src = url;
              media.draggable = false;
              thumb.replaceChildren(media);
            })
            .catch(() => {});
      }
    }
    const connected = reachable(project),
      loose = this.nodes.filter(
        (n) => !specialNode(n.id) && !connected.has(n.id),
      );
    this.looseLabel ||= Object.assign(document.createElement("div"), {
      className: "flow-loose-label",
      textContent: "未接入主流程",
    });
    this.surface.append(this.looseLabel);
    this.looseLabel.hidden = !loose.length;
    if (loose.length) {
      this.looseLabel.style.left =
        Math.min(...loose.map((n) => this.positions[n.id].x)) + "px";
      this.looseLabel.style.top =
        Math.min(...loose.map((n) => this.positions[n.id].y)) - 35 + "px";
    }
    this.positionCards();
    this.highlight();
  }
  positionCards() {
    for (const [id, el] of this.cards) {
      const p = this.positions[id];
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
    }
    this.measure();
  }
  measure() {
    this.size = {
      width: Math.max(
        1400,
        ...this.nodes.map((n) => this.positions[n.id].x + W + 180),
      ),
      height: Math.max(
        900,
        ...this.nodes.map(
          (n) => this.positions[n.id].y + this.height(n.id) + 180,
        ),
      ),
    };
    this.applyScale();
  }
  height(id) {
    return this.cards.get(id)?.offsetHeight || 164;
  }
  applyScale() {
    this.surface.style.width = this.size.width + "px";
    this.surface.style.height = this.size.height + "px";
    this.surface.style.transform = `scale(${this.scale})`;
    this.space.style.width = this.size.width * this.scale + "px";
    this.space.style.height = this.size.height * this.scale + "px";
    this.surface.classList.toggle("overview", this.scale < 0.48);
    this.api.zoom(this.scale);
  }
  choose(id, add = false) {
    this.activeEdge = null;
    if (add) {
      this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    } else this.selected = new Set([id]);
    this.api.select(id);
    this.highlight();
  }
  highlight() {
    for (const [id, el] of this.cards)
      el.classList.toggle("selected", this.selected.has(id));
    this.api.selection(
      [...this.selected].filter((id) => !specialNode(id)).length,
    );
    this.measure();
    this.lines();
    this.drawMini();
  }
  lines() {
    const wanted = new Set(),
      rects = this.nodes.map((n) => ({
        id: n.id,
        ...this.positions[n.id],
        w: W,
        h: this.height(n.id),
      }));
    let lane = 0;
    for (const n of this.nodes) {
      const ps = this.ports(n);
      for (let i = 0; i < ps.length; i++) {
        const port = ps[i],
          to = port.target.sceneId;
        if (port.target.kind !== "scene" || !this.positions[to]) continue;
        const key = n.id + "|" + port.path;
        wanted.add(key);
        let edge = this.edges.get(key);
        if (!edge) {
          const g = svgEl("g"),
            path = svgEl("path"),
            hit = svgEl("path"),
            text = svgEl("text"),
            handle = svgEl("circle");
          path.classList.add("flow-line");
          path.setAttribute("marker-end", "url(#flow-arrow)");
          hit.classList.add("flow-hit");
          for (const el of [path, hit, handle]) {
            el.dataset.lineFrom = n.id;
            el.dataset.linePath = port.path;
          }
          text.classList.add("flow-label");
          handle.classList.add("flow-handle");
          handle.dataset.reconnect = "true";
          handle.setAttribute("r", "6");
          g.append(path, hit, text, handle);
          this.svg.append(g);
          edge = { g, path, hit, text, handle };
          this.edges.set(key, edge);
        }
        const f = this.positions[n.id],
          t = this.positions[to],
          expanded = this.scale >= 0.48;
        const portEl = this.cards.get(n.id).querySelectorAll(".node-port")[i];
        const start = {
            x: f.x + W,
            y:
              f.y +
              (expanded && portEl
                ? portEl.offsetTop + portEl.offsetHeight / 2
                : 80),
          },
          end = { x: t.x, y: t.y + 40 },
          back = t.x <= f.x;
        const isReturn =
          this.logicalPositions[to].x <= this.logicalPositions[n.id].x;
        const d = curveFlow(start, end, rects, { back, lane: lane++ });
        const shortcut =
          !port.fixed && shortcutTarget(this.project, port.target);
        edge.g.style.display =
          shortcut &&
          !this.showAllLines &&
          this.revealed !== key &&
          this.activeEdge?.from + "|" + this.activeEdge?.path !== key
            ? "none"
            : "";
        edge.g.setAttribute(
          "aria-label",
          `${n.name} · ${port.label} → ${this.nodes.find((n) => n.id === to)?.name}`,
        );
        edge.path.setAttribute("d", d);
        edge.hit.setAttribute("d", d);
        edge.handle.setAttribute("cx", end.x - 12);
        edge.handle.setAttribute("cy", end.y);
        const active =
            this.activeEdge?.from === n.id &&
            this.activeEdge.path === port.path,
          related = this.selected.has(n.id) || this.selected.has(to);
        edge.g.classList.toggle("related", related);
        edge.g.classList.toggle(
          "dim",
          this.selected.size > 0 && !related && !active,
        );
        edge.g.classList.toggle("active", active);
        edge.g.classList.toggle("return-line", isReturn);
        edge.g.classList.toggle("fixed-line", !!port.fixed);
        edge.handle.style.display = active && !port.fixed ? "" : "none";
        edge.text.textContent = (isReturn ? "返回 · " : "") + port.label;
        edge.text.setAttribute("x", start.x + 24);
        edge.text.setAttribute("y", start.y - 8);
        edge.text.style.display = active ? "" : "none";
      }
    }
    for (const [key, e] of this.edges)
      if (!wanted.has(key)) {
        e.g.remove();
        this.edges.delete(key);
      }
  }
  drawMini() {
    const mini = this.api.mini();
    if (!mini) return;
    mini.innerHTML = `<svg viewBox="0 0 ${this.size.width} ${this.size.height}">${this.nodes
      .map((n) => {
        const p = this.positions[n.id];
        return `<rect data-mini="${esc(n.id)}" x="${p.x}" y="${p.y}" width="240" height="150" rx="8" fill="${this.selected.has(n.id) ? "#7764dc" : "#bfc3d3"}"/>`;
      })
      .join("")}</svg>`;
    mini.onclick = (e) => {
      if (e.target.dataset.mini) this.locate(e.target.dataset.mini);
    };
  }
  zoom(factor, event) {
    const r = this.host.getBoundingClientRect(),
      x = event ? event.clientX - r.left : this.host.clientWidth / 2,
      y = event ? event.clientY - r.top : this.host.clientHeight / 2,
      wx = (this.host.scrollLeft + x) / this.scale,
      wy = (this.host.scrollTop + y) / this.scale;
    const oldOverview = this.scale < 0.48;
    this.scale = Math.max(0.15, Math.min(2, this.scale * factor));
    this.applyScale();
    this.host.scrollLeft = wx * this.scale - x;
    this.host.scrollTop = wy * this.scale - y;
    if (oldOverview !== this.scale < 0.48) {
      this.measure();
      this.lines();
    }
  }
  fit() {
    this.scale = Math.max(
      0.15,
      Math.min(
        1,
        (this.host.clientWidth - 60) / this.size.width,
        (this.host.clientHeight - 60) / this.size.height,
      ),
    );
    this.applyScale();
    this.host.scrollTo(0, 0);
    this.lines();
  }
  locate(id) {
    const p = this.positions[id];
    if (!p) return;
    this.host.scrollTo({
      left: Math.max(
        0,
        p.x * this.scale - this.host.clientWidth / 2 + (W * this.scale) / 2,
      ),
      top: Math.max(
        0,
        p.y * this.scale - this.host.clientHeight / 2 + 80 * this.scale,
      ),
      behavior: "smooth",
    });
  }
  click(e) {
    if (this.moved) {
      this.moved = false;
      return;
    }
    const locate = e.target.closest("[data-locate-node]");
    if (locate) {
      this.locate(locate.dataset.locateNode);
      this.choose(locate.dataset.locateNode);
      return;
    }
    const play = e.target.closest("[data-node-play]");
    if (play) {
      this.choose(play.dataset.nodePlay);
      return this.api.preview(play.dataset.nodePlay);
    }
    const open = e.target.closest("[data-node-open]"),
      menu = e.target.closest("[data-node-menu]"),
      line = e.target.closest("[data-line-from]"),
      port = e.target.closest("[data-port]"),
      card = e.target.closest("[data-graph-scene]");
    if (open) return this.api.open(open.dataset.nodeOpen);
    if (menu) {
      this.choose(menu.dataset.nodeMenu);
      return this.api.menu(menu.dataset.nodeMenu);
    }
    if (line) {
      this.activeEdge = {
        from: line.dataset.lineFrom,
        path: line.dataset.linePath,
      };
      this.lines();
      return this.api.edge?.(this.activeEdge);
    }
    if (port) {
      if (port.dataset.fixed) return;
      return this.api.connection(port.dataset.from, port.dataset.port);
    }
    if (card)
      return this.choose(
        card.dataset.graphScene,
        e.shiftKey || e.ctrlKey || e.metaKey,
      );
    this.selected.clear();
    this.activeEdge = null;
    this.highlight();
    this.api.blank?.();
  }
  portDrag(e, port) {
    if (port.dataset.fixed) return;
    this.cancelDrag?.();
    const from = port.dataset.from || port.dataset.lineFrom,
      path = port.dataset.port || port.dataset.linePath,
      ps = this.ports(this.nodes.find((n) => n.id === from));
    if (ps.find((p) => p.path === path)?.fixed) return;
    e.preventDefault();
    const initial = { x: e.clientX, y: e.clientY },
      f = this.positions[from],
      portEl = [...this.cards.get(from).querySelectorAll(".node-port")].find(
        (el) => el.dataset.port === path,
      ),
      start = {
        x: f.x + W,
        y:
          f.y +
          (portEl && this.scale >= 0.48
            ? portEl.offsetTop + portEl.offsetHeight / 2
            : 80),
      },
      line = svgEl("path");
    line.classList.add("flow-preview");
    this.svg.append(line);
    let moved = false;
    const ctrl = new AbortController();
    const cleanup = () => {
      ctrl.abort();
      line.remove();
      this.cancelDrag = null;
    };
    this.cancelDrag = cleanup;
    window.addEventListener(
      "pointermove",
      (ev) => {
        moved = Math.hypot(ev.clientX - initial.x, ev.clientY - initial.y) > 4;
        const end = this.point(ev),
          mid = (start.x + end.x) / 2;
        line.setAttribute(
          "d",
          `M${start.x},${start.y} C${mid},${start.y} ${mid},${end.y} ${end.x},${end.y}`,
        );
      },
      { signal: ctrl.signal },
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        cleanup();
        if (!moved) return;
        this.moved = true;
        const target = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest("[data-graph-scene]");
        if (target) this.api.connect(from, path, target.dataset.graphScene);
        else {
          const r = this.host.getBoundingClientRect();
          if (
            ev.clientX >= r.left &&
            ev.clientX <= r.right &&
            ev.clientY >= r.top &&
            ev.clientY <= r.bottom
          )
            this.api.create(this.point(ev), { from, path });
        }
      },
      { once: true, signal: ctrl.signal },
    );
    window.addEventListener("pointercancel", cleanup, {
      once: true,
      signal: ctrl.signal,
    });
  }
  pointer(e) {
    const port = e.target.closest("[data-port],[data-reconnect]");
    if (port && e.button === 0) return this.portDrag(e, port);
    if (
      (e.button !== 0 && e.button !== 1) ||
      e.target.closest("button,[data-line-from]")
    )
      return;
    const card = e.target.closest("[data-graph-scene]"),
      start = { x: e.clientX, y: e.clientY },
      scroll = { x: this.host.scrollLeft, y: this.host.scrollTop },
      mode =
        this.spaceHeld || e.button === 1
          ? "pan"
          : card
            ? "move"
            : e.shiftKey || this.mode === "select"
              ? "select"
              : "pan";
    e.preventDefault();
    this.cancelDrag?.();
    const ctrl = new AbortController(),
      base = {};
    let dx = 0,
      dy = 0,
      box,
      raf;
    if (mode === "move") {
      const id = card.dataset.graphScene;
      if (!this.selected.has(id) && !e.shiftKey && !e.ctrlKey && !e.metaKey)
        this.selected = new Set([id]);
      for (const id of new Set([...this.selected, card.dataset.graphScene]))
        base[id] = { ...this.positions[id] };
    }
    if (mode === "select") {
      box = document.createElement("div");
      box.className = "selection-box";
      this.host.append(box);
    }
    const cleanup = () => {
      ctrl.abort();
      box?.remove();
      this.guides.innerHTML = "";
      cancelAnimationFrame(raf);
      this.cancelDrag = null;
    };
    this.cancelDrag = () => {
      cleanup();
      for (const [id, p] of Object.entries(base)) this.positions[id] = p;
      this.positionCards();
      this.lines();
    };
    window.addEventListener(
      "pointermove",
      (ev) => {
        dx = ev.clientX - start.x;
        dy = ev.clientY - start.y;
        if (mode === "pan") {
          this.host.scrollLeft = scroll.x - dx;
          this.host.scrollTop = scroll.y - dy;
          return;
        }
        if (mode === "select") {
          const r = this.host.getBoundingClientRect();
          box.style.cssText = `left:${Math.min(start.x, ev.clientX) - r.left + scroll.x}px;top:${Math.min(start.y, ev.clientY) - r.top + scroll.y}px;width:${Math.abs(dx)}px;height:${Math.abs(dy)}px`;
          return;
        }
        let mx = dx / this.scale,
          my = dy / this.scale;
        this.guides.innerHTML = "";
        const lead = Object.values(base)[0];
        if (!lead) return;
        if (!ev.altKey) {
          let sx = null,
            sy = null;
          for (const n of this.nodes) {
            if (base[n.id]) continue;
            const p = this.positions[n.id];
            if (Math.abs(p.x - lead.x - mx) < 7 / this.scale) sx = p.x - lead.x;
            if (Math.abs(p.y - lead.y - my) < 7 / this.scale) sy = p.y - lead.y;
          }
          if (sx !== null) {
            mx = sx;
            this.guides.innerHTML += `<i style="left:${lead.x + mx}px;top:0;height:${this.size.height}px;width:1px"></i>`;
          }
          if (sy !== null) {
            my = sy;
            this.guides.innerHTML += `<i style="top:${lead.y + my}px;left:0;width:${this.size.width}px;height:1px"></i>`;
          }
        }
        mx = Math.max(
          mx,
          20 - Math.min(...Object.values(base).map((p) => p.x)),
        );
        my = Math.max(
          my,
          20 - Math.min(...Object.values(base).map((p) => p.y)),
        );
        for (const [id, p] of Object.entries(base)) {
          this.positions[id] = {
            x: Math.round(p.x + mx),
            y: Math.round(p.y + my),
          };
          const el = this.cards.get(id);
          el.style.left = this.positions[id].x + "px";
          el.style.top = this.positions[id].y + "px";
        }
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = null;
            this.lines();
          });
      },
      { signal: ctrl.signal },
    );
    window.addEventListener(
      "pointerup",
      (ev) => {
        cleanup();
        if (Math.hypot(dx, dy) < 4) return;
        this.moved = true;
        if (mode === "move") {
          this.api.move(
            Object.keys(base).map((id) => ({ id, ...this.positions[id] })),
          );
          this.measure();
          this.lines();
        }
        if (mode === "select") {
          const r = {
            left: Math.min(start.x, ev.clientX),
            right: Math.max(start.x, ev.clientX),
            top: Math.min(start.y, ev.clientY),
            bottom: Math.max(start.y, ev.clientY),
          };
          this.selected = new Set(
            [...this.cards]
              .filter(([, el]) => {
                const b = el.getBoundingClientRect();
                return (
                  b.left < r.right &&
                  b.right > r.left &&
                  b.top < r.bottom &&
                  b.bottom > r.top
                );
              })
              .map(([id]) => id),
          );
          if (this.selected.size) this.api.select([...this.selected][0]);
          this.highlight();
        }
      },
      { once: true, signal: ctrl.signal },
    );
    window.addEventListener("pointercancel", () => this.cancelDrag?.(), {
      once: true,
      signal: ctrl.signal,
    });
  }
}
