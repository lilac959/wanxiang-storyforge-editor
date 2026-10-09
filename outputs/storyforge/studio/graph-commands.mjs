import { clone, uid, targetsOf } from "./model.mjs";
export function copyScenes(project, ids) {
  const chosen = project.scenes.filter((s) => ids.includes(s.id)),
    sceneIds = new Map(chosen.map((s) => [s.id, uid("scene")]));
  const copies = chosen.map((s) => {
    const c = clone(s),
      map = new Map();
    function fresh(x) {
      if (!x || typeof x !== "object") return;
      if (x.id) {
        const next = uid("item");
        map.set(x.id, next);
        x.id = next;
      }
      Object.values(x).forEach((v) => {
        if (Array.isArray(v)) v.forEach(fresh);
        else if (v && typeof v === "object") fresh(v);
      });
    }
    fresh(c);
    c.id = sceneIds.get(s.id);
    c.name += " 副本";
    if (["loading", "splash"].includes(c.role)) {
      c.role = "story";
      if (c.savedRoutes) c.next = clone(c.savedRoutes.next);
      delete c.savedRoutes;
    }
    for (const k of ["events", "audio", "subtitles", "effects", "overlays"])
      for (const x of c[k] || [])
        if (x.linkedClipId)
          x.linkedClipId = map.get(x.linkedClipId) || x.linkedClipId;
    for (const t of targetsOf(c))
      if (t.kind === "scene") {
        if (sceneIds.has(t.sceneId)) t.sceneId = sceneIds.get(t.sceneId);
        else {
          t.kind = "unlinked";
          delete t.sceneId;
        }
      }
    project.editor.positions[c.id] = {
      x: (project.editor.positions[s.id]?.x || 60) + 48,
      y: (project.editor.positions[s.id]?.y || 60) + 60,
    };
    return c;
  });
  project.scenes.push(...copies);
  return copies;
}
export function deleteScenes(project, ids, newEntry) {
  const keep = project.scenes.filter((s) => !ids.includes(s.id));
  if (!keep.length) throw Error("至少保留一个场景");
  if (ids.includes(project.entryId)) {
    if (
      !keep.some(
        (s) => s.id === newEntry && !["loading", "splash"].includes(s.role),
      )
    )
      throw Error("请选择新的故事入口");
    project.entryId = newEntry;
  }
  project.scenes = keep;
  for (const id of ids) delete project.editor.positions[id];
  for (const s of keep)
    for (const t of targetsOf(s))
      if (t.kind === "scene" && ids.includes(t.sceneId)) {
        if (["loading", "splash"].includes(s.role))
          t.sceneId =
            keep.find((n) => s.role === "loading" && n.role === "splash")?.id ||
            project.entryId;
        else {
          t.kind = "unlinked";
          delete t.sceneId;
        }
      }
}
