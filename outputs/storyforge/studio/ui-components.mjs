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
    id: "simple-choice@1",
    name: "简洁选项",
    kind: "choice",
    preset: "simple",
    symbol: "选择一　选择二",
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
    name: "滑动提示",
    kind: "qte",
    gesture: "right",
    symbol: "→",
    hint: "向右滑动",
  },
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
