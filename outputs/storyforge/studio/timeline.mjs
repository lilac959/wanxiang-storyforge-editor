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

// Insert at a visible boundary, pushing later material without overwriting it.
export function insertionPoint(scene, at) {
  at = Math.max(0, Math.round(at));
  const c = visualClips(scene).find(
    (c) => at > c.startMs && at < c.startMs + clipLength(c),
  );
  if (c)
    return at < c.startMs + clipLength(c) / 2
      ? c.startMs
      : c.startMs + clipLength(c);
  return at;
}
export function insertVisual(scene, asset, at) {
  const clips = ensureSequence(scene);
  at = insertionPoint(scene, at);
  const length = asset.kind === "image" ? 3000 : asset.durationMs;
  if (!Number.isFinite(length) || length < 100)
    throw Error("素材时长无效，请重新读取素材");
  const next = clips
    .filter((c) => c.startMs >= at)
    .sort((a, b) => a.startMs - b.startMs)[0];
  const shift = next ? Math.max(0, at + length - next.startMs) : 0;
  if (shift) {
    const boundary = next.startMs;
    for (const c of clips) if (c.startMs >= boundary) c.startMs += shift;
    for (const key of ["events", "subtitles", "audio", "effects", "overlays"])
      for (const x of scene[key] || []) {
        if (x.startMs >= boundary) {
          x.startMs += shift;
          x.endMs += shift;
        } else if (x.endMs > boundary) x.endMs += shift;
      }
  }
  const clip = {
    id: id(),
    assetId: asset.id,
    kind: asset.kind,
    startMs: at,
    inMs: 0,
    outMs: length,
  };
  clips.push(clip);
  clips.sort((a, b) => a.startMs - b.startMs);
  return clip;
}
export function moveVisual(scene, cid, at) {
  const clips = ensureSequence(scene),
    c = clips.find((c) => c.id === cid);
  if (!c) return;
  at = Math.max(0, Math.round(at));
  if (
    !clips.some(
      (x) =>
        x !== c &&
        at < x.startMs + clipLength(x) &&
        at + clipLength(c) > x.startMs,
    )
  ) {
    moveClip(scene, cid, at);
    return;
  }
  const others = clips
    .filter((x) => x !== c)
    .sort((a, b) => a.startMs - b.startMs);
  const index = others.findIndex((x) => at < x.startMs + clipLength(x) / 2);
  others.splice(index < 0 ? others.length : index, 0, c);
  const old = new Map(clips.map((x) => [x.id, x.startMs]));
  let cursor = 0;
  for (const x of others) {
    const delta = cursor - old.get(x.id);
    x.startMs = cursor;
    for (const child of linked(scene, x.id)) {
      child.startMs += delta;
      child.endMs += delta;
    }
    cursor += clipLength(x);
  }
  scene.clips = others;
}
export function trimVisual(scene, cid, edge, delta, sourceDuration = 7200000) {
  const clips = ensureSequence(scene),
    c = clips.find((c) => c.id === cid);
  if (!c) return;
  if (edge === "left") {
    const previous = Math.max(
      0,
      ...clips
        .filter((x) => x !== c && x.startMs < c.startMs)
        .map((x) => x.startMs + clipLength(x)),
    );
    const change = Math.max(
      previous - c.startMs,
      -c.inMs,
      Math.min(delta, clipLength(c) - 100),
    );
    c.startMs += change;
    c.inMs += change;
  } else {
    const next = Math.min(
      Infinity,
      ...clips
        .filter((x) => x !== c && x.startMs > c.startMs)
        .map((x) => x.startMs),
    );
    c.outMs = Math.max(
      c.inMs + 100,
      Math.min(c.outMs + delta, sourceDuration, c.inMs + next - c.startMs),
    );
  }
}
