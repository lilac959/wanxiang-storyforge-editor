import { timelineEntries } from "./timeline-selection.mjs";
import {
  ensureSequence,
  splitClip,
  clipLength,
  sourceTime,
} from "./timeline.mjs";
import { splitRange, setMediaSpeed } from "./media-editing.mjs";

export const SHORTCUTS = [
  ["删除选中片段", "Backspace"],
  ["分割片段", "C"],
  ["批量分割", "Ctrl + Shift + B"],
  ["向右裁剪", "W"],
  ["选择工具", "A"],
  ["向左全选", "["],
  ["向右全选", "]"],
  ["主轨磁吸开关", "P"],
  ["吸附开关", "N"],
  ["联动开关", "~"],
  ["放大／缩小时间轴", "+ / -"],
  ["显示完整时间轴", "Shift + Z"],
  ["上一帧／下一帧", "← / →"],
  ["跳到首帧／尾帧", "Home / End"],
  ["添加标记", "M"],
  ["分离／还原音频", "Ctrl + Shift + S"],
  ["启用／停用片段", "B"],
  ["撤销", "Ctrl + Z"],
  ["重做", "Ctrl + Shift + Z"],
  ["复制／剪切／粘贴", "Ctrl + C / X / V"],
  ["复制／粘贴属性", "Ctrl + Shift + C / V"],
];
export function shortcutAction(e) {
  if (e.altKey || e.isComposing) return null;
  const key = e.key.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    if (e.shiftKey)
      return (
        {
          b: "split-all",
          s: "toggle-audio",
          c: "copy-properties",
          v: "paste-properties",
          z: "redo",
        }[key] || null
      );
    return (
      { z: "undo", c: "copy", x: "cut", v: "paste", a: "select-all" }[key] ||
      null
    );
  }
  if (e.shiftKey && key === "z") return "fit";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  if (key === "~" || key === "`") return "linkage";
  if (e.shiftKey) return null;
  return (
    {
      backspace: "delete",
      c: "split",
      w: "trim-right",
      a: "select",
      "[": "select-left",
      "]": "select-right",
      p: "magnet",
      n: "snap",
      arrowleft: "previous-frame",
      arrowright: "next-frame",
      home: "first",
      end: "last",
      m: "marker",
      b: "toggle-enabled",
    }[key] || null
  );
}
const rangeKinds = {
  events: "event",
  subtitles: "subtitle",
  audio: "audio",
  overlays: "overlay",
  effects: "effect",
};
export function splitAt(scene, at, ids, locked = new Set()) {
  ensureSequence(scene);
  const entries = timelineEntries(scene).filter(
    (x) =>
      (!ids || ids.has(x.item.id)) &&
      !locked.has(x.item.id) &&
      at - x.start >= 100 &&
      x.end - at >= 100,
  );
  if (!entries.length)
    throw Error("播放头两侧需各保留至少 0.1 秒，且轨道未锁定");
  return entries.map((x) =>
    x.key === "clips"
      ? splitClip(scene, x.item.id, at)
      : splitRange(scene, x.item, rangeKinds[x.key], at),
  );
}
export function trimRight(scene, ids, at) {
  const entries = timelineEntries(scene).filter((x) => ids.has(x.item.id));
  if (!entries.length || entries.some((x) => at - x.start < 100 || at >= x.end))
    throw Error("请将播放头放在选中片段内部，左侧至少保留 0.1 秒");
  for (const x of entries) {
    if (x.key === "clips") x.item.outMs = Math.round(sourceTime(x.item, at));
    else x.item.endMs = Math.round(at);
  }
}
export function packMain(scene) {
  let cursor = 0;
  for (const c of ensureSequence(scene).sort((a, b) => a.startMs - b.startMs)) {
    const delta = cursor - c.startMs;
    c.startMs = cursor;
    if (scene.editorTimeline?.linkage !== false)
      for (const x of timelineEntries(scene).filter(
        (x) => x.item.linkedClipId === c.id,
      )) {
        x.item.startMs += delta;
        x.item.endMs += delta;
      }
    cursor += clipLength(c);
  }
}
const properties = {
  clips: ["fit", "x", "y", "scale", "volume", "playbackRate", "enabled"],
  overlays: ["x", "y", "width", "height", "volume", "playbackRate", "enabled"],
  audio: ["volume", "fadeInMs", "fadeOutMs", "playbackRate", "enabled"],
  subtitles: [
    "color",
    "fontSize",
    "size",
    "background",
    "x",
    "y",
    "width",
    "height",
    "entryMotion",
    "enabled",
  ],
  events: [
    "x",
    "y",
    "scale",
    "stretchX",
    "stretchY",
    "entryMotion",
    "uiComponent",
    "sound",
    "volume",
    "enabled",
  ],
  effects: ["value", "enabled"],
};
export function copyProperties(scene, id) {
  const entry = timelineEntries(scene).find((x) => x.item.id === id);
  if (!entry) throw Error("请选择一个片段复制属性");
  return {
    key: entry.key,
    kind: entry.item.kind,
    values: Object.fromEntries(
      properties[entry.key].map((k) => [k, structuredClone(entry.item[k])]),
    ),
  };
}
export function pasteProperties(scene, ids, clipboard) {
  if (!clipboard) throw Error("请先复制属性");
  const targets = timelineEntries(scene).filter((x) => ids.has(x.item.id));
  if (
    !targets.length ||
    targets.some(
      (x) => x.key !== clipboard.key || x.item.kind !== clipboard.kind,
    )
  )
    throw Error("属性只能粘贴到相同类型的片段");
  for (const x of targets)
    for (const [k, v] of Object.entries(clipboard.values)) {
      if (
        k === "playbackRate" &&
        (x.key !== "clips" || x.item.kind === "video")
      ) {
        setMediaSpeed(
          scene,
          x.item,
          v ?? 1,
          { clips: "clip", audio: "audio", overlays: "overlay" }[x.key],
        );
        continue;
      }
      if (v === undefined) delete x.item[k];
      else x.item[k] = structuredClone(v);
    }
}
export function restoreAudio(scene, clip) {
  const matches = scene.audio.filter((a) => a.detachedFrom === clip.id);
  scene.audio = scene.audio.filter((a) => a.detachedFrom !== clip.id);
  clip.audioDetached = false;
  return matches;
}
