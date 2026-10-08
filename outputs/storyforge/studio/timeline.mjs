// Timeline operations shared by the editor and player. Times are integer milliseconds.
const id = () => `clip-${crypto.randomUUID()}`;
export const clipLength = (c) => c.outMs - c.inMs;
export function visualClips(s) {
  if (s.source === "sequence") return s.clips || [];
  if (s.source === "video")
    return s.video ? [{ ...s.video, kind: "video", startMs: 0 }] : [];
  let startMs = 0;
  return s.images.map((f) => {
    const c = {
      id: f.id,
      assetId: f.assetId,
      kind: "image",
      startMs,
      inMs: 0,
      outMs: f.durationMs,
    };
    startMs += f.durationMs;
    return c;
  });
}
export function mediaAt(s, time) {
  const clips = visualClips(s),
    end = Math.max(0, ...clips.map((c) => c.startMs + clipLength(c)));
  return (
    clips.find((c) => time >= c.startMs && time < c.startMs + clipLength(c)) ||
    (time === end ? clips.find((c) => c.startMs + clipLength(c) === end) : null)
  );
}
export function ensureSequence(s) {
  if (s.source !== "sequence") {
    s.clips = visualClips(s);
    s.source = "sequence";
    s.video = null;
    s.images = [];
  }
  return s.clips;
}
export function appendVisual(s, a) {
  const clips = ensureSequence(s),
    startMs = Math.max(0, ...clips.map((c) => c.startMs + clipLength(c)));
  const c = {
    id: id(),
    assetId: a.id,
    kind: a.kind,
    startMs,
    inMs: 0,
    outMs: a.kind === "image" ? 3000 : a.durationMs,
  };
  clips.push(c);
  return c;
}
export function linked(s, cid) {
  return ["events", "subtitles", "audio", "effects", "overlays"].flatMap((k) =>
    (s[k] || []).filter((x) => x.linkedClipId === cid),
  );
}
export function moveClip(s, cid, start) {
  const clips = ensureSequence(s),
    c = clips.find((x) => x.id === cid);
  if (!c) return;
  start = Math.max(0, Math.round(start));
  const end = start + clipLength(c);
  if (
    clips.some(
      (x) => x !== c && start < x.startMs + clipLength(x) && end > x.startMs,
    )
  )
    throw Error("主画面片段不能重叠，请放到空位或使用前移 / 后移排序");
  const delta = start - c.startMs;
  c.startMs = start;
  for (const x of linked(s, cid)) {
    x.startMs += delta;
    x.endMs += delta;
  }
  clips.sort((a, b) => a.startMs - b.startMs);
}
export function splitClip(s, cid, time) {
  const clips = ensureSequence(s),
    c = clips.find((x) => x.id === cid);
  if (!c) throw Error("请选择画面片段");
  const offset = Math.round(time) - c.startMs;
  if (offset < 100 || offset > clipLength(c) - 100)
    throw Error("请把播放头放在片段内部（两侧至少 0.1 秒）");
  const right = { ...c, id: id(), startMs: time, inMs: c.inMs + offset };
  c.outMs = right.inMs;
  clips.splice(clips.indexOf(c) + 1, 0, right);
  for (const x of linked(s, cid))
    if (x.startMs >= time) x.linkedClipId = right.id;
  return right;
}
export function reorderClip(s, cid, step) {
  const clips = ensureSequence(s).sort((a, b) => a.startMs - b.startMs),
    i = clips.findIndex((c) => c.id === cid),
    j = i + step;
  if (j < 0 || j >= clips.length) return;
  const old = new Map(clips.map((c) => [c.id, c.startMs]));
  clips.splice(j, 0, clips.splice(i, 1)[0]);
  let t = 0;
  for (const c of clips) {
    c.startMs = t;
    const delta = t - old.get(c.id);
    for (const x of linked(s, c.id)) {
      x.startMs += delta;
      x.endMs += delta;
    }
    t += clipLength(c);
  }
}
export function removeClip(s, cid, ripple = false, removeLinked = false) {
  const clips = ensureSequence(s),
    c = clips.find((x) => x.id === cid);
  if (!c) return;
  const end = c.startMs + clipLength(c),
    len = clipLength(c);
  s.clips = clips.filter((x) => x.id !== cid);
  for (const k of ["events", "subtitles", "audio", "effects", "overlays"]) {
    s[k] = (s[k] || []).filter((x) => !removeLinked || x.linkedClipId !== cid);
    for (const x of s[k]) {
      if (x.linkedClipId === cid) delete x.linkedClipId;
      if (ripple && x.startMs >= end) {
        x.startMs -= len;
        x.endMs -= len;
      }
    }
  }
  if (ripple) for (const x of s.clips) if (x.startMs >= end) x.startMs -= len;
}
export function duplicateClip(s, cid) {
  const clips = ensureSequence(s),
    c = clips.find((x) => x.id === cid);
  if (!c) throw Error("请选择画面片段");
  const copy = {
    ...c,
    id: id(),
    startMs: Math.max(...clips.map((x) => x.startMs + clipLength(x))),
  };
  clips.push(copy);
  for (const k of ["events", "subtitles", "audio", "effects", "overlays"])
    for (const x of [...(s[k] || [])])
      if (x.linkedClipId === cid) {
        const y = structuredClone(x);
        y.id = id();
        y.linkedClipId = copy.id;
        y.startMs += copy.startMs - c.startMs;
        y.endMs += copy.startMs - c.startMs;
        if (y.options) y.options.forEach((o) => (o.id = id()));
        s[k].push(y);
      }
  return copy;
}
