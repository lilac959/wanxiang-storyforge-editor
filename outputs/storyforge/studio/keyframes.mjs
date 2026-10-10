export const KEYFRAME_PROPERTIES = {
  position: { label: "位置", keys: ["x", "y"] },
  scale: { label: "大小", keys: ["scale"] },
  stretchX: { label: "横向拉伸", keys: ["stretchX"] },
  stretchY: { label: "纵向拉伸", keys: ["stretchY"] },
};
export const EASINGS = {
  linear: "匀速",
  easeIn: "缓入",
  easeOut: "缓出",
  easeInOut: "缓入缓出",
};
export function localTime(event, item, time) {
  return Math.round(
    Math.max(0, Math.min(event.endMs - event.startMs, time - event.startMs)) +
      (item.keyframeOffsetMs || 0),
  );
}
export function eased(t, mode) {
  if (mode === "easeIn") return t * t;
  if (mode === "easeOut") return 1 - (1 - t) ** 2;
  if (mode === "easeInOut")
    return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return t;
}
export function sampleKeyframes(item, at) {
  const result = { ...item };
  for (const [property, frames] of Object.entries(item.keyframes || {})) {
    const spec = KEYFRAME_PROPERTIES[property];
    if (!spec || !Array.isArray(frames) || !frames.length) continue;
    const right = frames.findIndex((f) => f.timeMs > at);
    const a =
      right === 0 ? frames[0] : right < 0 ? frames.at(-1) : frames[right - 1];
    const b = right <= 0 ? a : frames[right];
    const t =
      a === b ? 0 : eased((at - a.timeMs) / (b.timeMs - a.timeMs), a.easing);
    for (const key of spec.keys)
      result[key] = a.values[key] + (b.values[key] - a.values[key]) * t;
  }
  return result;
}
export function eventTransform(event, item, time) {
  return sampleKeyframes(item, localTime(event, item, time));
}
export function putKeyframe(
  item,
  property,
  at,
  values = sampleKeyframes(item, at),
) {
  const spec = KEYFRAME_PROPERTIES[property];
  if (!spec) throw Error("不支持的关键帧属性");
  item.keyframes ||= {};
  const frames = (item.keyframes[property] ||= []);
  let frame = frames.find((f) => f.timeMs === at);
  if (!frame) {
    frame = {
      id: `kf-${crypto.randomUUID()}`,
      timeMs: at,
      easing: "linear",
      values: {},
    };
    frames.push(frame);
    frames.sort((a, b) => a.timeMs - b.timeMs);
  }
  for (const key of spec.keys) frame.values[key] = values[key] ?? 100;
  return frame;
}
export function writeTransform(event, item, time, patch) {
  const at = localTime(event, item, time);
  const evaluated = sampleKeyframes(item, at);
  for (const [property, spec] of Object.entries(KEYFRAME_PROPERTIES)) {
    if (!spec.keys.some((key) => Object.hasOwn(patch, key))) continue;
    if (item.keyframes?.[property]?.length)
      putKeyframe(item, property, at, { ...evaluated, ...patch });
    else
      for (const key of spec.keys)
        if (Object.hasOwn(patch, key)) item[key] = patch[key];
  }
}
export function removeKeyframe(item, property, id) {
  const frames = item.keyframes?.[property];
  if (!frames) return;
  const removed = frames.find((f) => f.id === id);
  item.keyframes[property] = frames.filter((f) => f.id !== id);
  if (!item.keyframes[property].length) {
    // Removing the last keyframe leaves the element at its last authored value.
    Object.assign(item, removed?.values);
    delete item.keyframes[property];
  }
}
export function shiftKeyframeOrigin(event, delta) {
  for (const item of [event, ...(event.options || [])])
    if (Object.keys(item.keyframes || {}).length) {
      const offset = (item.keyframeOffsetMs || 0) + delta;
      if (offset < 0) {
        for (const frames of Object.values(item.keyframes))
          for (const frame of frames) frame.timeMs -= offset;
        item.keyframeOffsetMs = 0;
      } else item.keyframeOffsetMs = offset;
    }
}
export function retimeKeyframes(event, ratio) {
  for (const item of [event, ...(event.options || [])]) {
    if (item.keyframeOffsetMs != null)
      item.keyframeOffsetMs = Math.round(item.keyframeOffsetMs * ratio);
    for (const frames of Object.values(item.keyframes || {})) {
      for (const frame of frames)
        frame.timeMs = Math.round(frame.timeMs * ratio);
      // At extreme retiming, retain the latest value if two frames land together.
      for (let i = frames.length - 2; i >= 0; i--)
        if (frames[i].timeMs === frames[i + 1].timeMs) frames.splice(i, 1);
    }
  }
}
export function keyframeError(item, option = false) {
  if (!item || typeof item !== "object") return "关键帧结构无效";
  if (
    item.keyframeOffsetMs != null &&
    !Number.isSafeInteger(item.keyframeOffsetMs)
  )
    return "关键帧时间偏移无效";
  if (item.keyframes == null) return null;
  if (typeof item.keyframes !== "object" || Array.isArray(item.keyframes))
    return "关键帧结构无效";
  const ids = new Set();
  for (const [property, frames] of Object.entries(item.keyframes)) {
    const spec = KEYFRAME_PROPERTIES[property];
    if (!spec || !Array.isArray(frames)) return "关键帧属性无效";
    let previous = -Infinity;
    for (const frame of frames) {
      if (
        !frame ||
        typeof frame.id !== "string" ||
        ids.has(frame.id) ||
        !Number.isSafeInteger(frame.timeMs) ||
        frame.timeMs < 0 ||
        frame.timeMs <= previous ||
        !Object.hasOwn(EASINGS, frame.easing)
      )
        return "关键帧时间或曲线无效";
      ids.add(frame.id);
      previous = frame.timeMs;
      for (const key of spec.keys) {
        const value = frame.values?.[key];
        const [min, max] =
          key === "x" || key === "y"
            ? [option ? -100 : 0, 100]
            : key === "scale"
              ? [5, 180]
              : [5, 400];
        if (!Number.isFinite(value) || value < min || value > max)
          return "关键帧位置或尺寸无效";
      }
    }
  }
  return null;
}
// The clip displays one diamond per time, even when several properties coincide.
export function keyframePoints(event) {
  const points = new Map();
  for (const item of [event, ...(event.options || [])]) {
    for (const [property, frames] of Object.entries(item.keyframes || {})) {
      for (const frame of frames) {
        const timeMs = frame.timeMs - (item.keyframeOffsetMs || 0);
        if (timeMs < 0 || timeMs > event.endMs - event.startMs) continue;
        if (!points.has(timeMs)) points.set(timeMs, { timeMs, refs: [] });
        points
          .get(timeMs)
          .refs.push({
            optionId: item === event ? "" : item.id,
            property,
            id: frame.id,
          });
      }
    }
  }
  return [...points.values()].sort((a, b) => a.timeMs - b.timeMs);
}
export function moveKeyframePoint(event, refs, relativeTime) {
  if (
    !Number.isSafeInteger(relativeTime) ||
    relativeTime < 0 ||
    relativeTime > event.endMs - event.startMs
  )
    throw Error("关键帧超出互动范围");
  const updates = refs.map((ref) => {
    const item = ref.optionId
      ? event.options.find((o) => o.id === ref.optionId)
      : event;
    const frames = item?.keyframes?.[ref.property],
      frame = frames?.find((f) => f.id === ref.id);
    if (!frame) throw Error("关键帧已不存在");
    const at = relativeTime + (item.keyframeOffsetMs || 0);
    if (frames.some((f) => f !== frame && f.timeMs === at))
      throw Error("此时间已有关键帧");
    return { frames, frame, at };
  });
  for (const { frames, frame, at } of updates) {
    frame.timeMs = at;
    frames.sort((a, b) => a.timeMs - b.timeMs);
  }
}
