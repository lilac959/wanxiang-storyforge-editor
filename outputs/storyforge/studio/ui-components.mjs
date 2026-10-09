import { newEvent, newProject } from "./model.mjs";

// Versioned, trusted code components. Media uploads remain media, never executable code.
export const UI_COMPONENTS = [
  {
    id: "classic-choice@1",
    name: "经典金框选项",
    kind: "choice",
    preset: "classic",
    symbol: "△  选择  ○",
  },
  {
    id: "ring-hold@1",
    name: "长按进度环",
    kind: "qte",
    gesture: "hold",
    symbol: "◉",
    hint: "按住完成",
  },
  {
    id: "ring-click@1",
    name: "点击提示",
    kind: "qte",
    gesture: "click",
    symbol: "⊕",
    hint: "点击",
  },
  {
    id: "ring-multi@1",
    name: "连点提示",
    kind: "qte",
    gesture: "multi",
    symbol: "⊕ ×5",
    hint: "连续点击",
  },
  {
    id: "ring-swipe@1",
    name: "向右滑动提示",
    kind: "qte",
    gesture: "right",
    symbol: "→",
    hint: "向右滑动",
  },
  ...[
    ["up", "上", "↑"],
    ["down", "下", "↓"],
    ["left", "左", "←"],
  ].map(([gesture, direction, symbol]) => ({
    id: `ring-swipe-${gesture}@1`,
    name: `向${direction}滑动提示`,
    kind: "qte",
    gesture,
    symbol,
    hint: `向${direction}滑动`,
  })),
  {
    id: "hotspot@1",
    name: "点击热点",
    kind: "hotspot",
    symbol: "＋",
    hint: "点击探索",
  },
];
export function componentEvent(id, at = 0) {
  const c = UI_COMPONENTS.find((c) => c.id === id);
  if (!c) throw Error("找不到互动 UI 版本");
  const e = newEvent(at, c.kind, 5000);
  e.uiComponent = c.id;
  e.uiPreset = c.preset || "classic";
  e.gesture = c.gesture || e.gesture;
  e.hint = c.hint || "";
  return e;
}
export function componentDemo(id) {
  const p = newProject("互动 UI 预览");
  p.theme = { preset: "classic", accent: "#e5d6b1", text: "#f8f0e4" };
  p.scenes[0].durationMs = 30000;
  const e = componentEvent(id, 300);
  e.endMs = 15300;
  e.timeoutMs = 15000;
  e.endMode = "wait";
  e.pause = true;
  e.x = 50;
  e.y = 50;
  p.scenes[0].events = [e];
  return p;
}

export const GESTURE_PATHS = {
  right: "M50 50 H79 M70 41 L79 50 L70 59",
  left: "M50 50 H21 M30 41 L21 50 L30 59",
  up: "M50 50 V21 M41 30 L50 21 L59 30",
  down: "M50 50 V79 M41 70 L50 79 L59 70",
  multi: "M43 50 H57 M50 43 V57",
  click: "M43 50 H57 M50 43 V57",
  hold: "M44 55 V43 Q44 38 48 40 V33 Q48 28 52 31 V43 Q57 37 59 43 L60 56 Q57 65 49 64 L39 53 Q36 47 41 48 Z",
};
export function componentThumbnail(c) {
  if (c.kind === "choice")
    return '<span class="legacy-choice-thumb"><img alt="" src="assets/ui/option-triangle.png"><span>选项</span></span>';
  return `<span class="legacy-qte-thumb"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="34"/><path d="${GESTURE_PATHS[c.gesture] || GESTURE_PATHS.click}"/></svg></span>`;
}
