// Stable tracks are project data. Preview visibility and editing locks are not.
const collections = {
  subtitle: "subtitles",
  overlay: "overlays",
  audio: "audio",
  event: "events",
};
export function trackRows(scene) {
  const rows = (Array.isArray(scene.timelineTracks) ? scene.timelineTracks : [])
    .filter(
      (t) =>
        t &&
        typeof t.id === "string" &&
        ["visual", "audio", "event"].includes(t.kind),
    )
    .map((t) => ({ ...t, items: [] }));
  for (const [kind, key] of Object.entries(collections)) {
    for (const item of scene[key] || []) {
      const family =
        kind === "subtitle" || kind === "overlay" ? "visual" : kind;
      let row = rows.find((t) => t.id === item.trackId && t.kind === family);
      if (!row && !item.trackId) {
        const candidate = rows.find(
          (t) =>
            t.kind === family &&
            t.items.length &&
            t.items.every((x) => x.itemKind === kind),
        );
        // Reuse only the top matching lane: using a lower free lane would
        // incorrectly put a later legacy overlay behind an earlier one.
        if (
          candidate?.items.every(
            (x) => !(item.startMs < x.endMs && item.endMs > x.startMs),
          )
        )
          row = candidate;
      }
      if (
        row?.items.some((x) => item.startMs < x.endMs && item.endMs > x.startMs)
      )
        row = null;
      if (!row) {
        // Legacy materials retain their old stacking: subtitles above images;
        // later items in a collection above earlier items. No time-based repacking.
        row = {
          id: `${kind}:${item.id}`,
          kind: family,
          name:
            kind === "subtitle"
              ? "字幕"
              : kind === "overlay"
                ? "叠加"
                : kind === "audio"
                  ? "音频"
                  : "互动",
          items: [],
        };
        rows.unshift(row);
      }
      row.items.push({ ...item, itemKind: kind });
    }
  }
  const visual = rows.filter((r) => r.kind === "visual");
  // Unassigned old subtitles must remain above old overlays.
  if (!scene.timelineTracks?.length)
    visual.sort(
      (a, b) =>
        (a.items[0]?.itemKind === "subtitle" ? 0 : 1) -
        (b.items[0]?.itemKind === "subtitle" ? 0 : 1),
    );
  return [
    ...rows.filter((r) => r.kind === "event"),
    ...visual,
    ...rows.filter((r) => r.kind === "audio"),
  ].filter((r) => r.items.length);
}
export function materializeTracks(scene) {
  const rows = trackRows(scene);
  scene.timelineTracks = rows.map(({ items, ...row }) => row);
  for (const row of rows)
    for (const item of row.items) {
      const original = scene[collections[item.itemKind]].find(
        (x) => x.id === item.id,
      );
      original.trackId = row.id;
    }
  return scene.timelineTracks;
}
export function assignTrack(scene, kind, item, preferredId) {
  const family = kind === "subtitle" || kind === "overlay" ? "visual" : kind;
  const tracks = materializeTracks(scene);
  const effectiveId = preferredId || item.trackId;
  const row = trackRows(scene).find(
    (r) => r.id === effectiveId && r.kind === family,
  );
  const overlaps = row?.items.some(
    (x) => x.id !== item.id && item.startMs < x.endMs && item.endMs > x.startMs,
  );
  if (row && !overlaps) item.trackId = row.id;
  else {
    const track = {
      id: `track-${crypto.randomUUID()}`,
      kind: family,
      name:
        kind === "subtitle"
          ? "字幕"
          : kind === "overlay"
            ? "叠加"
            : kind === "audio"
              ? "音频"
              : "互动",
    };
    const index = preferredId
      ? tracks.findIndex((r) => r.id === preferredId)
      : 0;
    tracks.splice(Math.max(0, index), 0, track);
    item.trackId = track.id;
  }
  return item.trackId;
}
export function reorderTrack(scene, trackId, step) {
  const rows = materializeTracks(scene),
    i = rows.findIndex((r) => r.id === trackId);
  if (i < 0) return;
  const same = rows.filter((r) => r.kind === rows[i].kind),
    j = same.findIndex((r) => r.id === trackId) + step;
  if (!same[j]) return;
  const target = rows.findIndex((r) => r.id === same[j].id);
  [rows[i], rows[target]] = [rows[target], rows[i]];
}
export function visualLayer(scene, item) {
  const rows = trackRows(scene).filter((r) => r.kind === "visual"),
    index = rows.findIndex((r) => r.items.some((x) => x.id === item.id));
  return index < 0 ? 2 : rows.length - index + 2;
}
export function itemTrackId(scene, item, kind) {
  return (
    trackRows(scene).find((r) => r.items.some((x) => x.id === item.id))?.id ||
    `${kind}:${item.id}`
  );
}
export function interactionConflicts(scene) {
  const conflicts = [],
    events = scene.events || [];
  for (let i = 0; i < events.length; i++)
    for (let j = 0; j < i; j++) {
      const a = events[i],
        b = events[j],
        start = Math.max(a.startMs, b.startMs),
        end = Math.min(a.endMs, b.endMs);
      if (Number.isFinite(start) && (start < end || a.startMs === b.startMs))
        conflicts.push({ a, b, start, end: Math.max(start + 100, end) });
    }
  return conflicts;
}
