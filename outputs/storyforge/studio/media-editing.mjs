import {
  ensureSequence,
  clipLength,
  mediaRate,
  linked,
  splitClip,
} from "./timeline.mjs";

const validTime = (x) => Number.isSafeInteger(x) && x >= 0;
const collections = ["events", "subtitles", "audio", "effects", "overlays"];
export function setMediaSpeed(scene, item, rate, kind = "clip") {
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4)
    throw Error("倍速范围为 0.25×～4×");
  const oldRate = mediaRate(item),
    start = item.startMs || 0;
  const oldLength = kind === "clip" ? clipLength(item) : item.endMs - start;
  if (!Number.isFinite(oldLength) || oldLength < 100)
    throw Error("请先补全此片段的时间");
  if (
    scene.effects?.some(
      (e) =>
        e.kind === "speed" && e.startMs < start + oldLength && e.endMs > start,
    )
  )
    throw Error("此处仍有旧版慢放区间，请先处理该区间再设置视频变速");
  const length = Math.round((oldLength * oldRate) / rate);
  if (length < 100) throw Error("变速后片段不能短于 0.1 秒");
  item.playbackRate = rate;
  if (kind !== "clip") {
    item.endMs = start + length;
    return;
  }
  const ratio = oldRate / rate,
    delta = length - oldLength;
  for (const x of linked(scene, item.id)) {
    x.startMs = Math.round(start + (x.startMs - start) * ratio);
    x.endMs = Math.round(start + (x.endMs - start) * ratio);
  }
  for (const clip of ensureSequence(scene)) {
    if (clip === item || clip.startMs < start + oldLength) continue;
    clip.startMs += delta;
    for (const x of linked(scene, clip.id)) {
      x.startMs += delta;
      x.endMs += delta;
    }
  }
}

export function separateAudio(scene, clip) {
  if (!clip || clip.kind !== "video") throw Error("请选择视频片段");
  if (clip.audioDetached) throw Error("此片段的音频已分离");
  if (
    !validTime(clip.startMs) ||
    !validTime(clip.inMs) ||
    !(clipLength(clip) >= 100)
  )
    throw Error("请先补全此视频的时间");
  const audio = {
    id: `audio-${crypto.randomUUID()}`,
    assetId: clip.assetId,
    startMs: clip.startMs,
    endMs: clip.startMs + clipLength(clip),
    inMs: clip.inMs,
    playbackRate: mediaRate(clip),
    volume: clip.volume ?? 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    detachedFrom: clip.id,
  };
  scene.audio ||= [];
  scene.audio.push(audio);
  clip.audioDetached = true;
  return audio;
}

export function splitRange(scene, item, kind, time) {
  const key = { audio: "audio", subtitle: "subtitles", overlay: "overlays" }[
    kind
  ];
  if (!key || time - item.startMs < 100 || item.endMs - time < 100)
    throw Error("请将播放指针放在片段内部");
  const right = structuredClone(item);
  right.id = `${kind}-${crypto.randomUUID()}`;
  right.startMs = Math.round(time);
  if (kind !== "subtitle")
    right.inMs = Math.round(
      (item.inMs || 0) + (time - item.startMs) * mediaRate(item),
    );
  item.endMs = right.startMs;
  scene[key].push(right);
  return right;
}

// Recover only explicit numeric values and an untrimmed video's missing end.
// Null placement, creative trim points and interaction intervals stay unresolved.
export function repairTimelineData(project) {
  let count = 0;
  for (const scene of project.scenes) {
    const entries = [
      ...(scene.clips || []),
      ...(scene.images || []),
      ...(scene.video ? [scene.video] : []),
      ...collections.flatMap((k) => scene[k] || []),
    ];
    for (const x of entries) {
      for (const key of ["startMs", "endMs", "inMs", "outMs", "durationMs"]) {
        if (typeof x[key] === "string" && /^\d+(\.\d+)?$/.test(x[key].trim())) {
          x[key] = Math.round(Number(x[key]));
          count++;
        }
      }
      const a = project.assets[x.assetId];
      if (
        (x.kind === "video" || x === scene.video) &&
        x.inMs === 0 &&
        x.outMs == null &&
        Number.isSafeInteger(a?.durationMs) &&
        a.durationMs > 0
      ) {
        x.outMs = a.durationMs;
        count++;
      }
    }
  }
  return count;
}

// Only migrate a single unambiguous video interval; keep all other legacy effects.
export function migrateLegacySpeed(project) {
  let count = 0;
  for (const scene of project.scenes) {
    const effects = (scene.effects || []).filter((e) => e.kind === "speed");
    if (effects.length !== 1 || scene.audio?.length || scene.overlays?.length)
      continue;
    const e = effects[0],
      clips = scene.source === "sequence" ? scene.clips : [];
    const c = clips.find(
      (c) =>
        c.kind === "video" &&
        mediaRate(c) === 1 &&
        e.startMs >= c.startMs &&
        e.endMs <= c.startMs + clipLength(c),
    );
    if (
      !c ||
      !validTime(e.startMs) ||
      !validTime(e.endMs) ||
      e.endMs <= e.startMs ||
      !Number.isFinite(e.value) ||
      e.value < 0.25 ||
      e.value > 4
    )
      continue;
    const end = c.startMs + clipLength(c);
    if (
      (e.startMs > c.startMs && e.startMs - c.startMs < 100) ||
      (e.endMs < end && end - e.endMs < 100) ||
      e.endMs - e.startMs < 100
    )
      continue;
    const before = structuredClone(scene);
    try {
      let part = c;
      if (e.startMs > c.startMs) part = splitClip(scene, c.id, e.startMs);
      if (e.endMs < end) splitClip(scene, part.id, e.endMs);
      const delta =
        Math.round((e.endMs - e.startMs) / e.value) - (e.endMs - e.startMs);
      const map = (t) =>
        Math.round(
          t <= e.startMs
            ? t
            : t < e.endMs
              ? e.startMs + (t - e.startMs) / e.value
              : t + delta,
        );
      part.playbackRate = e.value;
      for (const x of scene.clips)
        if (x.startMs >= e.endMs) x.startMs = map(x.startMs);
      for (const key of collections)
        for (const x of scene[key] || []) {
          if (x === e) continue;
          x.startMs = map(x.startMs);
          x.endMs = map(x.endMs);
        }
      for (const marker of scene.markers || [])
        marker.timeMs = map(marker.timeMs);
      scene.effects = scene.effects.filter((x) => x !== e);
      count++;
    } catch {
      Object.assign(scene, before);
    }
  }
  return count;
}
