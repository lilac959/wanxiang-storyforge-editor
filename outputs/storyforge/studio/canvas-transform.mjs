const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round = (v) => Math.round(v * 100) / 100;
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function uiTransformStyle(item) {
  const scale = (item.scale ?? 100) / 100;
  return `--scale:${scale};--scale-x:${(scale * (item.stretchX ?? 100)) / 100};--scale-y:${(scale * (item.stretchY ?? 100)) / 100}`;
}
export function captionBoxStyle(item) {
  return `${item.width == null ? "" : `width:${item.width}%;`}${item.height == null ? "" : `height:${item.height}%;`}`;
}

// All geometry is measured in the visible, fitted stage, including letterboxing.
export function transformBox(
  box,
  handle,
  dx,
  dy,
  stage,
  limits = {},
  snap = true,
) {
  let width = box.width,
    height = box.height,
    left = box.left,
    top = box.top;
  const guides = [];
  if (handle === "move") {
    left += dx;
    top += dy;
    const cx = stage.left + stage.width / 2,
      cy = stage.top + stage.height / 2;
    if (snap && Math.abs(left + width / 2 - cx) <= 6) {
      left = cx - width / 2;
      guides.push("x");
    }
    if (snap && Math.abs(top + height / 2 - cy) <= 6) {
      top = cy - height / 2;
      guides.push("y");
    }
  } else {
    const horizontal = /[ew]/.test(handle),
      vertical = /[ns]/.test(handle);
    const sx = handle.includes("w") ? -1 : 1,
      sy = handle.includes("n") ? -1 : 1;
    if (horizontal && vertical) {
      const factor = clamp(
        1 +
          (sx * dx * width + sy * dy * height) /
            (width * width + height * height),
        limits.min ?? 0.05,
        limits.max ?? 4,
      );
      width *= factor;
      height *= factor;
    } else {
      if (horizontal)
        width *= clamp(
          1 + (sx * dx) / width,
          limits.minX ?? 0.05,
          limits.maxX ?? 4,
        );
      if (vertical)
        height *= clamp(
          1 + (sy * dy) / height,
          limits.minY ?? 0.05,
          limits.maxY ?? 4,
        );
    }
    if (handle.includes("w")) left += box.width - width;
    if (handle.includes("n")) top += box.height - height;
  }
  return { left, top, width, height, guides };
}

export function transformPatch(
  item,
  kind,
  before,
  after,
  stage,
  handle,
  option = false,
) {
  const patch = {
    x: round(
      clamp(
        item.x +
          ((after.left + after.width / 2 - (before.left + before.width / 2)) /
            stage.width) *
            100,
        option ? -100 : 0,
        100,
      ),
    ),
    y: round(
      clamp(
        item.y +
          ((after.top + after.height / 2 - (before.top + before.height / 2)) /
            (option ? stage.width : stage.height)) *
            100,
        option ? -100 : 0,
        100,
      ),
    ),
  };
  if (handle === "move") return patch;
  const fx = after.width / before.width,
    fy = after.height / before.height;
  const corner = handle.length === 2;
  if (kind === "subtitle") {
    patch.width = round(clamp((after.width / stage.width) * 100, 0.5, 100));
    patch.height = round(clamp((after.height / stage.height) * 100, 0.5, 100));
    if (corner) patch.size = round(clamp(item.size * fx, 12, 300));
  } else if (corner)
    patch.scale = round(clamp((item.scale ?? 100) * fx, 5, 180));
  else {
    if (/[ew]/.test(handle))
      patch.stretchX = round(clamp((item.stretchX ?? 100) * fx, 5, 400));
    if (/[ns]/.test(handle))
      patch.stretchY = round(clamp((item.stretchY ?? 100) * fy, 5, 400));
  }
  return patch;
}

export class CanvasTransform {
  constructor(canvas, { begin, preview, commit, cancel, snap = () => true }) {
    Object.assign(this, { canvas, begin, preview, commit, cancel, snap });
    this.layer = document.createElement("div");
    this.layer.className = "canvas-transform";
    this.layer.hidden = true;
    this.layer.innerHTML = `<div class="transform-box" data-canvas-transform="move" aria-label="拖动画面元素">${HANDLES.map((h) => `<button type="button" class="transform-handle handle-${h}" data-canvas-transform="${h}" aria-label="${{ nw: "左上", n: "上边", ne: "右上", e: "右边", se: "右下", s: "下边", sw: "左下", w: "左边" }[h]}调整大小"></button>`).join("")}</div><i class="transform-guide guide-x" hidden></i><i class="transform-guide guide-y" hidden></i>`;
    canvas.append(this.layer);
    this.box = this.layer.querySelector(".transform-box");
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(canvas);
    window.addEventListener("resize", () => this.refresh());
    window.addEventListener("scroll", () => this.refresh(), true);
    this.layer.addEventListener("pointerdown", (e) => this.pointer(e));
    this.layer.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }
  select(target, item, kind, option = false) {
    if (this.active) return;
    if (this.target !== target) {
      if (this.target) this.observer.unobserve(this.target);
      if (target) this.observer.observe(target);
    }
    Object.assign(this, { target, item, kind, option });
    this.refresh();
  }
  refresh(rect) {
    if (this.active && !rect) return;
    const visible =
      this.target?.isConnected && this.target.getClientRects().length;
    this.layer.hidden = !visible;
    if (!visible) return;
    rect ||= this.target.getBoundingClientRect();
    const canvas = this.canvas.getBoundingClientRect();
    const width = Math.max(44, rect.width),
      height = Math.max(44, rect.height);
    Object.assign(this.box.style, {
      left: `${rect.left - canvas.left - (width - rect.width) / 2}px`,
      top: `${rect.top - canvas.top - (height - rect.height) / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }
  pointer(e, override) {
    const handle =
      override ||
      e.target.closest("[data-canvas-transform]")?.dataset.canvasTransform;
    if (!handle || e.button !== 0 || !this.target || this.active) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.begin() === false) return;
    const target = this.target,
      item = structuredClone(this.item),
      kind = this.kind,
      option = this.option;
    const before = target.getBoundingClientRect(),
      stage = this.canvas.querySelector(".play-stage").getBoundingClientRect();
    if (!before.width || !before.height || !stage.width || !stage.height)
      return;
    const originalStyle = target.getAttribute("style");
    const hadBox = target.classList.contains("caption-box");
    const originalScale = (item.scale ?? 100) / 100;
    const limits =
      kind === "subtitle"
        ? {
            min: Math.max(
              12 / item.size,
              (0.005 * stage.width) / before.width,
              (0.005 * stage.height) / before.height,
            ),
            max: Math.min(
              300 / item.size,
              stage.width / before.width,
              stage.height / before.height,
            ),
            minX: (0.005 * stage.width) / before.width,
            maxX: stage.width / before.width,
            minY: (0.005 * stage.height) / before.height,
            maxY: stage.height / before.height,
          }
        : {
            min: 0.05 / originalScale,
            max: 1.8 / originalScale,
            minX: 5 / (item.stretchX ?? 100),
            maxX: 400 / (item.stretchX ?? 100),
            minY: 5 / (item.stretchY ?? 100),
            maxY: 400 / (item.stretchY ?? 100),
          };
    const controller = new AbortController();
    let patch = null;
    this.active = true;
    const finish = (save) => {
      controller.abort();
      this.active = false;
      if (originalStyle === null) target.removeAttribute("style");
      else target.setAttribute("style", originalStyle);
      target.classList.toggle("caption-box", hadBox);
      this.layer
        .querySelectorAll(".transform-guide")
        .forEach((el) => (el.hidden = true));
      const changed =
        (patch &&
          Object.entries(patch).some(
            ([key, value]) =>
              Math.abs(
                value -
                  (item[key] ??
                    (key.startsWith("stretch") || key === "scale"
                      ? 100
                      : value)),
              ) > 0.001,
          )) ||
        !!(
          patch &&
          kind === "subtitle" &&
          handle !== "move" &&
          (item.width == null || item.height == null)
        );
      if (save && changed) this.commit(patch);
      else this.cancel();
      this.refresh();
    };
    window.addEventListener(
      "pointermove",
      (ev) => {
        const dx = ev.clientX - e.clientX,
          dy = ev.clientY - e.clientY;
        if (Math.hypot(dx, dy) < 2 && !patch) return;
        const rect = transformBox(
          before,
          handle,
          dx,
          dy,
          stage,
          limits,
          this.snap() && !ev.altKey,
        );
        patch = transformPatch(item, kind, before, rect, stage, handle, option);
        const draft = { ...item, ...patch };
        if (option) target.style.translate = `${draft.x}cqw ${draft.y}cqw`;
        else {
          target.style.left = draft.x + "%";
          target.style.top = draft.y + "%";
        }
        if (kind === "subtitle") {
          if (patch.width != null) target.style.width = patch.width + "%";
          if (patch.height != null) target.style.height = patch.height + "%";
          target.style.fontSize = draft.size / 19.2 + "cqw";
          if (handle !== "move") target.classList.add("caption-box");
        } else {
          const scale = (draft.scale ?? 100) / 100;
          target.style.setProperty(
            "--scale-x",
            (scale * (draft.stretchX ?? 100)) / 100,
          );
          target.style.setProperty(
            "--scale-y",
            (scale * (draft.stretchY ?? 100)) / 100,
          );
        }
        this.preview(patch);
        for (const axis of ["x", "y"]) {
          const guide = this.layer.querySelector(".guide-" + axis);
          guide.hidden = !rect.guides.includes(axis);
          const canvas = this.canvas.getBoundingClientRect();
          Object.assign(
            guide.style,
            axis === "x"
              ? {
                  left: `${stage.left - canvas.left + stage.width / 2}px`,
                  top: `${stage.top - canvas.top}px`,
                  height: `${stage.height}px`,
                }
              : {
                  top: `${stage.top - canvas.top + stage.height / 2}px`,
                  left: `${stage.left - canvas.left}px`,
                  width: `${stage.width}px`,
                },
          );
        }
        this.refresh(target.getBoundingClientRect());
      },
      { signal: controller.signal },
    );
    window.addEventListener("pointerup", () => finish(true), {
      signal: controller.signal,
      once: true,
    });
    window.addEventListener("pointercancel", () => finish(false), {
      signal: controller.signal,
      once: true,
    });
    window.addEventListener("blur", () => finish(false), {
      signal: controller.signal,
      once: true,
    });
    window.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          finish(false);
        }
      },
      { signal: controller.signal, capture: true },
    );
  }
}
