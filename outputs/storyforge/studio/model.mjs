import { visualClips, clipLength, mediaRate } from "./timeline.mjs";
import { interactionConflicts } from "./tracks.mjs";
export const SCHEMA = 3;
export const clone = (value) => structuredClone(value);
export const uid = (prefix = "id") => `${prefix}-${crypto.randomUUID()}`;
export const ms = (seconds) => Math.round(Number(seconds || 0) * 1000);
export const sec = (value) => Number(value || 0) / 1000;
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const gestures = {
  click: "单击",
  multi: "连续点击",
  hold: "长按",
  up: "向上滑动",
  down: "向下滑动",
  left: "向左滑动",
  right: "向右滑动",
};
export const continueTarget = () => ({ kind: "continue" });
export const endTarget = () => ({ kind: "end" });
export const sceneTarget = (id) =>
  id ? { kind: "scene", sceneId: id } : endTarget();
export function duration(scene) {
  const finite = (x) => (Number.isFinite(x) && x >= 0 ? x : 0);
  const overlayEnd = Math.max(
    0,
    ...(scene.overlays || []).map((c) => finite(c.endMs)),
  );
  let visualEnd;
  if (scene.source === "sequence")
    visualEnd = Math.max(
      0,
      ...(scene.clips || []).map((c) => finite(c.startMs + clipLength(c))),
    );
  else if (scene.source === "images")
    visualEnd = (scene.images || []).reduce(
      (n, f) => n + finite(f.durationMs),
      0,
    );
  else
    visualEnd = scene.video
      ? finite(clipLength(scene.video))
      : finite(scene.durationMs);
  return Math.max(
    overlayEnd,
    visualEnd,
    visualEnd > 0 ? 0 : finite(scene.durationMs) || 8000,
  );
}
export function newScene(name = "新的剧情节点") {
  return {
    id: uid("scene"),
    name,
    subtitle: "",
    role: "story",
    source: "video",
    video: null,
    images: [],
    durationMs: 8000,
    events: [],
    subtitles: [],
    audio: [],
    effects: [],
    overlays: [],
    next: endTarget(),
    grayscale: false,
    clean: true,
  };
}
export function newEvent(at = 0, kind = "qte", length = 4000) {
  at = Number.isFinite(at) && at >= 0 ? Math.round(at) : 0;
  length = Number.isFinite(length) && length >= 100 ? Math.round(length) : 4000;
  return {
    id: uid("event"),
    kind,
    startMs: at,
    endMs: at + length,
    endMode: kind === "choice" ? "wait" : "clock",
    timeoutMs: length,
    pause: kind === "choice",
    gesture: "right",
    clicks: 5,
    holdMs: 1500,
    distance: 80,
    x: 65,
    y: 50,
    scale: 100,
    hint: "",
    sound: "heartbeat",
    volume: 0.35,
    condition: null,
    success: {
      target: continueTarget(),
      timing: "immediate",
      actions: [],
      restoreSpeed: false,
    },
    failure: {
      target: continueTarget(),
      timing: "immediate",
      actions: [],
      restoreSpeed: false,
    },
    options:
      kind === "choice"
        ? [
            {
              id: uid("option"),
              text: "选项一",
              target: endTarget(),
              actions: [],
              condition: null,
              x: 0,
              y: 0,
            },
            {
              id: uid("option"),
              text: "选项二",
              target: endTarget(),
              actions: [],
              condition: null,
              x: 0,
              y: 0,
            },
          ]
        : [],
  };
}
export function newProject(name = "未命名作品") {
  const s = newScene("开始");
  return {
    schemaVersion: SCHEMA,
    id: uid("project"),
    name,
    entryId: s.id,
    variables: {},
    theme: { preset: "classic", accent: "#e5d6b1", text: "#f8f0e4" },
    assets: {},
    scenes: [s],
    loading: {
      image: null,
      video: null,
      title: name,
      subtitle: "",
      text: "正在准备开场",
      color: "#e5d6b1",
      minimumMs: 1000,
      titleLayout: "square",
    },
    splash: { video: null, title: name, subtitle: "", effect: "fade" },
    editor: { positions: { [s.id]: { x: 60, y: 60 } } },
  };
}
export const openingRole = (scene) =>
  ["loading", "splash"].includes(scene?.role);
export const openingCard = (project, role) =>
  project.scenes.find((s) => s.role === role);
export function resolveOpeningDuration(project, assetId, durationMs) {
  if (!Number.isInteger(durationMs) || durationMs < 100) return;
  for (const scene of project.scenes) {
    const clip = scene.clips?.find(
      (c) => c.assetId === assetId && c.id === `${scene.id}-background`,
    );
    if (!clip || project.assets[assetId]?.durationMs) continue;
    const before = duration(scene);
    clip.outMs = durationMs;
    for (const range of Object.values(scene.opening?.elements || {}))
      if (range.startMs === 0 && range.endMs === before)
        range.endMs = duration(scene);
  }
  if (project.assets[assetId]) project.assets[assetId].durationMs = durationMs;
}
export function openingElements(scene) {
  const keys =
    scene.role === "loading"
      ? ["title", "subtitle", "progress"]
      : ["title", "subtitle", "start"];
  scene.opening ||= {};
  scene.opening.elements ||= {};
  for (const key of keys) {
    scene.opening.elements[key] ||= {
      startMs: 0,
      endMs: Math.max(100, duration(scene)),
      hidden: false,
    };
    scene.opening.elements[key].id = key;
  }
  return scene.opening.elements;
}
export function unifyCards(project) {
  if (project.theme?.preset === "simple") project.theme.preset = "classic";
  for (const scene of project.scenes)
    for (const e of scene.events || []) {
      if (e.uiComponent === "simple-choice@1")
        e.uiComponent = "classic-choice@1";
      if (e.uiPreset === "simple") e.uiPreset = "classic";
    }
  if (project.unifiedCards) return project;
  project.editor ||= { positions: {} };
  project.editor.positions ||= {};
  const entry = project.editor.positions[project.entryId] || { x: 60, y: 100 };
  for (const s of project.scenes) {
    const at = project.editor.positions[s.id];
    if (at && !project.editor.positions["@loading"]) at.x += 640;
  }
  const cards = ["loading", "splash"].map((role, i) => {
    const scene = newScene(role === "loading" ? "加载" : "开屏");
    // Stable identities make repeated imports and round-trips idempotent.
    scene.id = `${project.id}-opening-${role}`;
    scene.role = role;
    scene.opening = clone(project[role]);
    scene.openingPurpose = role;
    scene.opening.loop = true;
    const aid = project[role].video || project[role].image;
    const a = project.assets[aid];
    scene.source = "sequence";
    scene.clips = a
      ? [
          {
            id: `${scene.id}-background`,
            assetId: aid,
            kind: a.kind,
            startMs: 0,
            inMs: 0,
            outMs: Math.max(100, a.durationMs || 8000),
          },
        ]
      : [];
    openingElements(scene);
    project.editor.positions[scene.id] = project.editor.positions[
      role === "loading" ? "@loading" : "@splash"
    ] || { x: 60 + i * 320, y: entry.y };
    return scene;
  });
  cards[0].next = sceneTarget(cards[1].id);
  cards[1].next = sceneTarget(project.entryId);
  project.scenes.push(...cards);
  delete project.editor.positions["@loading"];
  delete project.editor.positions["@splash"];
  project.unifiedCards = true;
  return project;
}
export function changeRole(project, id, role) {
  const scene = project.scenes.find((s) => s.id === id);
  if (
    !scene ||
    !["story", "loading", "splash", "ending", "death"].includes(role)
  )
    throw Error("节点用途无效");
  if (openingRole({ role }) && project.entryId === id) {
    const replacement = project.scenes.find(
      (s) => s.id !== id && !openingRole(s),
    );
    if (!replacement) throw Error("请先新建一张剧情节点，作为起始节点");
    project.entryId = replacement.id;
  }
  if (openingRole(scene)) {
    scene.openingByRole ||= {};
    scene.openingByRole[scene.role] = clone(scene.opening);
    scene.openingPurpose = scene.role;
  }
  if (openingRole({ role })) {
    const existing = openingCard(project, role);
    if (existing && existing.id !== id) {
      existing.role = "story";
      if (existing.savedRoutes) {
        existing.next = clone(existing.savedRoutes.next);
        delete existing.savedRoutes;
      }
      if (role === "splash") {
        const loading = openingCard(project, "loading");
        if (loading?.next?.sceneId === existing.id)
          loading.next = sceneTarget(id);
      }
    }
    scene.opening = clone(
      scene.openingByRole?.[role] ||
        (scene.openingPurpose === role ? scene.opening : null) ||
        project[role],
    );
    scene.openingPurpose = role;
    scene.opening.loop ??= true;
    scene.savedRoutes ||= { next: clone(scene.next) };
    scene.next = sceneTarget(
      role === "loading"
        ? openingCard(project, "splash")?.id || project.entryId
        : project.entryId,
    );
  } else if (openingRole(scene) && scene.savedRoutes) {
    scene.next = clone(scene.savedRoutes.next);
    delete scene.savedRoutes;
  }
  scene.role = role;
  if (openingRole(scene)) openingElements(scene);
}
export function setCardNext(project, id, target) {
  const scene = project.scenes.find((s) => s.id === id),
    destination = project.scenes.find((s) => s.id === target.sceneId);
  if (!scene) throw Error("节点不存在");
  if (destination?.role === "loading") throw Error("加载节点只用于作品启动");
  if (openingRole(scene) && !["scene", "unlinked"].includes(target.kind))
    throw Error("请选择后续节点");
  if (scene.role === "splash" && openingRole(destination))
    throw Error("开屏请连接剧情节点");
  scene.next = clone(target);
  if (scene.role === "splash" && target.kind === "scene")
    project.entryId = target.sceneId;
}
export function references(p) {
  return [
    ...new Set(
      [
        ...(!p.unifiedCards
          ? [p.loading.image, p.loading.video, p.splash.video]
          : []),
        ...p.scenes.flatMap((s) => [
          s.video?.assetId,
          s.opening?.image,
          ...(s.clips || []).map((c) => c.assetId),
          ...(s.overlays || []).map((c) => c.assetId),
          ...s.images.map((f) => f.assetId),
          ...s.audio.map((a) => a.assetId),
        ]),
      ].filter(Boolean),
    ),
  ];
}
export function targetsOf(s) {
  return [
    s.next,
    ...s.events.flatMap((e) => [
      e.success.target,
      e.failure.target,
      ...e.options.map((o) => o.target),
    ]),
  ];
}
export function reachable(p) {
  const seen = new Set(),
    queue = p.unifiedCards
      ? [p.entryId, ...p.scenes.filter(openingRole).map((s) => s.id)]
      : [p.entryId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const s = p.scenes.find((s) => s.id === id);
    if (s)
      for (const t of openingRole(s) ? [s.next] : targetsOf(s))
        if (t.kind === "scene") queue.push(t.sceneId);
  }
  return seen;
}
export function evaluate(condition, variables) {
  if (!condition) return true;
  const a = variables[condition.variable],
    b = condition.value;
  return condition.op === "eq"
    ? a === b
    : condition.op === "ne"
      ? a !== b
      : condition.op === "gt"
        ? a > b
        : condition.op === "gte"
          ? a >= b
          : condition.op === "lt"
            ? a < b
            : condition.op === "lte"
              ? a <= b
              : false;
}
export function applyActions(actions, variables) {
  for (const a of actions || []) {
    if (a.op === "set") variables[a.variable] = a.value;
    else if (a.op === "add") variables[a.variable] += a.value;
  }
}
function builtin(source) {
  const match = /^asset-tail-video-([1-9])$/.exec(source);
  if (match) return `assets/chapter01-branch-${match[1]}.mp4`;
  if (/^asset-chapter01-0[1-4]$/.test(source))
    return `assets/${source.slice(6)}.png`;
  return {
    "asset-loading-video-v1": "assets/loading-background.mp4",
    "asset-opening-v1": "assets/opening-blue.mp4",
    "asset-loading-cover-v1": "assets/loading-cover.png",
  }[source];
}
export function migrate(input) {
  const old = input.project || input;
  if ([2, SCHEMA].includes(old.schemaVersion)) {
    const p = clone(old);
    p.schemaVersion = SCHEMA;
    if (p.editor?.positions && Array.isArray(p.scenes))
      p.scenes.forEach((scene, i) => {
        p.editor.positions[scene.id] ||= {
          x: 60 + (i % 3) * 340,
          y: 60 + Math.floor(i / 3) * 390,
        };
      });
    p.theme ||= { preset: "classic", accent: "#e5d6b1", text: "#f8f0e4" };
    const errors = validate(p).filter(
      (x) => x.level === "error" && x.code === "structure",
    );
    if (errors.length) throw Error(errors[0].message);
    if (old.schemaVersion === 2) spaceCards(p);
    return unifyCards(p);
  }
  if (
    old.version !== 1 ||
    !Array.isArray(old.nodes) ||
    !old.nodes.length ||
    !old.loading ||
    !old.splash
  )
    throw Error("无法识别项目格式");
  const p = newProject(old.name || "导入作品");
  p.id = "legacy-wanxiang";
  p.scenes = [];
  p.entryId = old.nodes[0].id;
  p.editor.positions = {};
  p.migratedFrom = 1;
  p.theme = { preset: "classic", accent: "#e5d6b1", text: "#f8f0e4" };
  const asset = (source, name = "", kind = "video") => {
    if (!source) return null;
    if (!p.assets[source])
      p.assets[source] = {
        id: source,
        name: name || source,
        kind,
        mime:
          kind === "image"
            ? "image/png"
            : kind === "audio"
              ? "audio/mpeg"
              : "video/mp4",
        source: /^asset-cloud-[a-f0-9]{64}$/.test(source)
          ? `/api/media/${source.slice(12)}`
          : builtin(source) || source,
        size: 0,
      };
    return source;
  };
  p.loading = {
    ...p.loading,
    ...clone(old.loading),
    image: asset(old.loading.image, "加载封面", "image"),
    video: asset(old.loading.video, old.loading.videoName),
    minimumMs: 3000,
  };
  p.splash = {
    ...p.splash,
    ...clone(old.splash),
    video: asset(old.splash.video, old.splash.videoName),
  };
  const ending = old.nodes.find((n) => n.endingScreen);
  const target = (id) =>
    id ? sceneTarget(id) : ending ? sceneTarget(ending.id) : endTarget();
  old.nodes.forEach((n, i) => {
    const s = newScene(n.name);
    s.id = n.id;
    s.subtitle = n.subtitle || "";
    s.role = n.deathScreen ? "death" : n.endingScreen ? "ending" : "story";
    s.clean = !!n.cleanPresentation;
    s.grayscale = !!n.grayscale;
    s.pending = !!n.pending;
    s.durationMs = Math.max(1, ms(n.duration));
    s.video = n.video
      ? {
          id: `clip-${n.id}`,
          assetId: asset(n.video, n.videoName),
          inMs: 0,
          outMs: s.durationMs,
        }
      : null;
    s.images = (n.frames || []).map((f) => ({
      id: f.id,
      assetId: asset(f.image, f.name, "image"),
      durationMs: ms(f.duration),
    }));
    s.source =
      n.previewSource === "boards" && s.images.length ? "images" : "video";
    const d = duration(s);
    s.next = target(n.next);
    if (n.type !== "none") {
      const tail = n.type === "qte" && n.tailQte && s.source === "video";
      const at =
        n.type === "qte" && n.qteTriggerMode === "linked-tail"
          ? Math.max(0, d - ms(n.trigger))
          : clamp(ms(n.trigger), 0, d);
      const e = newEvent(at, n.type, ms(n.limit || 8));
      e.id = `event-${n.id}`;
      e.endMs = d;
      e.endMode = n.type === "choice" ? "wait" : "clock";
      e.pause = !tail;
      Object.assign(e, {
        gesture: n.qteGesture || "click",
        clicks: n.qteClicks || 5,
        holdMs: ms(n.qteHold || 1.5),
        distance: n.qteDistance || 80,
        x: n.x ?? 65,
        y: n.y ?? 50,
        scale: n.qteScale || 100,
        hint: n.qteHint || "",
        sound: n.qteSound || "heartbeat",
        volume: n.qteVolume ?? 0.35,
      });
      e.success = {
        target: target(n.options?.[0]?.target),
        timing: n.type === "qte" ? "sceneEnd" : "immediate",
        restoreSpeed: !!tail,
        actions: [],
      };
      e.failure = {
        target: target(n.failure),
        timing: "immediate",
        actions: [],
        restoreSpeed: false,
      };
      e.options = (n.options || []).map((o, j) => ({
        id: `option-${n.id}-${j}`,
        text: o.text,
        target: target(o.target),
        condition: null,
        actions: [],
        x: o.uiOffset?.x || 0,
        y: o.uiOffset?.y || 0,
      }));
      s.events.push(e);
      if (tail)
        s.effects.push({
          id: `speed-${n.id}`,
          kind: "speed",
          startMs: Math.max(0, d - ms(n.qteTail || 2)),
          endMs: d,
          value: clamp(Number(n.qteRate) || 0.25, 0.0625, 4),
        });
    }
    if (n.cinemaMode)
      s.effects.push({
        id: `bars-${n.id}`,
        kind: "bars",
        startMs: clamp(ms(n.cinemaStart), 0, d),
        endMs: clamp(Number.isFinite(n.cinemaEnd) ? ms(n.cinemaEnd) : d, 0, d),
        value: n.cinemaSize ?? 6,
      });
    p.scenes.push(s);
    p.editor.positions[s.id] = {
      x: 60 + (i % 3) * 320,
      y: 60 + Math.floor(i / 3) * 220,
    };
  });
  spaceCards(p);
  p.migrationBackup = undefined;
  return unifyCards(p);
}
// The same runtime validation is used by imports, drafts and the server.
export function validate(p, { publish = false } = {}) {
  let context = {};
  const issues = [],
    error = (message, sceneId, code = "data") =>
      issues.push({ level: "error", message, sceneId, code, ...context }),
    warn = (message, sceneId) =>
      issues.push({ level: "warning", message, sceneId, ...context });
  const integer = (n) => Number.isSafeInteger(n) && n >= 0,
    id = (x) => typeof x === "string" && /^[\w-]{1,160}$/.test(x),
    str = (x) => typeof x === "string",
    finite = (x, a, b) => Number.isFinite(x) && x >= a && x <= b;
  if (
    !p ||
    ![2, SCHEMA].includes(p.schemaVersion) ||
    !id(p.id) ||
    !str(p.name) ||
    !Array.isArray(p.scenes) ||
    !p.scenes.length ||
    p.scenes.length > 500 ||
    !p.assets ||
    !p.loading ||
    !p.splash ||
    !p.variables ||
    Array.isArray(p.variables) ||
    typeof p.variables !== "object" ||
    !p.editor ||
    !p.editor.positions
  ) {
    error("项目结构无效", null, "structure");
    return issues;
  }
  for (const pos of Object.values(p.editor.positions))
    if (
      !pos ||
      !finite(pos.x, -100000, 100000) ||
      !finite(pos.y, -100000, 100000)
    ) {
      error("剧情地图位置无效", null, "structure");
      return issues;
    }
  if (
    p.theme &&
    (!["classic", "simple"].includes(p.theme.preset) ||
      !/^#[a-f0-9]{6}$/i.test(p.theme.accent) ||
      !/^#[a-f0-9]{6}$/i.test(p.theme.text))
  )
    error("作品样式无效");
  const ids = new Set(),
    allIds = new Set();
  const unique = (value, label, sid) => {
    if (!id(value) || allIds.has(value))
      error(`${label}编号无效或重复`, sid, "structure");
    allIds.add(value);
  };
  for (const s of p.scenes) {
    if (
      !s ||
      !id(s.id) ||
      !str(s.name) ||
      !["story", "death", "ending", "loading", "splash"].includes(s.role) ||
      !["video", "images", "sequence"].includes(s.source) ||
      (s.source === "sequence" && !Array.isArray(s.clips)) ||
      !Array.isArray(s.images) ||
      !Array.isArray(s.events) ||
      !Array.isArray(s.subtitles) ||
      !Array.isArray(s.audio) ||
      !Array.isArray(s.effects) ||
      !integer(s.durationMs)
    ) {
      error("剧情节点结构无效", s?.id, "structure");
      return issues;
    }
    unique(s.id, "剧情节点", s.id);
    ids.add(s.id);
  }
  if (!ids.has(p.entryId)) error("请选择作品的开始节点");
  if (openingRole(p.scenes.find((s) => s.id === p.entryId)))
    error("起始节点不能是加载或开屏节点");
  for (const role of ["loading", "splash"])
    if (p.scenes.filter((s) => s.role === role).length > 1)
      error("加载和开屏各最多一张节点");
  let activeScenes;
  try {
    activeScenes = reachable(p);
  } catch {
    /* malformed routes are checked below */
  }
  const requiredAtRelease = (s) =>
    publish && (!activeScenes || activeScenes.has(s.id) || openingRole(s));
  for (const [key, value] of Object.entries(p.variables))
    if (
      !id(key) ||
      !["string", "boolean", "number"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      error("变量名称或初始值无效");
  const condition = (c, sid) => {
    if (
      c &&
      (!Object.hasOwn(p.variables, c.variable) ||
        !["eq", "ne", "gt", "gte", "lt", "lte"].includes(c.op) ||
        typeof c.value !== typeof p.variables[c.variable] ||
        (typeof c.value === "number" && !Number.isFinite(c.value)) ||
        (!["eq", "ne"].includes(c.op) && typeof c.value !== "number"))
    )
      error("条件中的变量、比较方式或值无效", sid);
  };
  const actions = (list, sid) => {
    if (!Array.isArray(list)) {
      error("结果动作无效", sid, "structure");
      return;
    }
    for (const a of list)
      if (
        !a ||
        !Object.hasOwn(p.variables, a.variable) ||
        !["set", "add"].includes(a.op) ||
        typeof a.value !== typeof p.variables[a.variable] ||
        (a.op === "add" && typeof a.value !== "number") ||
        (typeof a.value === "number" && !Number.isFinite(a.value))
      )
        error("变量动作无效", sid);
  };
  const target = (t, s) => {
    if (
      !t ||
      !["continue", "scene", "seek", "end", "unlinked", "home"].includes(t.kind)
    ) {
      error("剧情去向无效", s.id, "structure");
      return;
    }
    if (t.kind === "unlinked")
      (requiredAtRelease(s) ? error : warn)("存在未连接的剧情出口", s.id);
    if (t.kind === "scene" && !ids.has(t.sceneId))
      error("连接的剧情节点不存在", s.id);
    if (t.kind === "seek" && (!integer(t.timeMs) || t.timeMs > duration(s)))
      error("视频内跳转位置超出范围", s.id);
  };
  for (const [key, a] of Object.entries(p.assets)) {
    if (
      !a ||
      a.id !== key ||
      !str(a.name) ||
      !["image", "video", "audio"].includes(a.kind) ||
      !str(a.source) ||
      !str(a.mime)
    ) {
      error("素材结构无效", null, "structure");
      continue;
    }
    if (
      !/^(asset-[\w-]+|assets\/[\w./-]+|\/api\/media\/[a-f0-9]{64}|https?:\/\/[^\s]+)$/.test(
        a.source,
      ) ||
      a.source.includes("..")
    )
      error(`素材地址无效：${a.name}`);
  }
  const ref = (a, sid, kind) => {
    if (!p.assets[a]) error("引用的素材不存在", sid);
    else if (kind && p.assets[a].kind !== kind)
      error("素材类型与轨道不一致", sid);
  };
  if (
    !str(p.loading.title) ||
    !str(p.loading.text) ||
    !str(p.loading.subtitle) ||
    !/^#[a-f0-9]{6}$/i.test(p.loading.color) ||
    !integer(p.loading.minimumMs) ||
    p.loading.minimumMs > 30000 ||
    !str(p.splash.title) ||
    !str(p.splash.subtitle)
  )
    error("开场设置无效");
  for (const config of [p.loading, p.splash]) {
    if (config.startText !== undefined && !str(config.startText))
      error("开始提示无效");
    if (
      config.layout !== undefined &&
      (!config.layout ||
        typeof config.layout !== "object" ||
        Array.isArray(config.layout))
    )
      error("开场布局无效");
    for (const [key, style] of Object.entries(config.layout || {})) {
      if (
        !["title", "subtitle", "progress", "start"].includes(key) ||
        !style ||
        !finite(style.x, 0, 100) ||
        !finite(style.y, 0, 100) ||
        !finite(style.size, 1, 300) ||
        !finite(style.width, 0, 100) ||
        !/^#[a-f0-9]{6}$/i.test(style.color)
      )
        error("开场元素位置或样式无效");
    }
  }
  for (const scene of p.scenes.filter(openingRole)) {
    const c = scene.opening;
    if (
      !c ||
      !str(c.title) ||
      !str(c.subtitle) ||
      (c.loop !== undefined && typeof c.loop !== "boolean")
    ) {
      error("开场节点设置无效", scene.id, "structure");
      continue;
    }
    if (
      scene.role === "loading" &&
      (!str(c.text) ||
        !/^#[a-f0-9]{6}$/i.test(c.color) ||
        !integer(c.minimumMs) ||
        c.minimumMs > 30000)
    )
      error("加载节点设置无效", scene.id);
    if (c.startText !== undefined && !str(c.startText))
      error("开始按钮文字无效", scene.id);
    if (c.effect !== undefined && !["fade", "zoom", "none"].includes(c.effect))
      error("开场动效无效", scene.id);
    for (const [key, style] of Object.entries(c.layout || {}))
      if (
        !["title", "subtitle", "progress", "start"].includes(key) ||
        !style ||
        !finite(style.x, 0, 100) ||
        !finite(style.y, 0, 100) ||
        !finite(style.size, 1, 300) ||
        !finite(style.width, 0, 100) ||
        !/^#[a-f0-9]{6}$/i.test(style.color)
      )
        error("开场元素位置或样式无效", scene.id);
    for (const [key, range] of Object.entries(c.elements || {}))
      if (
        !["title", "subtitle", "progress", "start"].includes(key) ||
        !range ||
        !integer(range.startMs) ||
        !integer(range.endMs) ||
        range.endMs <= range.startMs ||
        range.endMs > 7200000 ||
        typeof range.hidden !== "boolean"
      )
        error("开场元素时间无效", scene.id);
    if (c.image) ref(c.image, scene.id, "image");
    if (
      scene.role === "splash" &&
      (c.elements?.start?.hidden ||
        c.elements?.start?.startMs >= duration(scene))
    )
      (publish ? error : warn)(
        "开屏需要可点击的开始按钮，请检查显示时间和隐藏设置",
        scene.id,
      );
    const destination = p.scenes.find((s) => s.id === scene.next?.sceneId);
    if (
      destination?.role === "loading" ||
      (scene.role === "splash" && openingRole(destination))
    )
      error("开场节点连接无效", scene.id);
  }
  if (!p.unifiedCards) {
    if (p.loading.image) ref(p.loading.image, null, "image");
    if (p.loading.video) ref(p.loading.video, null, "video");
    if (p.splash.video) ref(p.splash.video, null, "video");
  }
  for (const s of p.scenes) {
    if (s.source === "sequence") {
      const clips = [...s.clips].sort(
        (a, b) => (a?.startMs || 0) - (b?.startMs || 0),
      );
      let end = 0;
      for (const c of clips) {
        context = {
          itemKind: "clip",
          itemId: c?.id,
          assetId: c?.assetId,
          timeMs: c?.startMs,
        };
        if (!c || !["video", "image"].includes(c.kind)) {
          error("画面片段结构无效", s.id, "structure");
          continue;
        }
        unique(c.id, "画面片段", s.id);
        ref(c.assetId, s.id, c.kind);
        if (
          !integer(c.startMs) ||
          !integer(c.inMs) ||
          !integer(c.outMs) ||
          clipLength(c) < 100
        )
          error("画面片段时间无效", s.id);
        if (!finite(mediaRate(c), 0.25, 4)) error("视频倍速无效", s.id);
        if (c.startMs < end) error("主画面片段不能重叠", s.id);
        end = c.startMs + clipLength(c);
        if (
          c.kind === "video" &&
          p.assets[c.assetId]?.durationMs &&
          c.outMs > p.assets[c.assetId].durationMs + 100
        )
          error("片段出点超过素材时长", s.id);
      }
      if (
        requiredAtRelease(s) &&
        s.role === "story" &&
        !clips.length &&
        !s.overlays?.length
      )
        error("节点缺少画面素材", s.id);
    }
    if (s.video) {
      context = {
        itemKind: "video",
        itemId: s.video.id,
        assetId: s.video.assetId,
        timeMs: 0,
      };
      unique(s.video.id, "视频片段", s.id);
      ref(s.video.assetId, s.id, "video");
      if (
        !integer(s.video.inMs) ||
        !integer(s.video.outMs) ||
        s.video.outMs <= s.video.inMs
      )
        error("视频入点和出点无效", s.id);
      const a = p.assets[s.video.assetId];
      if (a?.durationMs && s.video.outMs > a.durationMs + 100)
        error("视频出点超过素材时长", s.id);
    }
    for (const f of s.images) {
      context = { itemKind: "image", itemId: f?.id, assetId: f?.assetId };
      if (!f) {
        error("图片片段无效", s.id, "structure");
        return issues;
      }
      unique(f.id, "图片片段", s.id);
      ref(f.assetId, s.id, "image");
      if (!integer(f.durationMs) || f.durationMs < 100)
        error("图片展示时长至少为 0.1 秒", s.id);
    }
    context = {};
    const d = duration(s);
    if (!integer(d) || d < 1 || d > 7200000) error("剧情时长无效", s.id);
    if (s.source === "images" && !s.images.length && !s.overlays?.length)
      error("图片节点尚未添加图片", s.id);
    if (requiredAtRelease(s) && s.pending)
      error("请完成待配置节点，或取消其待配置标记", s.id);
    if (
      requiredAtRelease(s) &&
      s.role === "story" &&
      s.source === "video" &&
      !s.video &&
      !s.overlays?.length
    )
      error("剧情节点缺少视频或图片", s.id);
    context = {
      routePath: "next",
      label: openingRole(s)
        ? s.role === "loading"
          ? "加载完成"
          : "点击开始"
        : "播放结束",
    };
    target(s.next, s);
    const interval = (x, label) => {
      context = { ...context, routePath: undefined };
      unique(x.id, label, s.id);
      if (
        !integer(x.startMs) ||
        !integer(x.endMs) ||
        x.endMs <= x.startMs ||
        x.endMs > d
      )
        error(`${label}时间超出节点范围`, s.id);
    };
    for (const x of s.overlays || []) {
      context = {
        itemKind: "overlay",
        itemId: x?.id,
        assetId: x?.assetId,
        timeMs: x?.startMs,
      };
      interval(x, "图片叠加");
      const overlayAsset = p.assets[x.assetId];
      ref(x.assetId, s.id, overlayAsset?.kind === "video" ? "video" : "image");
      if (
        overlayAsset?.kind === "video" &&
        (!integer(x.inMs ?? 0) ||
          (x.inMs ?? 0) + (x.endMs - x.startMs) * mediaRate(x) >
            overlayAsset.durationMs)
      )
        error("叠加视频截取超过素材时长", s.id);
      if (overlayAsset?.kind === "video" && !finite(x.volume ?? 1, 0, 1))
        error("叠加视频音量无效", s.id);
      if (
        !finite(x.x, 0, 100) ||
        !finite(x.y, 0, 100) ||
        !finite(x.width, 1, 100)
      )
        error("叠加图片位置无效", s.id);
    }
    for (const x of [
      "events",
      "subtitles",
      "audio",
      "effects",
      "overlays",
    ].flatMap((k) => s[k] || []))
      if (
        x.linkedClipId &&
        !visualClips(s).some((c) => c.id === x.linkedClipId)
      )
        error("关联的画面片段不存在", s.id);
    for (const x of s.subtitles) {
      context = { itemKind: "subtitle", itemId: x?.id, timeMs: x?.startMs };
      if (!x || !str(x.text)) {
        error("字幕结构无效", s.id, "structure");
        return issues;
      }
      interval(x, "字幕");
      if (
        !finite(x.x, 0, 100) ||
        !finite(x.y, 0, 100) ||
        !finite(x.size, 12, 80) ||
        !/^#[a-f0-9]{6}$/i.test(x.color)
      )
        error("字幕位置或样式无效", s.id);
    }
    for (const x of s.audio) {
      context = {
        itemKind: "audio",
        itemId: x?.id,
        assetId: x?.assetId,
        timeMs: x?.startMs,
      };
      if (!x) {
        error("音频结构无效", s.id, "structure");
        return issues;
      }
      interval(x, "音频");
      ref(x.assetId, s.id, x.detachedFrom ? "video" : "audio");
      if (!finite(mediaRate(x), 0.25, 4)) error("音频倍速无效", s.id);
      if (!integer(x.inMs) || !finite(x.volume, 0, 1))
        error("音频入点或音量无效", s.id);
      const a = p.assets[x.assetId];
      if (
        a?.durationMs &&
        x.inMs + (x.endMs - x.startMs) * mediaRate(x) > a.durationMs + 100
      )
        error("音频范围超过素材时长", s.id);
    }
    for (const x of s.effects) {
      context = { itemKind: "effect", itemId: x?.id, timeMs: x?.startMs };
      if (!x) {
        error("效果结构无效", s.id, "structure");
        return issues;
      }
      interval(x, "效果");
      if (
        !["speed", "bars"].includes(x.kind) ||
        !finite(
          x.value,
          x.kind === "speed" ? 0.0625 : 0,
          x.kind === "speed" ? 4 : 30,
        )
      )
        error("效果数值无效", s.id);
    }
    for (const kind of ["speed", "bars"]) {
      const xs = s.effects
        .filter((x) => x.kind === kind)
        .sort((a, b) => a.startMs - b.startMs);
      for (let i = 1; i < xs.length; i++)
        if (xs[i].startMs < xs[i - 1].endMs)
          error("相同效果区间不能重叠", s.id);
    }
    if (s.events.some((e) => !e)) {
      error("互动结构无效", s.id, "structure");
      return issues;
    }
    const evs = [...s.events].sort((a, b) => a.startMs - b.startMs);
    for (const e of evs) {
      context = {
        itemKind: "event",
        itemId: e?.id,
        timeMs: e?.startMs,
        label:
          e?.hint ||
          (e?.kind === "choice"
            ? "选择互动"
            : e?.kind === "hotspot"
              ? "热点互动"
              : gestures[e?.gesture] || "操作互动"),
      };
      if (!e || !Array.isArray(e.options) || !e.success || !e.failure) {
        error("互动结构无效", s.id, "structure");
        return issues;
      }
      unique(e.id, "互动", s.id);
      if (
        !["choice", "qte", "hotspot"].includes(e.kind) ||
        !integer(e.startMs) ||
        (!openingRole(s) && e.startMs > d) ||
        !integer(e.endMs) ||
        e.endMs < e.startMs ||
        (!openingRole(s) && e.endMs > d) ||
        !["range", "clock", "wait"].includes(e.endMode) ||
        !integer(e.timeoutMs) ||
        e.timeoutMs < 100 ||
        e.timeoutMs > 600000 ||
        typeof e.pause !== "boolean"
      )
        error("互动时间或类型无效", s.id);
      if (e.endMode === "range" && (e.pause || e.endMs <= e.startMs))
        error("按视频位置结束的互动需要持续播放且有有效区间", s.id);
      if (
        !finite(e.x, 0, 100) ||
        !finite(e.y, 0, 100) ||
        !finite(e.scale, 40, 180) ||
        !finite(e.volume, 0, 1) ||
        !Object.hasOwn(gestures, e.gesture) ||
        !integer(e.holdMs) ||
        e.holdMs < 100 ||
        !Number.isInteger(e.clicks) ||
        e.clicks < 1 ||
        e.clicks > 30 ||
        !finite(e.distance, 10, 400)
      )
        error("互动位置或操作要求无效", s.id);
      if (
        e.kind === "qte" &&
        e.gesture === "hold" &&
        e.endMode === "clock" &&
        e.holdMs > e.timeoutMs
      )
        error("长按时长不能超过操作倒计时", s.id);
      condition(e.condition, s.id);
      for (const result of [e.success, e.failure]) {
        context = {
          ...context,
          routePath: `events.${s.events.indexOf(e)}.${result === e.success ? "success" : "failure"}.target`,
          label: `${e.hint || gestures[e.gesture] || "互动"} · ${result === e.success ? "成功" : "失败 / 超时"}`,
        };
        target(result.target, s);
        actions(result.actions, s.id);
        if (!["immediate", "sceneEnd"].includes(result.timing))
          error("结果执行时机无效", s.id);
      }
      if (e.kind === "choice" && (!e.options.length || e.options.length > 10))
        error("选择互动需要 1—10 个选项", s.id);
      for (const o of e.options) {
        if (!o || !str(o.text)) {
          error("选项结构无效", s.id, "structure");
          return issues;
        }
        unique(o.id, "选项", s.id);
        context = {
          ...context,
          label: o.text || "选项",
          routePath: `events.${s.events.indexOf(e)}.options.${e.options.indexOf(o)}.target`,
        };
        target(o.target, s);
        condition(o.condition, s.id);
        actions(o.actions, s.id);
        if (!finite(o.x, -100, 100) || !finite(o.y, -100, 100))
          error("选项偏移无效", s.id);
        if (!o.text.trim()) error("选项文字不能为空", s.id);
      }
      if (
        publish &&
        e.kind === "choice" &&
        !e.options.some((o) => !o.condition)
      )
        error("至少保留一个无条件选项，防止没有可选路线", s.id);
    }
    for (const conflict of interactionConflicts(s)) {
      context = {
        itemKind: "event",
        itemId: conflict.a.id,
        relatedId: conflict.b.id,
        timeMs: conflict.start,
      };
      if (conflict.kind === "route")
        error(conflict.message, s.id, "interaction-route-conflict");
      else warn(conflict.message, s.id);
    }
    context = {};
  }
  if (issues.some((x) => x.code === "structure")) return issues;
  const reach = reachable(p);
  for (const s of p.scenes) {
    if (!reach.has(s.id)) warn(`「${s.name}」从入口无法到达`, s.id);
    if (
      s.events.some((e) =>
        e.options.some((o) => /^选项[一二AB12]$/.test(o.text)),
      )
    )
      warn(`「${s.name}」仍有占位选项文字`, s.id);
  }
  return issues;
}

function spaceCards(p) {
  const placed = [];
  for (const scene of p.scenes) {
    const pos = p.editor.positions[scene.id];
    if (!pos) continue;
    const count =
        1 +
        scene.events.reduce(
          (n, e) =>
            n +
            (e.kind === "choice" ? e.options.length : 1) +
            (e.kind !== "choice" || e.endMode !== "wait" ? 1 : 0),
          0,
        ),
      height = 176 + count * 34;
    for (let pass = 0; pass < placed.length + 1; pass++) {
      const hit = placed.find(
        (x) =>
          pos.x < x.x + 290 &&
          pos.x + 290 > x.x &&
          pos.y < x.y + x.h + 30 &&
          pos.y + height + 30 > x.y,
      );
      if (!hit) break;
      pos.y = hit.y + hit.h + 30;
    }
    placed.push({ ...pos, h: height });
  }
}
