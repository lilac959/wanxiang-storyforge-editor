import {
  ensureSequence,
  visualClips,
  clipLength,
  linked,
} from "./timeline.mjs";
const keys = ["events", "subtitles", "audio", "effects", "overlays"];
export function timelineEntries(scene) {
  return [
    ...visualClips(scene).map((item) => ({
      key: "clips",
      item,
      start: item.startMs,
      end: item.startMs + clipLength(item),
    })),
    ...keys.flatMap((key) =>
      (scene[key] || []).map((item) => ({
        key,
        item,
        start: item.startMs,
        end: item.endMs,
      })),
    ),
  ];
}
export function moveSelection(scene, ids, delta) {
  const selected = new Set(ids);
  ensureSequence(scene);
  const entries = timelineEntries(scene).filter((x) => selected.has(x.item.id));
  if (!entries.length) return;
  delta = Math.max(
    Math.round(delta),
    -Math.min(...entries.map((x) => x.start)),
  );
  const moving = entries.filter((x) => x.key === "clips");
  for (const x of moving) {
    if (
      scene.clips.some(
        (other) =>
          !selected.has(other.id) &&
          x.start + delta < other.startMs + clipLength(other) &&
          x.end + delta > other.startMs,
      )
    )
      throw Error("选中的主画面与其他片段重叠，请移动到空位");
  }
  const shifted = new Set();
  for (const x of entries) {
    if (shifted.has(x.item.id)) continue;
    x.item.startMs += delta;
    if (x.key !== "clips") x.item.endMs += delta;
    shifted.add(x.item.id);
    if (x.key === "clips")
      for (const child of linked(scene, x.item.id)) {
        if (shifted.has(child.id)) continue;
        child.startMs += delta;
        child.endMs += delta;
        shifted.add(child.id);
      }
  }
  scene.clips.sort((a, b) => a.startMs - b.startMs);
}
export function copySelection(scene, ids) {
  const selected = new Set(ids);
  const entries = timelineEntries(scene).filter((x) => selected.has(x.item.id));
  if (
    !entries.length ||
    entries.some((x) => !Number.isFinite(x.start) || !Number.isFinite(x.end))
  )
    throw Error("请选择时间有效的片段");
  const origin = Math.min(...entries.map((x) => x.start));
  return structuredClone({ origin, entries });
}
export function pasteSelection(scene, clipboard, at, newId) {
  ensureSequence(scene);
  const entries = structuredClone(clipboard.entries);
  const delta = Math.max(0, Math.round(at)) - clipboard.origin;
  const idMap = new Map(entries.map((x) => [x.item.id, newId()]));
  const main = entries.filter((x) => x.key === "clips");
  if (main.length) {
    const end = Math.max(...main.map((x) => x.end + delta));
    const beginning = Math.min(...main.map((x) => x.start + delta));
    if (
      scene.clips.some(
        (x) => x.startMs < beginning && x.startMs + clipLength(x) > beginning,
      )
    )
      throw Error("请将播放头放在主画面片段边缘或空位后粘贴");
    const next = scene.clips
      .filter((x) => x.startMs >= beginning)
      .sort((a, b) => a.startMs - b.startMs)[0];
    const shift = next ? Math.max(0, end - next.startMs) : 0;
    const boundary = next?.startMs;
    if (shift)
      for (const x of timelineEntries(scene))
        if (x.start >= boundary) {
          x.item.startMs += shift;
          if (x.key !== "clips") x.item.endMs += shift;
        }
  }
  for (const x of entries) {
    const original = x.item.id;
    x.item.id = idMap.get(original);
    x.item.startMs = x.start + delta;
    if (x.key !== "clips") x.item.endMs = x.end + delta;
    if (x.item.linkedClipId) {
      if (idMap.has(x.item.linkedClipId))
        x.item.linkedClipId = idMap.get(x.item.linkedClipId);
      else delete x.item.linkedClipId;
    }
    x.item.options?.forEach((o) => (o.id = newId()));
    scene[x.key] ||= [];
    scene[x.key].push(x.item);
  }
  scene.clips.sort((a, b) => a.startMs - b.startMs);
  return entries;
}
