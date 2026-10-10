import { duration } from "./model.mjs";
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

// Restore invalid legacy intervals from source metadata and type defaults.
// Existing valid placement and trims are preserved. Callers back up before applying.
export function repairTimelineData(project) {
  let count = 0;
  const put = (x, key, value) => {
    if (x[key] !== value) {
      x[key] = value;
      count++;
    }
  };
  const positive = (x) => Number.isSafeInteger(x) && x >= 100;
  for (const scene of project.scenes) {
    const entries = [
      ...(scene.clips || []),
      ...(scene.images || []),
      ...(scene.video ? [scene.video] : []),
      ...collections.flatMap((k) => scene[k] || []),
    ];
    for (const x of entries) {
      for (const key of [
        "startMs",
        "endMs",
        "inMs",
        "outMs",
        "durationMs",
        "timeoutMs",
      ])
        if (typeof x[key] === "string" && /^\d+(\.\d+)?$/.test(x[key].trim()))
          put(x, key, Math.round(Number(x[key])));
    }
    let cursor = 0;
    for (const x of scene.source === "sequence"
      ? scene.clips || []
      : scene.video
        ? [scene.video]
        : []) {
      const asset = project.assets[x.assetId];
      if (!validTime(x.startMs)) put(x, "startMs", cursor);
      if (!validTime(x.inMs)) put(x, "inMs", 0);
      if (!positive(x.outMs - x.inMs)) {
        const end =
          asset?.kind === "image" || x.kind === "image"
            ? x.inMs + 3000
            : asset?.durationMs;
        if (positive(end - x.inMs)) put(x, "outMs", end);
      }
      if (positive(clipLength(x)))
        cursor = Math.max(cursor, x.startMs + clipLength(x));
    }
    for (const x of scene.images || [])
      if (!positive(x.durationMs)) put(x, "durationMs", 3000);
    const sceneEnd = duration(scene);
    for (const key of collections)
      for (const x of scene[key] || []) {
        const parent = (scene.clips || []).find((c) => c.id === x.linkedClipId);
        if (!validTime(x.startMs)) put(x, "startMs", parent?.startMs ?? 0);
        if (positive(x.endMs - x.startMs)) continue;
        // A waiting/clock interaction exactly at the last frame is an intentional cue.
        if (
          key === "events" &&
          x.startMs === sceneEnd &&
          x.endMs === sceneEnd &&
          ["clock", "wait"].includes(x.endMode)
        )
          continue;
        let length;
        const asset = project.assets[x.assetId];
        if (key === "audio" || key === "overlays") {
          if (!validTime(x.inMs)) put(x, "inMs", 0);
          length =
            asset?.kind === "image"
              ? 3000
              : Math.round((asset?.durationMs - x.inMs) / mediaRate(x));
        } else if (key === "events") {
          length = positive(x.timeoutMs) ? x.timeoutMs : 4000;
        } else length = 2000;
        if (positive(length)) {
          if (!["audio", "overlays"].includes(key)) {
            if (x.startMs >= sceneEnd)
              put(x, "startMs", Math.max(0, sceneEnd - 100));
            length = Math.min(length, sceneEnd - x.startMs);
          }
          if (positive(length)) put(x, "endMs", x.startMs + length);
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
