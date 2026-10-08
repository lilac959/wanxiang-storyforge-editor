import { visualClips, clipLength } from "./timeline.mjs";
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
  if (scene.source === "sequence")
    return Math.max(
      scene.clips?.length ? 0 : scene.durationMs,
      ...(scene.clips || []).map((c) => c.startMs + clipLength(c)),
    );
  return scene.source === "images"
    ? scene.images.reduce((n, f) => n + f.durationMs, 0)
    : scene.video
      ? scene.video.outMs - scene.video.inMs
      : scene.durationMs;
}
export function newScene(name = "新的剧情段落") {
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
    theme: { preset: "simple", accent: "#7165ef", text: "#ffffff" },
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
export function references(p) {
  return [
    ...new Set(
      [
        p.loading.image,
        p.loading.video,
        p.splash.video,
        ...p.scenes.flatMap((s) => [
          s.video?.assetId,
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
    queue = [p.entryId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const s = p.scenes.find((s) => s.id === id);
    if (s)
      for (const t of targetsOf(s))
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
    "asset-opening-v1": "assets/opening.mp4",
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
    return p;
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
  return p;
}
// The same runtime validation is used by imports, drafts and the server.
export function validate(p, { publish = false } = {}) {
  const issues = [],
    error = (message, sceneId, code = "data") =>
      issues.push({ level: "error", message, sceneId, code }),
    warn = (message, sceneId) =>
      issues.push({ level: "warning", message, sceneId });
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
    if (!pos || !finite(pos.x, 0, 100000) || !finite(pos.y, 0, 100000)) {
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
      !["story", "death", "ending"].includes(s.role) ||
      !["video", "images", "sequence"].includes(s.source) ||
      (s.source === "sequence" && !Array.isArray(s.clips)) ||
      !Array.isArray(s.images) ||
      !Array.isArray(s.events) ||
      !Array.isArray(s.subtitles) ||
      !Array.isArray(s.audio) ||
      !Array.isArray(s.effects) ||
      !integer(s.durationMs)
    ) {
      error("剧情段落结构无效", s?.id, "structure");
      return issues;
    }
    unique(s.id, "剧情段落", s.id);
    ids.add(s.id);
  }
  if (!ids.has(p.entryId)) error("请选择作品的开始段落");
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
      (publish ? error : warn)("存在未连接的剧情出口", s.id);
    if (t.kind === "scene" && !ids.has(t.sceneId))
      error("连接的剧情段落不存在", s.id);
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
  if (p.loading.image) ref(p.loading.image, null, "image");
  if (p.loading.video) ref(p.loading.video, null, "video");
  if (p.splash.video) ref(p.splash.video, null, "video");
  for (const s of p.scenes) {
    if (s.source === "sequence") {
      const clips = [...s.clips].sort(
        (a, b) => (a?.startMs || 0) - (b?.startMs || 0),
      );
      let end = 0;
      for (const c of clips) {
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
        if (c.startMs < end) error("主画面片段不能重叠", s.id);
        end = c.startMs + clipLength(c);
        if (
          c.kind === "video" &&
          p.assets[c.assetId]?.durationMs &&
          c.outMs > p.assets[c.assetId].durationMs + 100
        )
          error("片段出点超过素材时长", s.id);
      }
      if (publish && s.role === "story" && !clips.length)
        error("场景缺少画面素材", s.id);
    }
    if (s.video) {
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
      if (!f) {
        error("图片片段无效", s.id, "structure");
        return issues;
      }
      unique(f.id, "图片片段", s.id);
      ref(f.assetId, s.id, "image");
      if (!integer(f.durationMs) || f.durationMs < 100)
        error("图片展示时长至少为 0.1 秒", s.id);
    }
    const d = duration(s);
    if (!integer(d) || d < 1 || d > 7200000) error("剧情时长无效", s.id);
    if (s.source === "images" && !s.images.length)
      error("图片段落尚未添加图片", s.id);
    if (publish && s.pending)
      error("请完成待配置段落，或取消其待配置标记", s.id);
    if (publish && s.role === "story" && s.source === "video" && !s.video)
      error("剧情段落缺少视频或图片", s.id);
    target(s.next, s);
    const interval = (x, label) => {
      unique(x.id, label, s.id);
      if (
        !integer(x.startMs) ||
        !integer(x.endMs) ||
        x.endMs <= x.startMs ||
        x.endMs > d
      )
        error(`${label}时间超出段落范围`, s.id);
    };
    for (const x of s.overlays || []) {
      interval(x, "图片叠加");
      ref(x.assetId, s.id, "image");
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
      if (!x) {
        error("音频结构无效", s.id, "structure");
        return issues;
      }
      interval(x, "音频");
      ref(x.assetId, s.id, "audio");
      if (!integer(x.inMs) || !finite(x.volume, 0, 1))
        error("音频入点或音量无效", s.id);
      const a = p.assets[x.assetId];
      if (a?.durationMs && x.inMs + x.endMs - x.startMs > a.durationMs + 100)
        error("音频范围超过素材时长", s.id);
    }
    for (const x of s.effects) {
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
      if (!e || !Array.isArray(e.options) || !e.success || !e.failure) {
        error("互动结构无效", s.id, "structure");
        return issues;
      }
      unique(e.id, "互动", s.id);
      if (
        !["choice", "qte", "hotspot"].includes(e.kind) ||
        !integer(e.startMs) ||
        e.startMs > d ||
        !integer(e.endMs) ||
        e.endMs < e.startMs ||
        e.endMs > d ||
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
    for (let i = 1; i < evs.length; i++)
      if (
        evs[i].startMs === evs[i - 1].startMs ||
        evs[i].startMs < evs[i - 1].endMs
      )
        error("互动区间重叠，请安排为先后出现", s.id);
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
