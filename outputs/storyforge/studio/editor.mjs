import { projectCatalog } from "./project-catalog.mjs";
import { AssetLibrary, mediaUses } from "./asset-library.mjs";
import {
  UI_COMPONENTS,
  componentEvent,
  componentDemo,
} from "./ui-components.mjs";
import {
  LOADING,
  SPLASH,
  specialNode,
  flowPositions,
  arrangeFlow,
} from "./flow-layout.mjs";
import { StoryBoard } from "./story-board.mjs";
import { copyScenes, deleteScenes } from "./graph-commands.mjs";
import {
  visualClips,
  clipLength,
  mediaAt,
  ensureSequence,
  appendVisual,
  insertVisual,
  insertionPoint,
  moveVisual,
  trimVisual,
  splitClip,
  moveClip,
  reorderClip,
  removeClip,
  duplicateClip,
  linked,
} from "./timeline.mjs";
import {
  clone,
  uid,
  ms,
  sec,
  clamp,
  newProject,
  newScene,
  newEvent,
  migrate,
  validate,
  duration,
  references,
  targetsOf,
  gestures,
  endTarget,
} from "./model.mjs";
import { AssetStore } from "./assets.mjs";
import {
  Storage,
  esc,
  exportZip,
  importZip,
  LOCAL_KEY,
  response,
} from "./storage.mjs";
import { History } from "./history.mjs";
import { PlayerView } from "./player-view.mjs";
import { Session } from "./session.mjs";
import { demoProject } from "./demo.mjs";

const $ = (s) => document.querySelector(s),
  assets = new AssetStore();
let storage = new Storage(assets, status),
  history,
  selected,
  selection = { kind: "scene" },
  page = "story",
  graph = true,
  board,
  sceneViews = new Map(),
  sceneSearch = "",
  directoryOpen = localStorage.getItem("talespark-directory") === "true",
  inspectorOpen = true,
  openingPart = "background",
  openingSession,
  assetSearch = "",
  pendingDelete = [],
  newCardContext = null,
  connectionEdit = null,
  time = 0,
  zoom = 1.5,
  still,
  saveTimer,
  toastTimer,
  linkFrom = null,
  uploadContext = null,
  busy = false,
  dirty = false,
  previewSession;
const mediaLibrary = new AssetLibrary(assets, (id, kind) =>
  previewAsset(id, kind).catch((e) => notify(e.message)),
);
const sidebarLibrary = new AssetLibrary(
  assets,
  (id, kind) => previewAsset(id, kind).catch((e) => notify(e.message)),
  dragLibraryAsset,
);
let publishAfterConnect = false;
let projectRows = [];
let componentPlayer,
  previewAssetToken = 0;
const p = () => history.project,
  s = () => p().scenes.find((x) => x.id === selected) || p().scenes[0];
const get = (obj, path) => path.split(".").reduce((v, k) => v?.[k], obj);
function set(obj, path, value) {
  const parts = path.split(".");
  if (
    parts.some((key) => ["__proto__", "prototype", "constructor"].includes(key))
  )
    throw Error("字段无效");
  let at = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    at = at[key] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
  }
  at[parts.at(-1)] = value;
}
function notify(text) {
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function status(state, detail) {
  const el = $(".save-status");
  if (!el) return;
  el.classList.toggle(
    "error",
    ["error", "conflict", "保存失败"].includes(state),
  );
  el.textContent =
    {
      local: storage.token ? "待同步" : "已保存到本机",
      saving: "保存中…",
      saved: "已同步云端",
      upload: `↑ ${detail?.name || "素材"} · ${detail?.progress || 0}%`,
      conflict: "● 云端有其他修改 · 本机副本保留",
      error: "● 云端保存失败 · 可重试",
    }[state] || state;
  el.title = detail?.message || el.textContent;
}
function mutate(label, fn) {
  try {
    history.commit(label, fn);
  } catch (error) {
    notify(error.message);
    throw error;
  }
}
function changed() {
  dirty = true;
  try {
    storage.saveLocal(p());
  } catch (e) {
    notify(e.message);
    status("error", e);
  }
  render();
  clearTimeout(saveTimer);
  if (storage.token && !busy) saveTimer = setTimeout(sync, 1200);
}
async function sync() {
  clearTimeout(saveTimer);
  const errors = validate(p()).filter((x) => x.level === "error");
  if (errors.length) {
    status("● 已保留本机草稿 · 请修正配置");
    return;
  }
  if (!storage.token) {
    status("local");
    return;
  }
  await storage.queue.enqueue(p());
}
function field(
  label,
  path,
  value,
  {
    type = "text",
    options = null,
    millis = false,
    min,
    max,
    step,
    scope = "selection",
  } = {},
) {
  const attrs = `data-field="${esc(path)}" data-scope="${scope}" ${millis ? "data-ms" : ""}`;
  if (options)
    return `<label class="field">${label}<select ${attrs}>${Object.entries(
      options,
    )
      .map(
        ([k, v]) =>
          `<option value="${esc(k)}" ${String(value) === k ? "selected" : ""}>${esc(v)}</option>`,
      )
      .join("")}</select></label>`;
  if (type === "checkbox")
    return `<label class="field check"><input type="checkbox" ${attrs} ${value ? "checked" : ""}>${label}</label>`;
  if (type === "textarea")
    return `<label class="field">${label}<textarea ${attrs}>${esc(value)}</textarea></label>`;
  return `<label class="field">${label}<input ${attrs} type="${type}" value="${esc(millis ? sec(value) : value)}" ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} ${step !== undefined ? `step="${step}"` : ""}></label>`;
}
const seconds = (label, path, value) =>
  field(label, path, value, {
    type: "number",
    millis: true,
    min: 0,
    step: 0.1,
  });
function selectObject(project = p()) {
  const scene =
    project.scenes.find((x) => x.id === selected) || project.scenes[0];
  if (selection.kind === "clip")
    return (
      scene.clips?.find((x) => x.id === selection.id) ||
      visualClips(scene).find((x) => x.id === selection.id)
    );
  if (selection.kind === "overlay")
    return scene.overlays?.find((x) => x.id === selection.id);
  return selection.kind === "scene"
    ? scene
    : selection.kind === "video"
      ? scene.video
      : selection.kind === "image"
        ? scene.images.find((x) => x.id === selection.id)
        : selection.kind === "event"
          ? scene.events.find((x) => x.id === selection.id)
          : selection.kind === "subtitle"
            ? scene.subtitles.find((x) => x.id === selection.id)
            : selection.kind === "audio"
              ? scene.audio.find((x) => x.id === selection.id)
              : selection.kind === "effect"
                ? scene.effects.find((x) => x.id === selection.id)
                : scene;
}
function targetFields(label, path, t) {
  return `<h3>${label}</h3>${field("后续动作", path + ".kind", t.kind, { options: { continue: "继续当前视频", scene: "进入另一剧情段落", seek: "跳到当前视频位置", end: "结束作品", unlinked: "待连接", home: "返回开屏" } })}${t.kind === "scene" ? field("目标段落", path + ".sceneId", t.sceneId, { options: Object.fromEntries(p().scenes.map((x) => [x.id, x.name])) }) : t.kind === "seek" ? seconds("跳转到（秒）", path + ".timeMs", t.timeMs) : ""}`;
}
function conditionFields(path, c) {
  const vars = Object.keys(p().variables);
  return `<div class="card"><button data-action="condition" data-path="${path}">${c ? "移除条件" : "＋ 添加显示条件"}</button>${c ? field("变量", path + ".variable", c.variable, { options: Object.fromEntries(vars.map((k) => [k, k])) }) + field("比较方式", path + ".op", c.op, { options: { eq: "等于", ne: "不等于", gt: "大于", gte: "大于或等于", lt: "小于", lte: "小于或等于" } }) + variableValue("比较值", path + ".value", c.value, p().variables[c.variable]) : ""}</div>`;
}
function variableValue(label, path, value, sample) {
  return typeof sample === "boolean"
    ? field(label, path, value, { options: { true: "是", false: "否" } })
    : field(label, path, value, {
        type: typeof sample === "number" ? "number" : "text",
        step: 0.1,
      });
}
function actionFields(path, list) {
  return `<div class="card">${list.map((a, i) => `${field("改变变量", `${path}.${i}.variable`, a.variable, { options: Object.fromEntries(Object.keys(p().variables).map((k) => [k, k])) })}${field("操作", `${path}.${i}.op`, a.op, { options: typeof p().variables[a.variable] === "number" ? { set: "设为", add: "增加" } : { set: "设为" } })}${variableValue("数值", `${path}.${i}.value`, a.value, p().variables[a.variable])}<button data-action="remove-action" data-path="${path}" data-index="${i}">移除这个变量动作</button>`).join("")}<button data-action="add-action" data-path="${path}">＋ 结果改变变量</button></div>`;
}
function resultFields(label, path, r) {
  return (
    targetFields(label, path + ".target", r.target) +
    field("执行时机", path + ".timing", r.timing, {
      options: {
        immediate: "操作结束后立即执行",
        sceneEnd: "当前段落播完后执行",
      },
    }) +
    field("成功后结束当前慢放", path + ".restoreSpeed", r.restoreSpeed, {
      type: "checkbox",
    }) +
    actionFields(path + ".actions", r.actions)
  );
}
function shell() {
  $("#studio").innerHTML =
    '<header class="topbar"><div class="brand"><b>T</b>故事引擎 TaleSpark</div><span class="top-divider"></span><span class="project-name" aria-label="作品名称"></span><span class="save-status"></span><button data-action="undo" aria-label="撤销" title="撤销 Ctrl+Z">↶</button><button data-action="redo" aria-label="重做" title="重做 Ctrl+Shift+Z">↷</button><button data-action="save">保存</button><details class="more-menu general-menu"><summary aria-label="通用菜单" title="通用菜单">☰</summary><div><button data-action="import">导入作品</button><button data-action="export">导出备份</button><hr><button data-action="check-project">检查作品</button><button data-action="versions">发布历史</button><hr><button data-action="help">帮助与快捷键</button></div></details><button data-action="preview-all">▷ 完整试玩</button><button class="primary" data-action="publish">发布</button></header>\n<div class="layout"><nav class="rail"><button data-page="story" title="剧情画布"><b>⌘</b>画布</button><button data-page="assets" title="素材库"><b>▧</b>素材</button><button data-page="theme" title="作品设置"><b>⚙</b>设置</button><button class="bottom" data-action="projects" title="作品管理"><b>▦</b>作品</button></nav><aside class="library"></aside><main class="workspace"><div class="workspace-head"><button data-action="graph-view" class="back-button" title="返回剧情画布">← 画布</button><h1>剧情画布</h1><button data-action="canvas-view">进入编辑</button><button data-action="preview-current">▷ 试玩场景</button><details class="more-menu"><summary title="预览尺寸">预览设备</summary><div><button data-action="preview-desktop">桌面预览</button><button data-action="preview-portrait">手机竖屏</button><button data-action="preview-landscape">手机横屏</button></div></details></div><div class="story-work"><div class="canvas-label"><span></span></div><div class="canvas"><div class="player-root"></div></div><div class="board-list" hidden></div><div class="transport"><button data-action="preview-here" aria-label="从当前位置试玩">▷</button><span class="time-label"></span><input id="seek" type="range" min="0" step="10" aria-label="画面进度"><span class="duration-label"></span></div><div class="timeline-head"><span>时间轴</span><div class="clip-tools"><button data-action="split-clip" title="在播放头处分割">分割</button><button data-action="copy-item" title="复制选中内容">复制</button><button data-action="delete-item" title="删除选中内容">删除</button></div><label>缩放 <input id="zoom" type="range" min="1" max="8" step=".25" value="1.5"></label></div><div class="timeline-actions"><button data-action="upload-scene">＋ 素材</button><button data-action="add-qte">操作</button><button data-action="add-choice">选择</button><button data-action="add-hotspot">热点</button><button data-action="add-subtitle">字幕</button><button data-action="add-audio">音频</button><button data-action="add-overlay">叠加图片</button><details class="more-menu"><summary>效果</summary><div><button data-action="add-speed">慢放区间</button><button data-action="add-bars">电影黑边</button></div></details></div><div class="timeline-scroll"></div></div><div class="graph-area"><div class="graph-toptools"><button data-action="toggle-directory" title="搜索场景 / 场景目录">搜索</button><button class="primary" data-action="new-card">＋ 新建场景</button><div class="selection-tools"><button data-action="copy-scenes">复制</button><button data-action="delete-scenes">删除</button></div></div><div class="graph-scroll"><div class="graph-board"></div></div><div class="graph-bottomtools"><button data-action="pan-mode" title="拖动画布">✥</button><button data-action="select-mode" title="框选">▱</button><span></span><button data-action="zoom-out" aria-label="缩小画布">−</button><button data-action="reset-zoom" id="graph-scale" title="恢复 100%">100%</button><button data-action="zoom-in" aria-label="放大画布">＋</button><button data-action="fit-graph">显示全部</button><button data-action="toggle-lines">全部连线</button><button data-action="toggle-minimap">小地图</button><button data-action="arrange-graph" title="按剧情关系整理全部">自动排列</button><button data-action="arrange-selection" title="只整理选中节点">整理选中</button><button data-action="locate-entry" title="定位入口">定位起始剧情</button></div><div class="minimap" title="点击定位场景"></div></div><div class="opening-work" hidden><div class="opening-preview"></div><div class="opening-transport"><button data-action="opening-play">▷ 播放</button><input type="range" id="opening-seek" min="0" max="100" step="0.01" value="0" aria-label="开场视频进度"><span class="opening-time">0.0s</span></div></div><div class="settings-page" hidden></div></main><aside class="inspector"></aside></div>';
  still = new PlayerView($(".canvas .player-root"), assets, {
    editing: true,
    onSelect: (id, kind = "event") => {
      selection = { kind, id };
      renderInspector();
      renderTimeline();
    },
  });
  $(".canvas").addEventListener("dragover", (e) => {
    e.preventDefault();
    $(".canvas").classList.add("drop");
  });
  $(".canvas").addEventListener("dragleave", () =>
    $(".canvas").classList.remove("drop"),
  );
  $(".canvas").addEventListener("drop", (e) => {
    e.preventDefault();
    $(".canvas").classList.remove("drop");
    if (e.dataTransfer.files.length)
      importFiles([...e.dataTransfer.files], {
        mode: "scene",
        sceneId: selected,
      });
  });
  $("#seek").oninput = (e) => {
    time = Number(e.target.value);
    paintStill();
    updatePlayhead();
  };
  $("#zoom").oninput = (e) => {
    zoom = +e.target.value;
    renderTimeline();
  };
  $(".timeline-scroll").addEventListener("pointerdown", timelinePointer);
  $(".timeline-scroll").addEventListener("keydown", timelineKey);
  $(".canvas").addEventListener("pointerdown", canvasPointer);
  setupBoard();
  $(".library").addEventListener("dragstart", (e) => {
    const item = e.target.closest("[data-scene]");
    if (item) e.dataTransfer.setData("text/plain", item.dataset.scene);
  });
  $(".library").addEventListener("dragover", (e) => e.preventDefault());
  $(".library").addEventListener("drop", (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain"),
      to = e.target.closest("[data-scene]")?.dataset.scene;
    if (!id || !to || id === to) return;
    mutate("调整段落顺序", (p) => {
      const i = p.scenes.findIndex((x) => x.id === id),
        j = p.scenes.findIndex((x) => x.id === to);
      if (i >= 0 && j >= 0) p.scenes.splice(j, 0, p.scenes.splice(i, 1)[0]);
    });
  });
}
function render() {
  for (const action of ["undo", "redo"]) {
    const button =
      $(".graph-bottomtools [data-action=" + action + "]") ||
      $(".topbar [data-action=" + action + "]");
    if (button && !$(".workspace-head [data-action=" + action + "]"))
      $(".workspace-head").append(button.cloneNode(true));
  }
  const menu = $(".general-menu");
  const menuHost =
    page === "story" && graph ? $(".graph-toptools") : $(".workspace-head");
  if (menu.parentElement !== menuHost) {
    menu.removeAttribute("open");
    menuHost.prepend(menu);
  }
  for (const a of ["redo", "undo"]) {
    const b = $(".topbar [data-action=" + a + "]");
    if (b) $(".graph-bottomtools").prepend(b);
  }
  if (!p().scenes.some((x) => x.id === selected)) selected = p().entryId;
  if (!selectObject()) selection = { kind: "scene" };
  time = clamp(time, 0, duration(s()));
  $(".project-name").textContent = p().name;
  $(".project-name").title = p().name;
  document.title = `${p().name} · 故事引擎 TaleSpark`;
  document
    .querySelectorAll('[data-action="undo"]')
    .forEach((b) => (b.disabled = !history.past.length));
  document
    .querySelectorAll('[data-action="redo"]')
    .forEach((b) => (b.disabled = !history.future.length));
  document
    .querySelectorAll("[data-page]")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        b.dataset.page === page ||
          (b.dataset.page === "theme" && page === "variables"),
      ),
    );
  const isOpening = page === "loading" || page === "splash";
  document.body.dataset.directory = String(directoryOpen);
  document.body.dataset.inspector = String(inspectorOpen);
  $(".opening-work").hidden = !isOpening;
  if (!isOpening) openingSession?.dispose();
  renderLibrary();
  document.body.dataset.view =
    page === "story"
      ? graph
        ? "graph"
        : "scene"
      : isOpening
        ? "opening"
        : "settings";
  $(".workspace-head").hidden = page === "story" && graph;
  $(".workspace-head h1").textContent =
    page === "story"
      ? graph
        ? "剧情画布"
        : s().name
      : {
          assets: "素材库",
          loading: "加载页面",
          splash: "开屏动画",
          variables: "剧情变量",
          theme: "作品设置",
        }[page];
  if (page === "story" && graph) still.pauseMedia();
  $(".graph-area").hidden = page !== "story" || !graph;
  $('[data-action="graph-view"]').hidden = page === "story" && graph;
  $('[data-action="canvas-view"]').hidden = page !== "story" || !graph;
  $(".story-work").hidden = page !== "story" || graph;
  $(".graph-scroll").hidden = page !== "story" || !graph;
  $(".settings-page").hidden = page === "story" || isOpening;
  $('[data-action="preview-current"]').textContent =
    page === "story" ? "▷ 试玩场景" : "▷ 预览";
  $('[data-action="canvas-view"]').classList.toggle("active", !graph);
  $('[data-action="graph-view"]').classList.toggle("active", graph);
  if (page === "story") {
    if (graph) renderGraph();
    else {
      renderTimeline();
      paintStill();
    }
  } else if (isOpening) renderOpening();
  else renderSettings();
  renderInspector();
}
function paintStill() {
  if (page !== "story" || graph) return;
  $(".canvas-label span").textContent = s().name;
  $(".time-label").textContent = (time / 1000).toFixed(1) + "s";
  $(".duration-label").textContent = (duration(s()) / 1000).toFixed(1) + "s";
  $("#seek").max = duration(s());
  $("#seek").value = time;
  still
    .renderStill(
      p(),
      s(),
      time,
      selection.kind === "event" ? selection.id : null,
    )
    .catch((e) => notify(e.message));
  $(".board-list").innerHTML = s()
    .images.map(
      (f, i) =>
        `<button class="board-chip ${selection.id === f.id ? "selected" : ""}" data-select-kind="image" data-select-id="${f.id}" title="${esc(p().assets[f.assetId]?.name)}">${i + 1} · ${esc(p().assets[f.assetId]?.name)} · ${sec(f.durationMs)}s</button>`,
    )
    .join("");
}
function items() {
  const scene = s(),
    list = [];
  if (scene.source === "sequence") {
    for (const c of scene.clips)
      list.push({
        id: c.id,
        kind: "clip",
        start: c.startMs,
        end: c.startMs + clipLength(c),
        label: p().assets[c.assetId]?.name || "画面",
      });
  } else if (scene.source === "images") {
    let start = 0;
    for (const f of scene.images) {
      list.push({
        id: f.id,
        kind: "image",
        start,
        end: start + f.durationMs,
        label: p().assets[f.assetId]?.name || "图片",
      });
      start += f.durationMs;
    }
  } else if (scene.video)
    list.push({
      id: scene.video.id,
      kind: "video",
      start: 0,
      end: duration(scene),
      label: p().assets[scene.video.assetId]?.name || "视频",
    });
  for (const [key, kind] of [
    ["events", "event"],
    ["subtitles", "subtitle"],
    ["audio", "audio"],
    ["effects", "effect"],
    ["overlays", "overlay"],
  ])
    for (const x of scene[key] || [])
      list.push({
        id: x.id,
        kind,
        start: x.startMs,
        end: x.endMs,
        label:
          kind === "event"
            ? x.kind === "choice"
              ? "分支选择"
              : x.kind === "hotspot"
                ? "画面热点"
                : gestures[x.gesture]
            : kind === "subtitle"
              ? x.text
              : ["audio", "overlay"].includes(kind)
                ? p().assets[x.assetId]?.name
                : x.kind === "speed"
                  ? `${x.value} 倍速`
                  : "电影黑边",
      });
  return list;
}
function renderTimeline() {
  if (page !== "story") return;
  const d = timelineSpan();
  const groups = [
    ["画面", ["video", "image", "clip"]],
    ["互动", ["event"]],
    ["字幕", ["subtitle"]],
    ["叠加", ["overlay"]],
    ["音频", ["audio"]],
    ["播放速度", ["effect"], "speed"],
    ["电影黑边", ["effect"], "bars"],
  ];
  $(".timeline-scroll").innerHTML =
    `<div class="timeline-inner" style="width:${zoom * 100}%"><div class="ruler">${[0, 0.25, 0.5, 0.75, 1].map((n) => `<span style="left:${n * 100}%">${((d * n) / 1000).toFixed(1)}s</span>`).join("")}</div>${groups
      .filter(
        ([name, kinds, effectKind]) =>
          name === "画面" ||
          name === "互动" ||
          name === "音频" ||
          name === "叠加" ||
          items().some(
            (x) =>
              kinds.includes(x.kind) &&
              (!effectKind ||
                s().effects.find((e) => e.id === x.id)?.kind === effectKind),
          ),
      )
      .map(
        ([name, kinds, effectKind]) =>
          `<div class="track" data-track="${kinds[0]}"><div class="track-label">${name}</div><div class="lane">${items()
            .filter(
              (x) =>
                kinds.includes(x.kind) &&
                (!effectKind ||
                  s().effects.find((e) => e.id === x.id)?.kind === effectKind),
            )
            .map(
              (x) =>
                `<div tabindex="0" role="button" aria-label="${esc(x.label)}" data-clip="${x.id}" data-kind="${x.kind}" class="clip ${x.kind} ${selection.id === x.id ? "selected" : ""}" style="left:${(x.start / d) * 100}%;width:${Math.max(0.6, ((x.end - x.start) / d) * 100)}%" title="${esc(x.label)} · ${sec(x.start)}—${sec(x.end)} 秒"><i class="handle left" data-edge="left"></i>${esc(x.label)}<i class="handle right" data-edge="right"></i></div>`,
            )
            .join("")}</div></div>`,
      )
      .join("")}<div class="playhead"></div></div>`;
  updatePlayhead();
}
function updatePlayhead() {
  const line = $(".playhead");
  if (line)
    line.style.left = `calc(73px + (100% - 73px) * ${time / timelineSpan()})`;
  $(".time-label").textContent = sec(time).toFixed(1) + "s";
}
function renderInspector() {
  if (page === "story" && graph && board?.activeEdge) {
    renderEdgeInspector(board.activeEdge);
    return;
  }
  if (
    page === "story" &&
    graph &&
    specialNode([...(board?.selected || [])][0])
  ) {
    const id = [...board.selected][0];
    $(".inspector").innerHTML =
      `<h2>${id === LOADING ? "加载" : "开屏"}</h2><button data-action="edit-special">进入编辑</button><p class="muted">${id === LOADING ? "准备完成后进入开屏" : "点击开始后进入起始剧情"}</p>`;
    return;
  }
  if (page === "loading" || page === "splash") {
    renderOpeningInspector();
    return;
  }
  let html = "<h2>属性设置</h2>",
    obj = selectObject(),
    scene = s();
  if (page === "story" && selection.kind === "clip") {
    html =
      "<h2>画面片段</h2>" +
      field("素材", "assetId", obj.assetId, {
        options: Object.fromEntries(
          Object.values(p().assets)
            .filter((a) => a.kind === obj.kind)
            .map((a) => [a.id, a.name]),
        ),
      }) +
      seconds("场景开始（秒）", "startMs", obj.startMs) +
      seconds("素材入点（秒）", "inMs", obj.inMs) +
      seconds("素材出点（秒）", "outMs", obj.outMs) +
      '<div class="mini-actions"><button data-action="clip-before">前移</button><button data-action="clip-after">后移</button><button data-action="split-clip">分割</button><button data-action="copy-item">复制</button><button data-action="delete-item">删除</button></div>';
  } else if (page === "story" && selection.kind === "overlay") {
    html =
      "<h2>叠加图片</h2>" +
      seconds("出现时间（秒）", "startMs", obj.startMs) +
      seconds("结束时间（秒）", "endMs", obj.endMs) +
      field("横向位置 %", "x", obj.x, { type: "number", min: 0, max: 100 }) +
      field("纵向位置 %", "y", obj.y, { type: "number", min: 0, max: 100 }) +
      field("宽度 %", "width", obj.width, {
        type: "number",
        min: 1,
        max: 100,
      }) +
      '<button data-action="delete-item">删除图片</button>';
  } else if (page !== "story") {
    html += "";
  } else if (selection.kind === "scene")
    html +=
      field("段落名称", "name", scene.name) +
      field("剧情提示", "subtitle", scene.subtitle, { type: "textarea" }) +
      field("段落用途", "role", scene.role, {
        options: { story: "剧情", death: "死亡 / 失败", ending: "结局" },
      }) +
      field("纯画面呈现", "clean", scene.clean, { type: "checkbox" }) +
      field("灰度画面", "grayscale", scene.grayscale, { type: "checkbox" }) +
      field("待配置（发布前需处理）", "pending", scene.pending, {
        type: "checkbox",
      }) +
      `<h3>播放内容</h3>` +
      field("画面来源", "source", scene.source, {
        options:
          scene.source === "sequence"
            ? { sequence: "时间轴片段" }
            : { video: "视频", images: "分镜图片序列" },
      }) +
      `<button class="full" data-action="upload-scene">＋ 添加视频 / 图片</button><button class="full" data-action="video-link">从视频直链导入</button>${scene.video ? `<button class="full" data-select-kind="video" data-select-id="${scene.video.id}">编辑视频入点 / 出点</button>` : visualClips(scene).length ? "" : seconds("空场景时长（秒）", "durationMs", scene.durationMs)}${targetFields("播放结束后", "next", scene.next)}<button class="full danger" data-action="delete-scene">删除当前段落</button>`;
  else if (selection.kind === "video")
    html +=
      "<h3>视频片段</h3>" +
      `<p class="muted">${esc(p().assets[obj.assetId]?.name)}</p>` +
      seconds("原视频入点（秒）", "inMs", obj.inMs) +
      seconds("原视频出点（秒）", "outMs", obj.outMs) +
      '<p class="muted">调整播放范围不会改写原文件。请检查字幕、互动和效果是否仍在有效范围内。</p><button class="full" data-action="upload-scene">替换视频</button>';
  else if (selection.kind === "image")
    html +=
      "<h3>分镜图片</h3>" +
      `<p class="muted">${esc(p().assets[obj.assetId]?.name)}</p>` +
      seconds("展示时长（秒）", "durationMs", obj.durationMs) +
      '<div class="mini-actions"><button data-action="image-up">上移</button><button data-action="image-down">下移</button><button data-action="image-copy">复制</button><button data-action="image-replace">替换</button><button data-action="image-insert">在后面添加</button></div><button class="full danger" data-action="delete-item">删除分镜</button>';
  else if (selection.kind === "event") {
    html +=
      "<h3>视频内互动</h3>" +
      field("互动类型", "kind", obj.kind, {
        options: { qte: "动作操作", choice: "分支选择", hotspot: "画面热点" },
      }) +
      `<div class="two">${seconds("出现时间（秒）", "startMs", obj.startMs)}${seconds("区间结束（秒）", "endMs", obj.endMs)}</div>` +
      field("结束规则", "endMode", obj.endMode, {
        options: {
          clock: "独立倒计时",
          range: "到视频指定位置",
          wait: "一直等待",
        },
      }) +
      (obj.endMode === "clock"
        ? seconds("实际操作时限（秒）", "timeoutMs", obj.timeoutMs)
        : "") +
      field("出现时暂停画面", "pause", obj.pause, { type: "checkbox" }) +
      conditionFields("condition", obj.condition);
    if (obj.kind !== "choice")
      html +=
        field("动作提示", "hint", obj.hint) +
        field("操作方式", "gesture", obj.gesture, { options: gestures }) +
        (obj.gesture === "hold"
          ? seconds("长按时长（秒）", "holdMs", obj.holdMs)
          : obj.gesture === "multi"
            ? field("点击次数", "clicks", obj.clicks, {
                type: "number",
                min: 1,
                max: 30,
                step: 1,
              })
            : ["up", "down", "left", "right"].includes(obj.gesture)
              ? field("滑动距离（像素）", "distance", obj.distance, {
                  type: "number",
                  min: 10,
                  max: 400,
                })
              : "") +
        `<div class="two">${field("横向位置 %", "x", obj.x, { type: "number", min: 0, max: 100, step: 0.1 })}${field("纵向位置 %", "y", obj.y, { type: "number", min: 0, max: 100, step: 0.1 })}</div>` +
        field("提示大小 %", "scale", obj.scale, {
          type: "number",
          min: 40,
          max: 180,
          step: 5,
        }) +
        field("操作音效", "sound", obj.sound, {
          options: { heartbeat: "心跳与机械反馈", off: "关闭" },
        }) +
        field("音效音量", "volume", obj.volume, {
          type: "number",
          min: 0,
          max: 1,
          step: 0.05,
        }) +
        resultFields("成功后", "success", obj.success) +
        resultFields("失败 / 超时后", "failure", obj.failure);
    else
      html +=
        obj.options
          .map(
            (o, i) =>
              `<div class="option-card"><h4>选项 ${i + 1}</h4>${field("选项文字", `options.${i}.text`, o.text)}${targetFields("选择后", `options.${i}.target`, o.target)}<div class="two">${field("水平偏移 %", `options.${i}.x`, o.x, { type: "number", step: 0.1, min: -100, max: 100 })}${field("垂直偏移 %", `options.${i}.y`, o.y, { type: "number", step: 0.1, min: -100, max: 100 })}</div>${conditionFields(`options.${i}.condition`, o.condition)}${actionFields(`options.${i}.actions`, o.actions)}<button data-action="delete-option" data-id="${o.id}">删除选项</button></div>`,
          )
          .join("") +
        '<button class="full" data-action="add-option">＋ 添加选项</button>' +
        (obj.endMode !== "wait"
          ? resultFields("超时后", "failure", obj.failure)
          : "");
    html +=
      '<p class="muted">互动 UI：' +
      esc(
        UI_COMPONENTS.find((c) => c.id === obj.uiComponent)?.name || "作品默认",
      ) +
      '</p><button data-action="choose-ui">更换互动 UI</button>';
    html +=
      '<button class="full danger" data-action="delete-item">删除互动</button>';
  } else if (["subtitle", "audio", "effect"].includes(selection.kind)) {
    html += `<h3>${{ subtitle: "字幕", audio: "音频", effect: "画面效果" }[selection.kind]}</h3><div class="two">${seconds("开始（秒）", "startMs", obj.startMs)}${seconds("结束（秒）", "endMs", obj.endMs)}</div>`;
    if (selection.kind === "subtitle")
      html +=
        field("字幕内容", "text", obj.text, { type: "textarea" }) +
        field("文字颜色", "color", obj.color, { type: "color" }) +
        field("字号（以 1920 宽画面为准）", "size", obj.size, {
          type: "number",
          min: 12,
          max: 80,
        }) +
        field("横向位置 %", "x", obj.x, { type: "number", min: 0, max: 100 }) +
        field("纵向位置 %", "y", obj.y, { type: "number", min: 0, max: 100 }) +
        field("半透明文字底色", "background", obj.background, {
          type: "checkbox",
        });
    if (selection.kind === "audio")
      html +=
        field("使用音频", "assetId", obj.assetId, {
          options: Object.fromEntries(
            Object.values(p().assets)
              .filter((a) => a.kind === "audio")
              .map((a) => [a.id, a.name]),
          ),
        }) +
        seconds("音频入点（秒）", "inMs", obj.inMs) +
        field("音量", "volume", obj.volume, {
          type: "number",
          min: 0,
          max: 1,
          step: 0.05,
        });
    if (selection.kind === "effect")
      html +=
        field("效果", "kind", obj.kind, {
          options: { speed: "播放速度 / 慢放", bars: "电影黑边" },
        }) +
        field(
          obj.kind === "speed" ? "倍速" : "单侧黑边高度 %",
          "value",
          obj.value,
          {
            type: "number",
            min: obj.kind === "speed" ? 0.0625 : 0,
            max: obj.kind === "speed" ? 4 : 30,
            step: obj.kind === "speed" ? 0.05 : 1,
          },
        );
    html +=
      '<button class="full danger" data-action="delete-item">删除当前内容</button>';
  }
  const issues = validate(p()).filter(
    (x) => !x.sceneId || x.sceneId === selected,
  );
  const critical = issues.filter((x) => x.level === "error");
  if (critical.length)
    html += `<div class="issues"><strong>当前检查</strong>${critical
      .slice(0, 8)
      .map((x) => `<p>${x.level === "error" ? "●" : "△"} ${esc(x.message)}</p>`)
      .join("")}</div>`;
  if (
    page === "story" &&
    ["event", "subtitle", "audio", "effect", "overlay"].includes(selection.kind)
  )
    html += field("跟随画面片段", "linkedClipId", obj.linkedClipId || "", {
      options: {
        "": "独立",
        ...Object.fromEntries(
          visualClips(scene).map((c) => [
            c.id,
            p().assets[c.assetId]?.name || "片段",
          ]),
        ),
      },
    });
  if (page === "story" && graph && selection.kind === "scene")
    html =
      "<h2>场景</h2>" +
      field("名称", "name", scene.name) +
      field("用途", "role", scene.role, {
        options: { story: "剧情", ending: "结局", death: "失败" },
      }) +
      '<div class="mini-actions"><button data-action="set-entry">设为起始剧情</button></div>' +
      "<h3>出口</h3>" +
      ports(scene)
        .map(
          (port) =>
            '<button class="full connection-button" data-action="edit-connection" data-path="' +
            port.path +
            '">' +
            esc(port.label) +
            " → " +
            esc(
              port.target.kind === "scene"
                ? p().scenes.find((x) => x.id === port.target.sceneId)?.name ||
                    "缺失"
                : {
                    end: "结束",
                    continue: "继续",
                    unlinked: "待连接",
                    seek: "定位",
                  }[port.target.kind],
            ) +
            "</button>",
        )
        .join("") +
      '<div class="mini-actions"><button data-action="copy-scenes">复制</button><button class="danger" data-action="delete-scenes">删除</button></div>';
  if (page === "story" && graph && critical.length)
    html += `<div class="issues">${critical.map((x) => `<p>${esc(x.message)}</p>`).join("")}</div>`;
  $(".inspector").innerHTML = html;
  if (page === "story" && !graph && selection.kind === "scene") {
    const host = $(".inspector"),
      disclosure = document.createElement("details");
    disclosure.innerHTML = "<summary>场景显示设置</summary>";
    for (const path of ["subtitle", "role", "clean", "grayscale", "pending"]) {
      const field = host
        .querySelector(`[data-field="${path}"]`)
        ?.closest(".field");
      if (field) disclosure.append(field);
    }
    host.querySelector("h2").after(disclosure);
    const source = host.querySelector('[data-field="source"]');
    if (source?.options.length === 1) source.closest(".field").remove();
  }
}
function renderSettings() {
  const box = $(".settings-page");
  if (page === "theme") {
    box.innerHTML =
      '<h2>作品设置</h2><div class="settings-links"><button data-page="variables">剧情变量</button></div>';
    return;
  }
  if (page === "assets") {
    mediaLibrary.mount(box, p());
    return;
  }
  if (page === "variables") {
    box.innerHTML = `<h2>剧情变量</h2><button data-action="add-variable">＋ 新建变量</button>${Object.entries(
      p().variables,
    )
      .map(
        ([key, value]) =>
          `<div class="card"><strong>${esc(key)}</strong>${field("初始值", `variables.${key}`, value, { scope: "project", type: typeof value === "number" ? "number" : "text", options: typeof value === "boolean" ? { true: "是", false: "否" } : null })}<button data-action="delete-variable" data-id="${esc(key)}">删除变量</button></div>`,
      )
      .join("")}`;
    return;
  }
  const c = p()[page],
    scope = page;
  box.innerHTML =
    `<h2>${page === "loading" ? "玩家进入作品时的加载页面" : "开始剧情前的循环开屏"}</h2>` +
    field("标题", "title", c.title, { scope }) +
    field("副标题", "subtitle", c.subtitle, { scope }) +
    field("背景视频", "video", c.video || "", {
      scope,
      options: {
        "": "不使用视频",
        ...Object.fromEntries(
          Object.values(p().assets)
            .filter((a) => a.kind === "video")
            .map((a) => [a.id, a.name]),
        ),
      },
    }) +
    (page === "loading"
      ? field("背景图片", "image", c.image || "", {
          scope,
          options: {
            "": "不使用图片",
            ...Object.fromEntries(
              Object.values(p().assets)
                .filter((a) => a.kind === "image")
                .map((a) => [a.id, a.name]),
            ),
          },
        }) +
        field("加载提示", "text", c.text, { scope }) +
        field("进度颜色", "color", c.color, { scope, type: "color" }) +
        field("最少展示秒数", "minimumMs", c.minimumMs, {
          scope,
          type: "number",
          millis: true,
          min: 0,
          max: 30,
          step: 0.1,
        }) +
        field("标题排布", "titleLayout", c.titleLayout, {
          scope,
          options: { square: "方形排布", normal: "单行排布" },
        })
      : field("文字入场效果", "effect", c.effect, {
          scope,
          options: { fade: "淡入", zoom: "缓慢放大", none: "直接显示" },
        })) +
    `<button data-action="upload-opening">＋ 上传 / 替换背景素材</button><p class="muted">${page === "loading" ? "" : "视频循环播放，玩家点击或按键后进入明确的开始段落。"}</p>`;
}
function ports(scene) {
  const list = [{ path: "next", label: "播放结束", target: scene.next }];
  scene.events.forEach((e, i) => {
    if (e.kind === "choice")
      e.options.forEach((o, j) =>
        list.push({
          path: `events.${i}.options.${j}.target`,
          label: `${sec(e.startMs)}s · ${o.text}`,
          target: o.target,
        }),
      );
    else
      list.push({
        path: `events.${i}.success.target`,
        label: `${sec(e.startMs)}s · ${gestures[e.gesture]}成功`,
        target: e.success.target,
      });
    if (e.kind !== "choice" || e.endMode !== "wait")
      list.push({
        path: `events.${i}.failure.target`,
        label: `${sec(e.startMs)}s · 失败 / 超时`,
        target: e.failure.target,
      });
  });
  return list;
}
function renderGraph() {
  board.render(p(), selected);
}

function clearAssetPreview() {
  previewAssetToken++;
  componentPlayer?.dispose();
  componentPlayer = null;
  $(".panel-content")
    .querySelectorAll("video,audio")
    .forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
}
function panel(html) {
  clearAssetPreview();
  $(".panel-content").innerHTML = html;
  if (!$("#panel").open) $("#panel").showModal();
}
function closePanel() {
  publishAfterConnect = false;
  newCardContext = null;
  clearAssetPreview();
  $("#panel").close();
  if (board) board.pending = null;
}
async function saveCurrent() {
  try {
    storage.saveLocal(p());
  } catch (error) {
    status("保存失败", error);
    throw error;
  }
  if (storage.token) {
    await sync();
    if (storage.queue.stopped && storage.queue.pending)
      throw Error("本机已保存，云端同步失败，请重试");
  }
}
async function adopt(project, revision = "none", backup = true) {
  if (history && backup) {
    if (project.id === p().id && revision !== storage.queue.revision)
      storage.saveLocal(p());
    else await saveCurrent();
  }
  clearTimeout(saveTimer);
  storage.queue.pending = null;
  storage.queue.stopped = true;
  if (storage.queue.running) await storage.queue.running;
  if (history && backup) storage.backup(p(), "切换作品前");
  history = new History(project, changed);
  selected = project.entryId;
  selection = { kind: "scene" };
  page = "story";
  graph = true;
  board.selected.clear();
  time = 0;
  storage = new Storage(assets, status);
  storage.queue.revision = revision;
  storage.saveLocal(project);
  dirty = false;
  render();
}
async function boot() {
  let project,
    revision = "none";
  const saved = storage.readLocal();
  if (saved?.project) {
    try {
      project = migrate(saved.project);
      revision = saved.revision || "none";
    } catch (e) {
      notify("上次草稿无法读取，已保留原始数据");
    }
  }
  if (!project) {
    try {
      const old = JSON.parse(localStorage.getItem("storyforge-project"));
      if (old) {
        storage.backup(old, "升级前原始项目");
        project = migrate(old);
      }
    } catch {}
  }
  if (!project) {
    try {
      const release = await storage.published();
      project = migrate(release.project);
    } catch {
      try {
        const legacy = await storage.legacy();
        storage.backup(legacy.project, "云端旧作品原始数据");
        project = migrate(legacy.project);
      } catch {
        project = demoProject();
      }
    }
  }
  if (storage.token && !saved) {
    try {
      const draft = await storage.draft(project.id);
      project = migrate(draft.project);
      revision = draft.revision;
    } catch {}
  }
  history = new History(project, changed);
  selected = project.entryId;
  shell();
  storage.queue.revision = revision;
  storage.saveLocal(project);
  render();
  status("已保存到本机");
}
async function preview({ full = false, here = false } = {}) {
  const errors = validate(p()).filter((x) => x.level === "error");
  if (errors.length) {
    showIssues(false);
    return;
  }
  previewSession?.dispose();
  previewSession = new Session($(".preview-host"), assets, {
    editor: true,
    onExit: () => $("#preview").close(),
  });
  $("#preview").showModal();
  const previewPage =
    page === "story" && graph && specialNode([...board.selected][0])
      ? [...board.selected][0] === LOADING
        ? "loading"
        : "splash"
      : page;
  if (!full && previewPage === "splash") {
    previewSession.project = clone(p());
    await previewSession.home();
  } else
    await previewSession.open(
      p(),
      !full && previewPage === "loading"
        ? { only: "loading" }
        : full
          ? {}
          : { sceneId: selected, time: here ? time : 0 },
    );
}
async function previewAsset(id, kind) {
  if (kind === "ui") {
    const c = UI_COMPONENTS.find((c) => c.id === id);
    panel(
      "<h2>" +
        esc(c.name) +
        ' <small>第 1 版</small></h2><div class="component-controls"><select id="component-device" aria-label="预览设备"><option value="desktop">电脑</option><option value="portrait">手机竖屏</option><option value="landscape">手机横屏</option></select><select id="component-background" aria-label="预览背景"><option value="dark">深色背景</option><option value="light">浅色背景</option></select><button id="component-replay">重新试用</button><button id="component-success">成功效果</button><button id="component-failure">失败效果</button><button id="component-sound">声音开</button></div><div class="component-preview" data-device="desktop"><div class="player-root"></div></div><p class="muted">直接操作预览中的按钮；暂停、重试可使用左上角设置。</p><button class="primary" data-action="use-ui" data-id="' +
        esc(id) +
        '">添加到当前场景</button>',
    );
    componentPlayer = new PlayerView(
      $(".component-preview .player-root"),
      assets,
    );
    const player = componentPlayer;
    await player.start(componentDemo(id));
    if (componentPlayer !== player) return;
    $("#component-replay").onclick = () => player.start(componentDemo(id));
    $("#component-success").onclick = () => {
      if (!player.runtime?.active) {
        notify("请先点击重新试用");
        return;
      }
      player.runtime.resolve(true, player.runtime.active.event.options[0]?.id);
    };
    $("#component-failure").onclick = () => {
      if (!player.runtime?.active) {
        notify("请先点击重新试用");
        return;
      }
      player.runtime.resolve(false);
    };
    $("#component-device").onchange = (e) =>
      ($(".component-preview").dataset.device = e.target.value);
    $("#component-background").onchange = (e) =>
      ($(".component-preview").dataset.background = e.target.value);
    $("#component-sound").onclick = (e) => {
      player.root.querySelector('[data-player="sound"]').click();
      e.target.textContent = player.muted ? "声音关" : "声音开";
    };
    return;
  }
  const a = p().assets[id];
  if (!a) throw Error("素材不存在");
  panel(
    "<h2>" +
      esc(a.name) +
      '</h2><div class="media-preview">正在读取…</div><p class="muted">' +
      esc(
        [
          a.width && a.height ? a.width + " × " + a.height : "",
          a.durationMs ? (a.durationMs / 1000).toFixed(1) + " 秒" : "",
          a.size ? (a.size / 1024 / 1024).toFixed(2) + " MB" : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ) +
      '</p><button class="primary" data-action="use-asset" data-id="' +
      esc(id) +
      '">添加到当前场景</button>',
  );
  const token = previewAssetToken,
    url = await assets.url(a);
  if (token !== previewAssetToken || !$("#panel").open) return;
  const media = document.createElement(a.kind === "image" ? "img" : a.kind);
  media.src = url;
  if (a.kind === "image") {
    media.alt = a.name;
    media.onclick = () => media.classList.toggle("actual-size");
    media.title = "点击切换原尺寸";
  } else {
    media.controls = true;
    media.preload = "metadata";
    media.playsInline = true;
  }
  media.onerror = () => {
    if (token === previewAssetToken)
      $(".media-preview").textContent = "无法预览，请检查素材或重新上传";
  };
  $(".media-preview").replaceChildren(media);
}
function showIssues(publishing) {
  const issues = validate(p(), { publish: publishing });
  panel(
    `<h2>${publishing ? "发布前检查" : "作品检查"}</h2>${issues.length ? issues.map((x) => `<p>${x.level === "error" ? "● 必须修复" : "△ 提醒"}：${esc(x.message)} ${x.sceneId ? `<button data-action="locate" data-id="${x.sceneId}">定位</button>` : ""}</p>`).join("") : "<p>配置检查通过。发布时还会验证素材和独立运行端读取。</p>"}${publishing && !issues.some((x) => x.level === "error") ? '<button class="primary" data-action="confirm-publish">检查素材并发布此版本</button>' : ""}`,
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function addAssetToScene(project, scene, asset, after = null) {
  project.assets[asset.id] = asset;
  if (["video", "image"].includes(asset.kind)) {
    appendVisual(scene, asset);
  } else {
    const len = Math.min(asset.durationMs || 3000, duration(scene) - time);
    if (len > 0)
      scene.audio.push({
        id: uid("audio"),
        assetId: asset.id,
        startMs: time,
        endMs: time + len,
        inMs: 0,
        volume: 0.5,
      });
  }
}
function placeTimelineAsset(asset, at, track, scene = s()) {
  p().assets[asset.id] = asset;
  if (
    asset.kind === "video" ||
    (asset.kind === "image" && track !== "overlay")
  ) {
    const c = insertVisual(scene, asset, at);
    return { kind: "clip", id: c.id };
  }
  const d = duration(scene),
    start = clamp(at, 0, Math.max(0, d - 100));
  if (asset.kind === "image") {
    const x = {
      id: uid("overlay"),
      assetId: asset.id,
      startMs: start,
      endMs: Math.min(d, start + 3000),
      x: 50,
      y: 50,
      width: 35,
    };
    scene.overlays.push(x);
    return { kind: "overlay", id: x.id };
  }
  const x = {
    id: uid("audio"),
    assetId: asset.id,
    startMs: start,
    endMs: Math.min(d, start + (asset.durationMs || 3000)),
    inMs: 0,
    volume: 0.5,
  };
  scene.audio.push(x);
  return { kind: "audio", id: x.id };
}
async function importFiles(files, context = { mode: "library" }) {
  if (busy) {
    notify("请等待当前素材任务完成");
    return;
  }
  busy = true;
  clearTimeout(saveTimer);
  const added = [];
  let failed = null;
  try {
    if (
      ["replace", "image-replace"].includes(context.mode) &&
      files.length !== 1
    )
      throw Error("替换时请选择一个素材");
    for (let i = 0; i < files.length; i++) {
      status("upload", {
        name: files[i].name,
        progress: Math.round((i / files.length) * 100),
      });
      try {
        added.push(await assets.import(files[i]));
      } catch (e) {
        failed = e;
        break;
      }
    }
    if (
      context.mode === "replace" &&
      added[0] &&
      p().assets[context.assetId].kind !== added[0].kind
    )
      throw Error("替换素材类型不一致");
    if (context.mode === "opening" && added.some((a) => a.kind === "audio"))
      throw Error("开场背景请选择图片或视频");
    if (added.length)
      mutate("导入素材", (project) => {
        const scene =
          project.scenes.find((s) => s.id === context.sceneId) || s();
        for (const a of added) {
          if (context.mode === "replace") {
            project.assets[context.assetId] = { ...a, id: context.assetId };
          } else if (context.mode === "image-replace") {
            if (a.kind !== "image") {
              failed = Error("请选择图片");
              continue;
            }
            project.assets[a.id] = a;
            const f = scene.images.find((f) => f.id === context.imageId);
            if (f) f.assetId = a.id;
          } else if (context.mode === "opening") {
            project.assets[a.id] = a;
            project[context.page][a.kind === "image" ? "image" : "video"] =
              a.id;
          } else if (context.mode === "timeline") {
            project.assets[a.id] = a;
            selection = placeTimelineAsset(a, context.at, context.track, scene);
            context.at += a.kind === "image" ? 3000 : a.durationMs;
          } else if (context.mode === "scene")
            addAssetToScene(project, scene, a, context.after);
          else project.assets[a.id] = a;
        }
      });
    if (failed) throw failed;
    notify(`已导入 ${added.length} 份素材，原始文件保存在本机`);
  } catch (error) {
    notify(error.message + (added.length ? "；已成功的素材已保留" : ""));
  } finally {
    busy = false;
    status("local");
    render();
    if (storage.token) sync();
  }
}
function pick(context) {
  uploadContext = context;
  $("#assetFiles").multiple = !["replace", "image-replace"].includes(
    context.mode,
  );
  $("#assetFiles").click();
}
async function handleAction(action, button) {
  if (await workspaceAction(action, button)) return;
  switch (action) {
    case "undo":
      history.undo();
      break;
    case "redo":
      history.redo();
      break;
    case "save":
      button.disabled = true;
      try {
        await saveCurrent();
        notify(
          storage.token && !validate(p()).some((x) => x.level === "error")
            ? "已保存并同步云端"
            : "已保存到本机",
        );
      } finally {
        button.disabled = false;
      }
      break;
    case "canvas-view":
      openGraphNode([...board.selected][0] || selected);
      break;
    case "graph-view":
      rememberScene();
      page = "story";
      graph = true;
      selection = { kind: "scene" };
      render();

      break;
    case "add-scene": {
      const scene = newScene("新的剧情段落");
      mutate("新建段落", (p) => {
        p.scenes.push(scene);
        p.editor.positions[scene.id] = {
          x: 60 + (p.scenes.length % 3) * 320,
          y: 60 + Math.floor(p.scenes.length / 3) * 230,
        };
      });
      selected = scene.id;
      selection = { kind: "scene" };
      time = 0;
      page = "story";
      render();
      break;
    }
    case "set-entry":
      mutate("设置入口", (p) => (p.entryId = selected));
      break;
    case "delete-scene": {
      await workspaceAction("delete-scenes", button);
      break;

      if (p().scenes.length === 1) {
        notify("至少保留一个剧情段落");
        break;
      }
      const inbound = p().scenes.filter((x) =>
        targetsOf(x).some((t) => t.kind === "scene" && t.sceneId === selected),
      );
      panel(
        `<h2>删除「${esc(s().name)}」</h2><p>${inbound.length ? `以下段落引用了它：${inbound.map((x) => esc(x.name)).join("、")}。这些出口将设为“结束作品”。` : "没有其他段落连接到这里。"}删除后可撤销，原始素材仍保留。</p><button class="danger" data-action="confirm-delete-scene">删除并处理连接</button>`,
      );
      break;
    }
    case "confirm-delete-scene": {
      const id = selected;
      mutate("删除段落", (p) => {
        p.scenes = p.scenes.filter((x) => x.id !== id);
        delete p.editor.positions[id];
        for (const scene of p.scenes)
          for (const t of targetsOf(scene))
            if (t.kind === "scene" && t.sceneId === id) {
              Object.keys(t).forEach((k) => delete t[k]);
              t.kind = "end";
            }
        if (p.entryId === id) p.entryId = p.scenes[0].id;
      });
      selection = { kind: "scene" };
      closePanel();
      render();
      break;
    }
    case "add-qte":
    case "add-choice":
    case "add-hotspot": {
      const e = newEvent(
        Math.min(time, duration(s())),
        action === "add-choice"
          ? "choice"
          : action === "add-hotspot"
            ? "hotspot"
            : "qte",
      );
      e.endMs = Math.min(duration(s()), e.startMs + 2000);
      mutate("添加互动", () => s().events.push(e));
      selection = { kind: "event", id: e.id };
      render();
      break;
    }
    case "add-subtitle": {
      const x = {
        id: uid("subtitle"),
        startMs: Math.min(time, Math.max(0, duration(s()) - 100)),
        endMs: Math.min(duration(s()), time + 2000),
        text: "在这里写字幕",
        x: 50,
        y: 88,
        size: 30,
        color: "#ffffff",
        background: true,
      };
      mutate("添加字幕", () => s().subtitles.push(x));
      selection = { kind: "subtitle", id: x.id };
      render();
      break;
    }
    case "add-speed":
    case "add-bars": {
      const x = {
        id: uid("effect"),
        kind: action === "add-speed" ? "speed" : "bars",
        startMs: Math.min(time, Math.max(0, duration(s()) - 100)),
        endMs: Math.min(duration(s()), time + 2000),
        value: action === "add-speed" ? 0.5 : 6,
      };
      mutate("添加效果区间", () => s().effects.push(x));
      selection = { kind: "effect", id: x.id };
      render();
      break;
    }
    case "add-audio": {
      const list = Object.values(p().assets).filter((a) => a.kind === "audio");
      if (!list.length) {
        pick({ mode: "scene", sceneId: selected });
        break;
      }
      panel(
        `<h2>选择音频</h2>${list.map((a) => `<button class="full" data-action="use-asset" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join("")}<button data-action="upload-scene">＋ 导入新音频</button>`,
      );
      break;
    }
    case "delete-item": {
      if (["clip", "video", "image"].includes(selection.kind)) {
        showClipDelete();
        break;
      }
      const key = {
        event: "events",
        image: "images",
        subtitle: "subtitles",
        audio: "audio",
        effect: "effects",
        overlay: "overlays",
      }[selection.kind];
      if (key) {
        const id = selection.id;
        mutate(
          "删除时间轴内容",
          () => (s()[key] = s()[key].filter((x) => x.id !== id)),
        );
        selection = { kind: "scene" };
        render();
      }
      break;
    }
    case "image-up":
    case "image-down": {
      const i = s().images.findIndex((x) => x.id === selection.id),
        j = i + (action === "image-up" ? -1 : 1);
      if (j >= 0 && j < s().images.length)
        mutate("调整分镜顺序", () =>
          s().images.splice(j, 0, s().images.splice(i, 1)[0]),
        );
      break;
    }
    case "image-copy": {
      const f = clone(selectObject()),
        i = s().images.findIndex((x) => x.id === f.id);
      f.id = uid("image");
      mutate("复制分镜", () => s().images.splice(i + 1, 0, f));
      selection = { kind: "image", id: f.id };
      render();
      break;
    }
    case "image-replace":
      pick({ mode: "image-replace", sceneId: selected, imageId: selection.id });
      break;
    case "image-insert":
      pick({ mode: "scene", sceneId: selected, after: selection.id });
      break;
    case "upload-scene":
      pick({ mode: "scene", sceneId: selected });
      break;
    case "upload-library":
      pick({ mode: "library" });
      break;
    case "upload-opening":
      pick({ mode: "opening", page });
      break;
    case "choose-ui": {
      const event = selectObject();
      panel(
        "<h2>更换互动 UI</h2>" +
          UI_COMPONENTS.filter((c) => c.kind === event.kind)
            .map(
              (c) =>
                '<div class="component-row"><span>' +
                esc(c.name) +
                '</span><button data-action="apply-ui" data-id="' +
                esc(c.id) +
                '">使用</button></div>',
            )
            .join(""),
      );
      break;
    }
    case "apply-ui": {
      const c = UI_COMPONENTS.find((c) => c.id === button.dataset.id);
      mutate("更换互动 UI", () => {
        const e = selectObject();
        e.uiComponent = c.id;
        e.uiPreset = c.preset || "classic";
        if (c.gesture) e.gesture = c.gesture;
      });
      closePanel();
      break;
    }
    case "preview-ui":
      await previewAsset(button.dataset.id, "ui");
      break;
    case "use-ui": {
      const event = componentEvent(
        button.dataset.id,
        Math.min(time, Math.max(0, duration(s()) - 100)),
      );
      event.endMs = Math.min(duration(s()), event.startMs + 5000);
      if (
        s().events.some(
          (x) => event.startMs < x.endMs && event.endMs > x.startMs,
        )
      )
        throw Error("这里已有互动，请先把播放头移到空位");
      mutate("添加互动 UI", () => s().events.push(event));
      closePanel();
      page = "story";
      graph = false;
      selection = { kind: "event", id: event.id };
      inspectorOpen = true;
      render();
      break;
    }
    case "rename-asset": {
      const a = p().assets[button.dataset.id];
      panel(
        '<h2>重命名素材</h2><input id="media-name" aria-label="素材名称" value="' +
          esc(a.name) +
          '"><button data-action="save-asset-name" data-id="' +
          esc(a.id) +
          '">保存</button>',
      );
      break;
    }
    case "save-asset-name": {
      const name = $("#media-name").value.trim();
      if (!name) throw Error("请输入名称");
      mutate("素材重命名", (p) => (p.assets[button.dataset.id].name = name));
      closePanel();
      break;
    }
    case "asset-uses": {
      const uses = mediaUses(p(), button.dataset.id);
      panel(
        "<h2>使用位置</h2>" +
          (uses
            .map(
              (x) =>
                '<button class="full" data-action="open-asset-use" data-id="' +
                esc(x.id) +
                '">' +
                esc(x.name) +
                "</button>",
            )
            .join("") || "<p>尚未使用</p>"),
      );
      break;
    }
    case "open-asset-use":
      closePanel();
      openGraphNode(button.dataset.id);
      break;
    case "reset-zoom":
      board.zoom(1 / board.scale);
      break;
    case "toggle-lines":
      board.showAllLines = !board.showAllLines;
      button.classList.toggle("active", board.showAllLines);
      board.lines();
      break;
    case "toggle-minimap":
      $(".minimap").hidden = !$(".minimap").hidden;
      localStorage.setItem("talespark-minimap", String(!$(".minimap").hidden));
      break;
    case "use-asset": {
      const a = p().assets[button.dataset.id];
      mutate("使用素材", (p) => addAssetToScene(p, s(), a));
      closePanel();
      page = "story";
      graph = false;
      selection = { kind: "scene" };
      render();
      break;
    }
    case "replace-asset": {
      const uses = mediaUses(p(), button.dataset.id);
      panel(
        "<h2>替换素材</h2><p>" +
          (uses.length
            ? "以下位置将使用替换后的素材：" +
              uses.map((x) => esc(x.name)).join("、")
            : "这个素材尚未用于剧情。") +
          '</p><button data-action="confirm-replace-asset" data-id="' +
          esc(button.dataset.id) +
          '">选择替换文件</button>',
      );
      break;
    }
    case "confirm-replace-asset":
      pick({ mode: "replace", assetId: button.dataset.id });
      break;
    case "check-asset":
      try {
        await assets.file(p().assets[button.dataset.id]);
        notify("素材可读取");
      } catch (e) {
        notify(e.message);
      }
      break;
    case "remove-asset":
      if (references(p()).includes(button.dataset.id))
        notify(
          "仍在使用：" +
            mediaUses(p(), button.dataset.id)
              .map((x) => x.name)
              .join("、"),
        );
      else mutate("移除素材引用", (p) => delete p.assets[button.dataset.id]);
      break;
    case "video-link":
      panel(
        '<h2>从视频直链导入</h2><p>素材会读取并保存到本机，发布时上传为持久素材。链接需要允许跨域读取。</p><label class="field">视频地址<input id="video-url" type="url" placeholder="https://…/video.mp4"></label><button class="primary" data-action="import-url">读取视频</button>',
      );
      break;
    case "import-url": {
      const url = $("#video-url").value;
      if (!/^https?:\/\//.test(url)) throw Error("请输入 HTTP 或 HTTPS 地址");
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw Error("视频链接读取失败");
      const blob = await r.blob();
      closePanel();
      await importFiles(
        [
          new File(
            [blob],
            new URL(url).pathname.split("/").pop() || "video.mp4",
            { type: blob.type },
          ),
        ],
        { mode: "scene", sceneId: selected },
      );
      break;
    }
    case "add-option":
      if (selectObject().options.length >= 10) notify("最多支持 10 个选项");
      else
        mutate("添加选项", () =>
          selectObject().options.push({
            id: uid("option"),
            text: "新的选择",
            target: endTarget(),
            condition: null,
            actions: [],
            x: 0,
            y: 0,
          }),
        );
      break;
    case "delete-option":
      mutate(
        "删除选项",
        () =>
          (selectObject().options = selectObject().options.filter(
            (o) => o.id !== button.dataset.id,
          )),
      );
      break;
    case "condition": {
      const path = button.dataset.path,
        first = Object.keys(p().variables)[0];
      if (!get(selectObject(), path) && !first) {
        notify("请先在“剧情变量”中添加变量");
        break;
      }
      mutate("设置显示条件", () =>
        set(
          selectObject(),
          path,
          get(selectObject(), path)
            ? null
            : { variable: first, op: "eq", value: p().variables[first] },
        ),
      );
      break;
    }
    case "add-action": {
      const first = Object.keys(p().variables)[0];
      if (!first) {
        notify("请先添加剧情变量");
        break;
      }
      mutate("添加变量动作", () =>
        get(selectObject(), button.dataset.path).push({
          variable: first,
          op: "set",
          value: p().variables[first],
        }),
      );
      break;
    }
    case "remove-action":
      mutate("移除变量动作", () =>
        get(selectObject(), button.dataset.path).splice(
          +button.dataset.index,
          1,
        ),
      );
      break;
    case "add-variable":
      panel(
        '<h2>新建剧情变量</h2><label class="field">名称（英文字母、数字或下划线）<input id="variable-name" placeholder="has_key"></label><label class="field">类型<select id="variable-type"><option value="boolean">开关：是 / 否</option><option value="number">数值：分数、次数</option><option value="string">文字</option></select></label><button data-action="confirm-variable">添加变量</button>',
      );
      break;
    case "confirm-variable": {
      const key = $("#variable-name").value.trim(),
        type = $("#variable-type").value;
      if (
        !/^[A-Za-z][\w-]{0,79}$/.test(key) ||
        ["constructor", "prototype", "__proto__"].includes(key) ||
        Object.hasOwn(p().variables, key)
      )
        throw Error("请输入不重复的有效变量名称");
      mutate(
        "新增变量",
        (p) =>
          (p.variables[key] =
            type === "number" ? 0 : type === "boolean" ? false : ""),
      );
      closePanel();
      break;
    }
    case "delete-variable":
      mutate("删除变量", (p) => delete p.variables[button.dataset.id]);
      break;
    case "preview-all":
      await preview({ full: true });
      break;
    case "preview-current":
      await preview();
      break;
    case "preview-here":
      await preview({ here: true });
      break;
    case "import":
      $("#importFile").click();
      break;
    case "export": {
      if (busy) throw Error("请等待素材处理完成");
      busy = true;
      try {
        notify("正在打包完整配置与原始素材…");
        download(
          await exportZip(p(), assets),
          p().name.replace(/[<>:"/\\|?*]/g, "_") + ".storyforge.zip",
        );
        notify("项目备份已导出");
      } finally {
        busy = false;
      }
      break;
    }
    case "connect":
      panel(
        '<h2>连接发布服务</h2><p>连接后可同步草稿并发布作品。</p><label class="field">发布授权<input id="cloud-key" type="password" autocomplete="off"></label><button class="primary" data-action="confirm-connect">连接并检查草稿</button>',
      );
      break;
    case "confirm-connect": {
      const token = $("#cloud-key").value.trim();
      if (!token) throw Error("请输入授权");
      storage.setToken(token);
      try {
        const draft = await storage.draft(p().id);
        if (draft.revision !== storage.queue.revision) {
          panel(
            '<h2>发现已有云端草稿</h2><p>本机修改已保留。可以打开云端副本，或先导出当前作品，再决定使用哪个版本。</p><button data-action="load-cloud">备份本机并打开云端副本</button><button data-action="export">导出本机作品</button>',
          );
          break;
        }
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      const resumePublish = publishAfterConnect;
      closePanel();
      await sync();
      if (resumePublish) {
        showIssues(true);
      }
      break;
    }
    case "load-cloud": {
      const resumePublish = publishAfterConnect;
      const draft = await storage.draft(p().id);
      await adopt(migrate(draft.project), draft.revision);
      closePanel();
      notify("已打开云端草稿，本机原稿保留在恢复列表");
      if (resumePublish) showIssues(true);
      break;
    }
    case "publish":
      if (busy) throw Error("请等待素材导入完成");
      if (!storage.token) {
        publishAfterConnect = true;
        await handleAction("connect", button);
        break;
      }
      showIssues(true);
      break;
    case "confirm-publish": {
      busy = true;
      button.disabled = true;
      const snapshot = clone(p());
      try {
        const result = await storage.publish(snapshot);
        const verify = await storage.published(result.version);
        if (verify.project.id !== snapshot.id)
          throw Error("发布版本读取验证失败");
        const errors = validate(verify.project, { publish: true }).filter(
          (x) => x.level === "error",
        );
        if (errors.length) throw Error("发布版本校验失败");
        const fixedUrl = new URL(await storage.playerUrl());
        fixedUrl.searchParams.set("project", snapshot.id);
        const publicUrl = fixedUrl.href;
        const url = new URL(publicUrl);
        url.searchParams.set("version", result.version);
        panel(
          `<h2>发布成功</h2><p><a href="${esc(url.href)}" target="_blank" rel="noopener">打开本次发布的作品</a></p><p><a href="${esc(publicUrl)}" target="_blank" rel="noopener">作品固定链接</a></p><button data-action="versions">发布历史</button>`,
        );
        status("● 已发布 · " + new Date(result.updatedAt).toLocaleString());
      } finally {
        busy = false;
        button.disabled = false;
        if (JSON.stringify(p()) !== JSON.stringify(snapshot)) {
          status("local");
          if (storage.token) sync();
        }
      }
      break;
    }
    case "versions": {
      const list = await storage.versions(p().id);
      let current;
      try {
        current = (await storage.published("", p().id)).version;
      } catch {}
      panel(
        `<h2>发布版本</h2><p>恢复旧发布版不会覆盖当前草稿。</p>${list.length ? list.map((v) => `<div class="version"><strong>${esc(v.name)}</strong><p>${esc(new Date(v.updatedAt).toLocaleString())}${v.version === current ? " · 当前公开版本" : ""}</p><a href="/game?version=${v.version}" target="_blank" rel="noopener">查看此版</a> <button data-action="restore-version" data-id="${v.version}">恢复为公开版本</button></div>`).join("") : "<p>尚未发布。</p>"}`,
      );
      break;
    }
    case "restore-version":
      await storage.restore(button.dataset.id, p().id);
      notify("已恢复公开版本，草稿保留");
      await handleAction("versions", button);
      break;
    case "locate":
      selected = button.dataset.id;
      page = "story";
      graph = false;
      selection = { kind: "scene" };
      closePanel();
      render();
      break;
    case "projects": {
      const backups = storage.backups();
      let cloud = [];
      if (storage.token)
        try {
          cloud = await response(
            await fetch("/api/v2/projects", { headers: storage.headers() }),
          );
        } catch {}
      panel(
        `<h2>作品与恢复</h2><p>切换前会保留当前作品的本机备份。</p><button data-action="new-project">新建空白作品</button> <button data-action="demo">打开制作示例</button><h3>云端草稿</h3>${
          cloud
            .filter((x) => !x.deleted)
            .map(
              (x) =>
                `<button class="full" data-action="open-project" data-id="${x.id}">${esc(x.name)} · ${esc(new Date(x.updatedAt).toLocaleString())}</button>`,
            )
            .join("") || "<p>连接云端后可查看。</p>"
        }<h3>本机恢复副本</h3>${backups.map((x) => `<button class="full" data-action="restore-backup" data-id="${esc(x.key)}">${esc(x.label)} · ${esc(new Date(x.updatedAt).toLocaleString())}</button>`).join("") || "<p>尚无恢复副本。</p>"}<p><a href="legacy.html" target="_blank">打开旧版编辑器（用于旧数据检查）</a></p>`,
      );
      break;
    }
    case "new-project":
      await adopt(newProject());
      closePanel();
      break;
    case "demo":
      await adopt(demoProject());
      closePanel();
      break;
    case "open-project": {
      const draft = await storage.draft(button.dataset.id);
      await adopt(migrate(draft.project), draft.revision);
      closePanel();
      break;
    }
    case "restore-backup": {
      const b = storage.backups().find((x) => x.key === button.dataset.id);
      const restored = migrate(b.project);
      restored.id = uid("project");
      await adopt(restored);
      closePanel();
      break;
    }
  }
}
let suppressClick = false;
function timelineSpan() {
  return Math.max(1000, duration(s())) + Math.max(2000, duration(s()) * 0.15);
}
function snappedTime(value, exclude, width, alt = false) {
  value = Math.max(0, Math.round(value));
  if (alt) return value;
  const threshold = (8 / Math.max(1, width)) * timelineSpan();
  const points = [
    0,
    time,
    ...items()
      .filter((x) => x.id !== exclude)
      .flatMap((x) => [x.start, x.end]),
  ];
  const nearest = points.sort(
    (a, b) => Math.abs(value - a) - Math.abs(value - b),
  )[0];
  return Math.abs(nearest - value) <= threshold ? nearest : value;
}
function dragLibraryAsset(id, kind, phase, e) {
  const timeline = $(".timeline-scroll");
  timeline.querySelectorAll(".timeline-drop").forEach((x) => x.remove());
  timeline
    .querySelectorAll(".drop-lane")
    .forEach((x) => x.classList.remove("drop-lane"));
  if (phase === "cancel") return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!target || !timeline.contains(target)) return;
  const track = target.closest(".track"),
    lane = track?.querySelector(".lane") || timeline.querySelector(".lane");
  if (!lane) return;
  const rect = lane.getBoundingClientRect();
  let at = snappedTime(
    ((e.clientX - rect.left) / rect.width) * timelineSpan(),
    null,
    rect.width,
    e.altKey,
  );
  if (
    kind === "video" ||
    (kind === "image" && track?.dataset.track !== "overlay")
  )
    at = insertionPoint(s(), at);
  if (phase === "move") {
    const guide = document.createElement("div");
    guide.className = "timeline-drop";
    guide.style.left = (at / timelineSpan()) * 100 + "%";
    guide.textContent = (at / 1000).toFixed(1) + " 秒";
    lane.append(guide);
    lane.classList.add("drop-lane");
    const bounds = timeline.getBoundingClientRect();
    if (e.clientX > bounds.right - 25) timeline.scrollLeft += 12;
    if (e.clientX < bounds.left + 85) timeline.scrollLeft -= 12;
    return;
  }
  try {
    mutate("拖入时间轴", () => {
      if (kind === "ui") {
        const event = componentEvent(
          id,
          clamp(at, 0, Math.max(0, duration(s()) - 100)),
        );
        event.endMs = Math.min(duration(s()), event.startMs + 5000);
        if (
          s().events.some(
            (x) => event.startMs < x.endMs && event.endMs > x.startMs,
          )
        )
          throw Error("这里已有互动，请拖到空位");
        s().events.push(event);
        selection = { kind: "event", id: event.id };
      } else
        selection = placeTimelineAsset(
          p().assets[id],
          at,
          track?.dataset.track,
        );
    });
    renderInspector();
  } catch (error) {
    notify(error.message);
  }
}
function timelinePointer(e) {
  if (e.button !== 0) return;
  let clip = e.target.closest("[data-clip]");
  if (!clip) {
    const lane = e.target.closest(".ruler,.lane");
    if (lane) {
      const r = lane.getBoundingClientRect();
      time = clamp(
        Math.round(((e.clientX - r.left) / r.width) * timelineSpan()),
        0,
        duration(s()),
      );
      paintStill();
      updatePlayhead();
    }
    return;
  }
  e.preventDefault();
  const edge = e.target.dataset.edge;
  selection = { kind: clip.dataset.kind, id: clip.dataset.clip };
  if (["video", "image"].includes(selection.kind)) {
    const oldId = selection.id;
    mutate("转换为可编辑片段", () => ensureSequence(s()));
    selection = { kind: "clip", id: oldId };
    renderTimeline();
    clip = $(".timeline-scroll").querySelector(`[data-clip="${oldId}"]`);
  }
  renderInspector();
  paintStill();
  const obj = selectObject(),
    before = clone(obj);
  if (!obj) return;
  const rect = clip.parentElement.getBoundingClientRect(),
    span = timelineSpan(),
    source = items().find((x) => x.id === obj.id),
    startX = e.clientX;
  let delta = 0,
    moved = false;
  const controller = new AbortController(),
    guide = document.createElement("div");
  guide.className = "timeline-snap";
  clip.parentElement.append(guide);
  const anchor = edge === "right" ? source.end : source.start;
  window.addEventListener(
    "pointermove",
    (ev) => {
      const raw = ((ev.clientX - startX) / rect.width) * span;
      let target = snappedTime(anchor + raw, obj.id, rect.width, ev.altKey);
      if (!edge && selection.kind !== "clip") {
        const length = source.end - source.start;
        const endSnap = snappedTime(
          source.end + raw,
          obj.id,
          rect.width,
          ev.altKey,
        );
        if (
          Math.abs(endSnap - source.end - raw) <
          Math.abs(target - source.start - raw)
        )
          target = endSnap - length;
      }
      delta = target - anchor;
      moved ||= Math.abs(ev.clientX - startX) > 3;
      const lo =
        edge === "left"
          ? Math.max(0, Math.min(source.end - 100, source.start + delta))
          : edge === "right"
            ? source.start
            : Math.max(0, source.start + delta);
      const hi =
        edge === "right"
          ? Math.max(source.start + 100, source.end + delta)
          : edge === "left"
            ? source.end
            : lo + source.end - source.start;
      clip.style.left = (lo / span) * 100 + "%";
      clip.style.width = Math.max(0.6, ((hi - lo) / span) * 100) + "%";
      guide.style.left = (target / span) * 100 + "%";
      clip.title =
        (lo / 1000).toFixed(2) + " — " + (hi / 1000).toFixed(2) + " 秒";
      const scroller = $(".timeline-scroll"),
        bounds = scroller.getBoundingClientRect();
      if (ev.clientX > bounds.right - 25) scroller.scrollLeft += 12;
      if (ev.clientX < bounds.left + 85) scroller.scrollLeft -= 12;
    },
    { signal: controller.signal },
  );
  const finish = (ev) => {
    controller.abort();
    guide.remove();
    if (ev.type === "pointercancel" || !moved) {
      renderTimeline();
      return;
    }
    suppressClick = true;
    try {
      mutate("调整时间轴", () => {
        if (selection.kind === "clip") {
          if (edge)
            trimVisual(
              s(),
              obj.id,
              edge,
              delta,
              obj.kind === "video"
                ? p().assets[obj.assetId].durationMs
                : 7200000,
            );
          else moveVisual(s(), obj.id, before.startMs + delta);
        } else {
          const d = duration(s()),
            min = selection.kind === "event" ? 0 : 100;
          if (edge === "left") {
            obj.startMs = clamp(before.startMs + delta, 0, before.endMs - min);
            if (selection.kind === "audio") {
              const change = Math.max(
                -before.inMs,
                obj.startMs - before.startMs,
              );
              obj.startMs = before.startMs + change;
              obj.inMs = before.inMs + change;
            }
          } else if (edge === "right") {
            const limit =
              selection.kind === "audio"
                ? Math.min(
                    d,
                    before.startMs +
                      p().assets[obj.assetId].durationMs -
                      before.inMs,
                  )
                : d;
            obj.endMs = clamp(
              before.endMs + delta,
              before.startMs + min,
              limit,
            );
          } else {
            const length = before.endMs - before.startMs;
            obj.startMs = clamp(before.startMs + delta, 0, d - length);
            obj.endMs = obj.startMs + length;
          }
        }
      });
    } catch {
      renderTimeline();
    }
  };
  window.addEventListener("pointerup", finish, {
    once: true,
    signal: controller.signal,
  });
  window.addEventListener("pointercancel", finish, {
    once: true,
    signal: controller.signal,
  });
}
function timelineKey(e) {
  const clip = e.target.closest("[data-clip]");
  if (!clip || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  selection = { kind: clip.dataset.kind, id: clip.dataset.clip };
  const obj = selectObject(),
    delta = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1000 : 100);
  mutate("微调时间轴", () => {
    if (selection.kind === "clip") moveClip(s(), obj.id, obj.startMs + delta);
    else if (selection.kind === "image")
      obj.durationMs = Math.max(100, obj.durationMs + delta);
    else if (selection.kind === "video")
      obj.inMs = clamp(obj.inMs + delta, 0, obj.outMs - 100);
    else {
      const length = obj.endMs - obj.startMs;
      obj.startMs = clamp(obj.startMs + delta, 0, duration(s()) - length);
      obj.endMs = obj.startMs + length;
    }
  });
}
function canvasPointer(e) {
  const el = e.target.closest("[data-edit-event],[data-edit-item]");
  if (!el || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selection = {
    kind: el.dataset.editKind || "event",
    id: el.dataset.editItem || el.dataset.editEvent,
  };
  const event = selectObject(),
    option = event.options?.find((x) => x.id === el.dataset.optionId),
    obj = option || event,
    before = { x: obj.x, y: obj.y },
    rect = $(".canvas").getBoundingClientRect(),
    start = { x: e.clientX, y: e.clientY };
  let dx = 0,
    dy = 0;
  const controller = new AbortController();
  window.addEventListener(
    "pointermove",
    (ev) => {
      dx = ((ev.clientX - start.x) / rect.width) * 100;
      dy = ((ev.clientY - start.y) / (option ? rect.width : rect.height)) * 100;
      if (option)
        el.style.translate = `${before.x + dx}cqw ${before.y + dy}cqw`;
      else {
        el.style.left = clamp(before.x + dx, 0, 100) + "%";
        el.style.top = clamp(before.y + dy, 0, 100) + "%";
      }
    },
    { signal: controller.signal },
  );
  const finish = (ev) => {
    controller.abort();
    if (ev.type !== "pointercancel" && Math.abs(dx) + Math.abs(dy) > 0.1) {
      suppressClick = true;
      mutate("调整画面元素位置", () => {
        obj.x = +clamp(before.x + dx, option ? -100 : 0, 100).toFixed(1);
        obj.y = +clamp(before.y + dy, option ? -100 : 0, 100).toFixed(1);
      });
    }
    renderInspector();
    paintStill();
  };
  window.addEventListener("pointerup", finish, {
    once: true,
    signal: controller.signal,
  });
  window.addEventListener("pointercancel", finish, {
    once: true,
    signal: controller.signal,
  });
}
document.addEventListener("click", async (e) => {
  if (suppressClick) {
    suppressClick = false;
    if (e.target.closest(".timeline-scroll,.canvas")) return;
  }
  const button = e.target.closest("button");
  try {
    const part = e.target.closest("[data-opening-part]");
    if (part) {
      openingPart = part.dataset.openingPart;
      renderLibrary();
      renderOpeningInspector();
      return;
    }
    if (button?.dataset.action === "toggle-directory") {
      directoryOpen = !directoryOpen;
      localStorage.setItem("talespark-directory", String(directoryOpen));
      document.body.dataset.directory = String(directoryOpen);
      if (directoryOpen) $("#scene-search")?.focus();
      return;
    }
    if (button?.dataset.action === "opening-play") {
      const v = $(".opening-preview video");
      if (v) {
        if (v.paused) v.play().catch((x) => notify(x.message));
        else v.pause();
      }
      return;
    }
    const device = e.target.closest("[data-preview-device]");
    if (device) {
      $("#preview").dataset.device = device.dataset.previewDevice;
      return;
    }
    if (e.target.closest(".graph-scroll")) return;
    if (button?.dataset.action) {
      button.closest("details")?.removeAttribute("open");
      await handleAction(button.dataset.action, button);
      return;
    }
    if (button?.dataset.page) {
      if (page === "story" && !graph) rememberScene();
      button.closest("details")?.removeAttribute("open");
      if (button.dataset.uiCategory) mediaLibrary.category = "ui";
      page = button.dataset.page;
      openingPart = "background";
      if (page === "story") {
        graph = true;
        selection = { kind: "scene" };
      }
      render();
      return;
    }
    if (button?.dataset.selectKind) {
      selection = {
        kind: button.dataset.selectKind,
        id: button.dataset.selectId,
      };
      if (selection.kind === "image") {
        time = items().find((x) => x.id === selection.id)?.start || 0;
      }
      render();
      return;
    }
    if (button?.dataset.port) {
      linkFrom = { sceneId: button.dataset.from, path: button.dataset.port };
      renderGraph();
      notify("点击目标段落完成连接");
      return;
    }
    const item = e.target.closest("[data-scene]");
    if (item) {
      if (graph) {
        selected = item.dataset.scene;
        board.selected = new Set([selected]);
        selection = { kind: "scene" };
        render();
        board.locate(selected);
      } else enterScene(item.dataset.scene);
    }
  } catch (error) {
    notify(error.message);
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.dataset.field || !history) return;
  const path = el.dataset.field,
    scope = el.dataset.scope;
  let obj =
    scope === "project"
      ? p()
      : scope === "loading"
        ? p().loading
        : scope === "splash"
          ? p().splash
          : selectObject();
  if (!obj) return;
  let value =
    el.type === "checkbox"
      ? el.checked
      : el.type === "number"
        ? Number(el.value)
        : el.value;
  if (el.hasAttribute("data-ms")) value = ms(value);
  if (typeof get(obj, path) === "boolean")
    value = value === true || value === "true";
  if (el.type === "number" && !Number.isFinite(value)) {
    notify("请输入有效数值");
    return;
  }
  try {
    mutate("修改属性", () => {
      if (selection.kind === "clip" && path === "startMs") {
        moveClip(s(), obj.id, value);
        return;
      }
      if (
        (scope === "loading" || scope === "splash") &&
        path.startsWith("layout.")
      ) {
        obj.layout ||= {};
        obj.layout[openingPart] ||= openingDefaults(openingPart);
      }
      set(obj, path, value);
      if (path.endsWith(".target.kind") || path === "next.kind") {
        const base = path.slice(0, -5);
        set(
          obj,
          base,
          value === "scene"
            ? { kind: value, sceneId: p().entryId }
            : value === "seek"
              ? { kind: value, timeMs: 0 }
              : { kind: value },
        );
      }
      if (path.endsWith(".variable")) {
        const base = path.slice(0, -9);
        set(obj, base + ".value", p().variables[value]);
        if (
          get(obj, base + ".op") === "add" &&
          typeof p().variables[value] !== "number"
        )
          set(obj, base + ".op", "set");
      }
      if (selection.kind === "event" && scope === "selection") {
        if (path === "kind" && value === "choice" && !obj.options.length)
          obj.options = newEvent(0, "choice").options;
        if (path === "endMode" && value === "range") obj.pause = false;
      }
      if (selection.kind === "effect" && path === "kind")
        obj.value = value === "speed" ? 0.5 : 6;
    });
  } catch {
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if ($("#preview").open) return;
  if (
    !e.target.matches("input,textarea,select,[contenteditable]") &&
    !$("#panel").open &&
    graph &&
    page === "story"
  ) {
    if (e.key === "Delete") {
      e.preventDefault();
      if (board.activeEdge) {
        disconnectFlow();
        return;
      }
      workspaceAction("delete-scenes").catch((x) => notify(x.message));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      workspaceAction("copy-scenes").catch((x) => notify(x.message));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      enterScene(selected);
      return;
    }
  }
  const editing = e.target.matches("input,textarea,select,[contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    sync();
  }
  if ((e.ctrlKey || e.metaKey) && !editing && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? history.redo() : history.undo();
  }
  if (e.key === "Escape") {
    linkFrom = null;
    if (graph) renderGraph();
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-scene]"))
    e.target.click();
});
$("#assetFiles").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length)
    await importFiles(files, uploadContext || { mode: "library" });
};
$("#importFile").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (busy) {
    notify("请等待当前素材任务完成");
    return;
  }
  busy = true;
  try {
    notify("正在检查项目并恢复原始素材…");
    const result = await importZip(file, assets);
    storage.backup(result.original, "导入原始文件");
    await adopt(result.project);
    notify("已导入独立草稿，原作品已备份。请检查提示后发布。");
  } catch (error) {
    notify("导入失败：" + error.message);
  } finally {
    busy = false;
  }
};
$("#panel").addEventListener("close", clearAssetPreview);
$(".panel-close").onclick = closePanel;
$(".preview-close").onclick = () => {
  $("#preview").close();
  previewSession?.dispose();
};
$("#preview").addEventListener("close", () => previewSession?.dispose());
window.addEventListener("beforeunload", (e) => {
  if (busy || storage.queue.running) {
    e.preventDefault();
    e.returnValue = "";
  }
});
boot().catch((error) => {
  $("#studio").innerHTML =
    `<div class="boot"><h2>工作台暂时无法打开</h2><p>${esc(error.message)}</p><p>原草稿未删除。请刷新重试，或使用旧版编辑器导出备份。</p><a href="legacy.html">打开旧版编辑器</a></div>`;
});

function rememberScene() {
  sceneViews.set(selected, { time, zoom, selection: clone(selection) });
}
function enterScene(id) {
  if (!graph) rememberScene();
  selected = id;
  const view = sceneViews.get(id);
  time = view?.time || 0;
  zoom = view?.zoom || 1.5;
  selection = view?.selection || { kind: "scene" };
  page = "story";
  graph = false;
  render();
  $("#zoom").value = zoom;
}
function setupBoard() {
  board?.dispose();
  $(".graph-scroll").addEventListener("click", (e) => {
    if (!e.target.closest(".graph-card,[data-line-from]")) {
      inspectorOpen = false;
      document.body.dataset.inspector = "false";
    }
  });
  $(".opening-preview").addEventListener("pointerdown", openingPointer);
  $("#opening-seek").addEventListener("input", (e) => {
    const v = $(".opening-preview video");
    if (v && Number.isFinite(v.duration)) {
      v.pause();
      v.currentTime = Number(e.target.value);
    }
  });
  $(".minimap").hidden = localStorage.getItem("talespark-minimap") === "false";
  board = new StoryBoard($(".graph-scroll"), {
    ports,
    assetUrl: (a) => assets.url(a),
    mini: () => $(".minimap"),
    zoom: (n) => ($("#graph-scale").textContent = Math.round(n * 100) + "%"),
    selection: (n) => {
      $(".selection-tools").hidden = !n;
      $('[data-action="arrange-selection"]').hidden = n < 2;
    },
    preview: () => preview(),
    select: (id) => {
      inspectorOpen = !specialNode(id);
      document.body.dataset.inspector = String(inspectorOpen);
      if (!specialNode(id)) selected = id;
      selection = { kind: "scene" };
      renderInspector();
      board.highlight();
    },
    open: openGraphNode,
    move: (list) =>
      mutate("移动节点", (p) => {
        p.editor.positions = { ...flowPositions(p) };
        list.forEach((x) => (p.editor.positions[x.id] = { x: x.x, y: x.y }));
      }),
    menu: (id) => {
      if (specialNode(id)) {
        openGraphNode(id);
        return;
      }
      selected = id;
      panel(
        `<h2>${esc(s().name)}</h2><label class="field">名称<input id="rename-scene" value="${esc(s().name)}"></label><div class="mini-actions"><button data-action="rename-scene">重命名</button><button data-action="enter-scene">进入编辑</button><button data-action="copy-scenes">复制</button><button data-action="set-entry">设为入口</button><button data-action="make-ending">设为结局</button><button class="danger" data-action="delete-scenes">删除</button></div>`,
      );
    },
    create: (position, connection = null) => {
      newCardContext = { position, connection };
      workspaceAction("new-card");
    },
    blank: () => {
      inspectorOpen = false;
      document.body.dataset.inspector = "false";
    },
    edge: (edge) => {
      inspectorOpen = true;
      document.body.dataset.inspector = "true";
      renderEdgeInspector(edge);
    },
    connection: (id, path) => {
      if (id === LOADING) return;
      if (id === SPLASH) {
        newCardContext = null;
        panel(
          '<h2>起始剧情</h2><select id="entry-target">' +
            p()
              .scenes.map(
                (s) =>
                  '<option value="' +
                  s.id +
                  '" ' +
                  (s.id === p().entryId ? "selected" : "") +
                  ">" +
                  esc(s.name) +
                  "</option>",
              )
              .join("") +
            '</select><button data-action="save-flow-entry">确定</button>',
        );
        return;
      }
      showConnection(id, path);
    },
    connect: (id, path, target) => {
      try {
        mutate("连接剧情", (p) => connectFlow(p, id, path, target));
      } catch {}
    },
    drop: async (transfer, position) => {
      newCardContext = { position };
      const aid = transfer.getData("application/storyforge-asset");
      if (aid) {
        const scene = createScene(p().assets[aid].name);
        mutate("素材创建场景", (p) => addAssetToScene(p, scene, p.assets[aid]));
        return;
      }
      if (transfer.files.length) {
        const scene = createScene("新场景");
        await importFiles([...transfer.files], {
          mode: "scene",
          sceneId: scene.id,
        });
      }
    },
  });
  $(".library").addEventListener("input", (e) => {
    if (e.target.id === "scene-search") {
      sceneSearch = e.target.value;
      for (const el of $(".library").querySelectorAll("[data-scene]"))
        el.hidden = !el.textContent
          .toLowerCase()
          .includes(sceneSearch.toLowerCase());
    }
    if (e.target.id === "asset-search") {
      assetSearch = e.target.value;
      for (const el of $(".library").querySelectorAll("[data-drag-asset]"))
        el.hidden = !el.textContent
          .toLowerCase()
          .includes(assetSearch.toLowerCase());
    }
  });
  $(".library").addEventListener("dragstart", (e) => {
    const el = e.target.closest("[data-drag-asset]");
    if (el)
      e.dataTransfer.setData(
        "application/storyforge-asset",
        el.dataset.dragAsset,
      );
  });
  const timeline = $(".timeline-scroll");
  const clearDrop = () => {
    timeline.querySelectorAll(".timeline-drop").forEach((x) => x.remove());
    timeline
      .querySelectorAll(".drop-lane")
      .forEach((x) => x.classList.remove("drop-lane"));
  };
  timeline.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    clearDrop();
    const track = e.target.closest(".track"),
      lane = track?.querySelector(".lane") || timeline.querySelector(".lane");
    if (!lane) return;
    const r = lane.getBoundingClientRect(),
      at = snappedTime(
        ((e.clientX - r.left) / r.width) * timelineSpan(),
        null,
        r.width,
        e.altKey,
      );
    const guide = document.createElement("div");
    guide.className = "timeline-drop";
    guide.style.left = (at / timelineSpan()) * 100 + "%";
    guide.textContent = (at / 1000).toFixed(1) + " 秒";
    lane.append(guide);
    lane.classList.add("drop-lane");
  });
  timeline.addEventListener("dragleave", (e) => {
    if (!timeline.contains(e.relatedTarget)) clearDrop();
  });
  timeline.addEventListener("drop", async (e) => {
    e.preventDefault();
    const lane =
      e.target.closest(".track")?.querySelector(".lane") ||
      timeline.querySelector(".lane");
    const track = e.target.closest(".track")?.dataset.track;
    const rect = lane.getBoundingClientRect();
    const at = snappedTime(
      ((e.clientX - rect.left) / rect.width) * timelineSpan(),
      null,
      rect.width,
      e.altKey,
    );
    clearDrop();
    const aid = e.dataTransfer.getData("application/storyforge-asset"),
      ui = e.dataTransfer.getData("application/storyforge-ui");
    try {
      if (aid || ui) {
        mutate("拖入时间轴", () => {
          if (ui) {
            const event = componentEvent(
              ui,
              clamp(at, 0, Math.max(0, duration(s()) - 100)),
            );
            event.endMs = Math.min(duration(s()), event.startMs + 5000);
            if (
              s().events.some(
                (x) => event.startMs < x.endMs && event.endMs > x.startMs,
              )
            )
              throw Error("这里已有互动，请拖到空位");
            s().events.push(event);
            selection = { kind: "event", id: event.id };
          } else selection = placeTimelineAsset(p().assets[aid], at, track);
        });
        renderInspector();
      } else if (e.dataTransfer.files.length)
        await importFiles([...e.dataTransfer.files], {
          mode: "timeline",
          sceneId: selected,
          at,
          track,
        });
    } catch (error) {
      notify(error.message);
    }
  });
  $(".canvas").addEventListener("drop", (e) => {
    const aid = e.dataTransfer.getData("application/storyforge-asset");
    if (aid) mutate("添加片段", (p) => addAssetToScene(p, s(), p.assets[aid]));
  });
}
function renderLibrary() {
  sidebarLibrary.dispose();
  if (page !== "assets") mediaLibrary.dispose();
  if (page === "loading" || page === "splash") {
    const parts = {
      background: "背景",
      title: "标题",
      subtitle: "副标题",
      ...(page === "loading"
        ? { progress: "加载进度" }
        : { start: "开始提示" }),
    };
    $(".library").innerHTML =
      `<div class="sidebar-title">画面元素</div>${Object.entries(parts)
        .map(
          ([key, label]) =>
            `<button class="opening-layer ${openingPart === key ? "active" : ""}" data-opening-part="${key}">${label}</button>`,
        )
        .join(
          "",
        )}<hr><button data-action="upload-opening">＋ 上传素材</button>`;
    return;
  }
  if (page === "story" && !graph) {
    sidebarLibrary.mount($(".library"), p());
    return;
  }
  $(".library").innerHTML =
    `<div class="sidebar-title">场景 <small>${p().scenes.length}</small></div><input id="scene-search" placeholder="搜索场景" value="${esc(sceneSearch)}">${p()
      .scenes.filter((x) =>
        x.name.toLowerCase().includes(sceneSearch.toLowerCase()),
      )
      .map(
        (x, i) =>
          `<div class="scene-item ${x.id === selected ? "selected" : ""}" data-scene="${x.id}" draggable="true" role="button" tabindex="0"><span class="number">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(x.name)}</strong><small>${sec(duration(x)).toFixed(1)}s${p().entryId === x.id ? " · 入口" : ""}${x.role === "ending" ? " · 结局" : ""}</small></div></div>`,
      )
      .join("")}`;
}
function createScene(name = "新场景", role = "story", source = "sequence") {
  const scene = newScene(name);
  scene.source = source;
  scene.clips = [];
  scene.role = role;
  scene.next = ["ending", "death"].includes(role)
    ? endTarget()
    : { kind: "unlinked" };
  const context = newCardContext;
  newCardContext = null;
  const positions = flowPositions(p()),
    position = context?.position || {
      x: Math.round($(".graph-scroll").scrollLeft / board.scale + 80),
      y: Math.round($(".graph-scroll").scrollTop / board.scale + 100),
    };
  while (
    Object.values(positions).some(
      (p) =>
        Math.abs(p.x - position.x) < 260 && Math.abs(p.y - position.y) < 200,
    )
  )
    position.y += 220;
  mutate("新建并连接场景", (p) => {
    p.editor.positions = positions;
    p.scenes.push(scene);
    p.editor.positions[scene.id] = position;
    if (context?.connection)
      connectFlow(
        p,
        context.connection.from,
        context.connection.path,
        scene.id,
      );
  });
  selected = scene.id;
  board.selected = new Set([selected]);
  board.activeEdge = null;
  selection = { kind: "scene" };
  graph = true;
  page = "story";
  render();
  board.locate(scene.id);
  return scene;
}
function showConnection(id, path) {
  connectionEdit = { id, path };
  const scene = p().scenes.find((s) => s.id === id),
    t = get(scene, path),
    port = ports(scene).find((x) => x.path === path);
  panel(
    `<h2>${esc(port?.label || "剧情连接")}</h2><label class="field">下一场景<select id="connection-target"><option value="unlinked">待连接</option><option value="end">结束作品</option><option value="continue">继续播放</option><option value="home">返回开屏</option>${p()
      .scenes.map(
        (x) =>
          `<option value="${x.id}" ${t.sceneId === x.id ? "selected" : ""}>${esc(x.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><button class="primary" data-action="save-connection">确定</button> <button data-action="create-connected">新建并连接场景</button> <button data-action="unlink">移除连接</button>`,
  );
  if (t.kind !== "scene")
    $("#connection-target").value = t.kind === "seek" ? "continue" : t.kind;
}
function currentClip() {
  if (selection.kind === "clip") return selectObject();
  const id = selection.id;
  const c = visualClips(s()).find((c) => c.id === id) || mediaAt(s(), time);
  if (c) selection = { kind: "clip", id: c.id };
  return c;
}
function showClipDelete() {
  const c = currentClip();
  if (!c) {
    notify("请选择片段");
    return;
  }
  panel(
    `<h2>删除片段</h2><label class="field">后续内容<select id="delete-ripple"><option value="no">保留空位</option><option value="yes">一起前移</option></select></label>${linked(s(), c.id).length ? '<label class="field check"><input id="delete-linked" type="checkbox" checked>同时删除关联字幕、互动和声音</label>' : ""}<button class="danger" data-action="confirm-delete-clip">删除片段</button>`,
  );
}
function archiveList() {
  try {
    return JSON.parse(localStorage.getItem("storyforge-projects") || "{}");
  } catch {
    return {};
  }
}
function saveArchive(list) {
  localStorage.setItem("storyforge-projects", JSON.stringify(list));
}
async function showProjects() {
  storage.saveLocal(p());
  const local = archiveList(),
    backups = storage.backups();
  let cloud = [],
    cloudError = "";
  if (storage.token)
    try {
      cloud = await response(
        await fetch("/api/v2/projects", {
          headers: storage.headers(),
          signal: AbortSignal.timeout(15000),
        }),
      );
    } catch (e) {
      cloudError = "云端作品暂时无法读取，本机作品仍可打开。";
    }
  projectRows = projectCatalog(local, cloud);
  const card = (row) => {
    const current = row.id === p().id;
    return (
      '<article class="project-card" data-project-card="' +
      esc(row.id) +
      '"><div class="project-cover">▣</div><div class="project-card-heading"><h3>' +
      esc(row.name) +
      '</h3><details class="more-menu project-actions"><summary aria-label="' +
      esc(row.name) +
      '操作">···</summary><div><button data-action="rename-project" data-id="' +
      esc(row.id) +
      '">重命名</button><button data-action="copy-project" data-id="' +
      esc(row.id) +
      '">复制作品</button><button class="danger" data-action="delete-project" data-id="' +
      esc(row.id) +
      '">移入回收站</button></div></details></div><small>' +
      (current ? "正在编辑 · " : "") +
      (row.local && !row.local.deleted ? "本机" : "") +
      (row.cloud && !row.cloud.deleted
        ? row.local && !row.local.deleted
          ? " · 云端"
          : "云端"
        : "") +
      "</small><small>最近编辑 " +
      esc(row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—") +
      '</small><button data-action="open-managed-project" data-id="' +
      esc(row.id) +
      '">' +
      (current ? "继续编辑" : "打开作品") +
      "</button></article>"
    );
  };
  panel(
    '<h2>我的作品</h2><div class="mini-actions"><button class="primary" data-action="new-project">＋ 新建作品</button><button data-action="demo">使用示例</button></div>' +
      (cloudError ? "<p>" + cloudError + "</p>" : "") +
      '<div class="project-grid">' +
      projectRows
        .filter((x) => !x.deleted)
        .map(card)
        .join("") +
      '</div><details class="project-recovery"><summary>回收站与恢复</summary>' +
      projectRows
        .filter((x) => x.deleted)
        .map(
          (x) =>
            '<button class="full" data-action="restore-managed-project" data-id="' +
            esc(x.id) +
            '">恢复 ' +
            esc(x.name) +
            "</button>",
        )
        .join("") +
      backups
        .map(
          (x) =>
            '<button class="full" data-action="restore-backup" data-id="' +
            esc(x.key) +
            '">' +
            esc(x.label) +
            " · " +
            esc(new Date(x.updatedAt).toLocaleString()) +
            "</button>",
        )
        .join("") +
      "</details>",
  );
  for (const row of projectRows.filter((x) => !x.deleted && x.local)) {
    const project = row.local.project;
    const first = visualClips(
      project.scenes.find((x) => x.id === project.entryId) || project.scenes[0],
    )[0];
    const asset =
      project.assets[
        project.loading.image || project.loading.video || first?.assetId
      ];
    const host = [...document.querySelectorAll("[data-project-card]")]
      .find((x) => x.dataset.projectCard === row.id)
      ?.querySelector(".project-cover");
    if (!host || !asset || !["image", "video"].includes(asset.kind)) continue;
    try {
      const url = await assets.url(asset);
      if (!host.isConnected) continue;
      const media = document.createElement(
        asset.kind === "video" ? "video" : "img",
      );
      media.src = url;
      media.setAttribute("aria-label", row.name + "封面");
      if (asset.kind === "video") {
        media.muted = true;
        media.preload = "metadata";
        media.onloadedmetadata = () => {
          media.currentTime = Math.min(0.1, media.duration || 0);
        };
      }
      host.replaceChildren(media);
    } catch {}
  }
}
async function managedProject(id) {
  if (id === p().id)
    return { project: clone(p()), revision: storage.queue.revision };
  const row = projectRows.find((x) => x.id === id);
  if (!row) throw Error("作品不存在");
  if (row.local && !row.local.deleted) return row.local;
  return storage.draft(id);
}
async function workspaceAction(action, button = { dataset: {} }) {
  const ids = () => {
    const list = [...board.selected].filter((id) => !specialNode(id));
    if (!list.length) throw Error("请选择普通剧情场景；加载和开屏各保留一个");
    return list;
  };
  switch (action) {
    case "archive-cloud":
      await response(
        await fetch("/api/v2/archive", {
          method: "POST",
          headers: storage.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ id: button.dataset.id, deleted: true }),
        }),
      );
      await showProjects();
      break;
    case "restore-cloud":
      await response(
        await fetch("/api/v2/archive", {
          method: "POST",
          headers: storage.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ id: button.dataset.id, deleted: false }),
        }),
      );
      await showProjects();
      break;
    case "projects":
      await showProjects();
      break;
    case "open-local": {
      const x = archiveList()[button.dataset.id];
      await adopt(migrate(x.project), x.revision || "none");
      closePanel();
      break;
    }
    case "copy-project": {
      const source = await managedProject(button.dataset.id || p().id);
      const copy = clone(source.project);
      copy.id = uid("project");
      copy.name += " 副本";
      await adopt(copy);
      await showProjects();
      break;
    }
    case "rename-project": {
      const row = projectRows.find((x) => x.id === button.dataset.id);
      panel(
        '<h2>重命名作品</h2><label class="field">作品名称<input id="project-rename" aria-label="新作品名称" maxlength="120" value="' +
          esc(row.name) +
          '"></label><button class="primary" data-action="confirm-project-rename" data-id="' +
          esc(row.id) +
          '">保存名称</button> <button data-action="projects">取消</button>',
      );
      break;
    }
    case "confirm-project-rename": {
      const name = $("#project-rename").value.trim();
      if (!name) throw Error("请输入作品名称");
      const id = button.dataset.id,
        value = await managedProject(id);
      value.project.name = name;
      if (id === p().id) {
        mutate("重命名作品", () => (p().name = name));
        await saveCurrent();
      } else {
        const list = archiveList();
        list[id] = { ...value, updatedAt: new Date().toISOString() };
        saveArchive(list);
        if (storage.token && projectRows.find((x) => x.id === id)?.cloud) {
          const remote = await storage.draft(id);
          if (remote.revision !== value.revision)
            throw Error(
              "名称已保存在本机，云端有其他修改，请先打开作品处理版本差异",
            );
          const result = await storage.writeCloud(
            value.project,
            remote.revision,
          );
          list[id].revision = result.revision;
          saveArchive(list);
        }
      }
      await showProjects();
      break;
    }
    case "open-managed-project": {
      const id = button.dataset.id;
      const row = projectRows.find((x) => x.id === id),
        value = await managedProject(id);
      if (row.local && row.cloud && !row.cloud.deleted) {
        const remote = await storage.draft(id);
        if (remote.revision !== value.revision) {
          panel(
            '<h2>作品存在不同版本</h2><p>本机内容会保留为恢复副本，请选择要继续编辑的版本。</p><button data-action="open-local" data-id="' +
              esc(id) +
              '">继续本机版本</button><button data-action="open-project" data-id="' +
              esc(id) +
              '">打开云端版本</button>',
          );
          break;
        }
      }
      if (id !== p().id)
        await adopt(migrate(value.project), value.revision || "none");
      closePanel();
      break;
    }
    case "delete-project": {
      const id = button.dataset.id,
        row = projectRows.find((x) => x.id === id);
      await saveCurrent();
      if (row.cloud && !row.cloud.deleted)
        await response(
          await fetch("/api/v2/archive", {
            method: "POST",
            headers: storage.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ id, deleted: true }),
          }),
        );
      const list = archiveList();
      if (list[id]) {
        list[id].deleted = true;
        saveArchive(list);
      }
      if (id === p().id) await adopt(newProject(), "none", false);
      await showProjects();
      break;
    }
    case "restore-managed-project": {
      const id = button.dataset.id,
        row = projectRows.find((x) => x.id === id);
      if (row.cloud?.deleted)
        await response(
          await fetch("/api/v2/archive", {
            method: "POST",
            headers: storage.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ id, deleted: false }),
          }),
        );
      const list = archiveList();
      if (list[id]) {
        list[id].deleted = false;
        saveArchive(list);
      }
      await showProjects();
      break;
    }
    case "trash-project": {
      const list = archiveList(),
        id = button.dataset.id;
      list[id].deleted = true;
      saveArchive(list);
      if (id === p().id) await adopt(newProject());
      await showProjects();
      break;
    }
    case "restore-project": {
      const list = archiveList();
      list[button.dataset.id].deleted = false;
      saveArchive(list);
      await showProjects();
      break;
    }
    case "new-card":
      if (button.dataset.action) newCardContext = null;
      panel(
        '<h2>新建场景</h2><label class="field">名称<input id="new-scene-name" placeholder="场景名称" value="新场景"></label><label class="field">类型<select id="new-scene-type"><option value="story">空白场景</option><option value="video">视频场景</option><option value="image">图片场景</option><option value="ending">结局</option><option value="death">失败场景</option></select></label><button class="primary" data-action="create-card">创建</button>',
      );
      break;
    case "create-card": {
      const type = $("#new-scene-type").value,
        name = $("#new-scene-name").value.trim() || "新场景";
      const scene = createScene(
        name,
        ["ending", "death"].includes(type) ? type : "story",
      );
      closePanel();
      if (["video", "image"].includes(type))
        pick({ mode: "scene", sceneId: scene.id });
      break;
    }
    case "enter-scene":
      closePanel();
      enterScene(selected);
      break;
    case "rename-scene":
      mutate(
        "重命名场景",
        () => (s().name = $("#rename-scene").value.trim() || s().name),
      );
      closePanel();
      break;
    case "make-ending":
      mutate("设为结局", () => {
        s().role = "ending";
        s().next = endTarget();
      });
      closePanel();
      break;
    case "copy-scenes": {
      let copied;
      mutate("复制场景", (p) => (copied = copyScenes(p, ids())));
      selected = copied[0].id;
      board.selected = new Set(copied.map((s) => s.id));
      closePanel();
      render();
      break;
    }
    case "delete-scenes": {
      pendingDelete = ids();
      const keep = p().scenes.filter((s) => !pendingDelete.includes(s.id));
      if (!keep.length) throw Error("至少保留一个场景");
      const inbound = p().scenes.filter(
        (s) =>
          !pendingDelete.includes(s.id) &&
          targetsOf(s).some(
            (t) => t.kind === "scene" && pendingDelete.includes(t.sceneId),
          ),
      );
      panel(
        `<h2>删除 ${pendingDelete.length} 个场景？</h2><p>${inbound.length ? "关联场景：" + inbound.map((x) => esc(x.name)).join("、") + "。相关出口将标记为待连接。" : "删除后可以撤销，素材仍保留。"}</p>${pendingDelete.includes(p().entryId) ? `<label class="field">新的故事入口<select id="new-entry">${keep.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>` : ""}<button class="danger" data-action="confirm-delete-scenes">删除场景</button>`,
      );
      break;
    }
    case "confirm-delete-scenes": {
      const entry = $("#new-entry")?.value || p().entryId;
      mutate("删除场景", (p) => deleteScenes(p, pendingDelete, entry));
      selected = p().entryId;
      board.selected = new Set([selected]);
      closePanel();
      render();
      break;
    }
    case "save-connection": {
      const value = $("#connection-target").value;
      mutate("修改连接", (p) =>
        set(
          p.scenes.find((x) => x.id === connectionEdit.id),
          connectionEdit.path,
          ["unlinked", "end", "continue", "home"].includes(value)
            ? { kind: value }
            : { kind: "scene", sceneId: value },
        ),
      );
      board.pending = null;
      closePanel();
      break;
    }
    case "unlink":
      mutate("移除连接", (p) =>
        set(
          p.scenes.find((x) => x.id === connectionEdit.id),
          connectionEdit.path,
          { kind: "unlinked" },
        ),
      );
      board.pending = null;
      closePanel();
      break;
    case "create-connected": {
      const from = connectionEdit,
        scene = createScene("新场景");
      mutate("连接新场景", (p) =>
        set(
          p.scenes.find((x) => x.id === from.id),
          from.path,
          { kind: "scene", sceneId: scene.id },
        ),
      );
      board.pending = null;
      closePanel();
      break;
    }
    case "zoom-in":
      board.zoom(1.2);
      break;
    case "zoom-out":
      board.zoom(1 / 1.2);
      break;
    case "fit-graph":
      board.fit();
      break;
    case "locate-entry":
      board.locate(LOADING);
      break;
    case "pan-mode":
      board.mode = "pan";
      button.classList.add("active");
      $('[data-action="select-mode"]').classList.remove("active");
      break;
    case "select-mode":
      board.mode = "select";
      button.classList.add("active");
      $('[data-action="pan-mode"]').classList.remove("active");
      break;
    case "edit-special":
      openGraphNode([...board.selected][0]);
      break;
    case "save-flow-entry":
      mutate("设置起始剧情", (p) => (p.entryId = $("#entry-target").value));
      closePanel();
      break;
    case "edit-flow-edge": {
      const e = board.activeEdge;
      if (e) board.api.connection(e.from, e.path);
      break;
    }
    case "delete-flow-edge":
      disconnectFlow();
      break;
    case "arrange-selection":
    case "arrange-graph": {
      if (action === "arrange-selection" && board.selected.size < 2) {
        notify("请先框选至少两个节点");
        break;
      }
      mutate(
        "按剧情关系整理",
        (p) =>
          (p.editor.positions = arrangeFlow(
            p,
            ports,
            action === "arrange-selection" ? board.selected : null,
          )),
      );
      if (board.scale < 0.65) board.zoom(0.75 / board.scale);
      board.locate(
        action === "arrange-selection" ? [...board.selected][0] : LOADING,
      );
      break;
    }
    case "split-clip": {
      let next;
      mutate("分割片段", () => {
        const c = currentClip();
        if (!c) throw Error("请选择片段");
        next = splitClip(s(), c.id, time);
      });
      selection = { kind: "clip", id: next.id };
      render();
      break;
    }
    case "clip-before":
    case "clip-after":
      mutate("调整片段顺序", () =>
        reorderClip(s(), currentClip().id, action === "clip-before" ? -1 : 1),
      );
      break;
    case "copy-item": {
      let copy;
      if (["clip", "video", "image"].includes(selection.kind)) {
        mutate("复制片段", () => (copy = duplicateClip(s(), currentClip().id)));
        selection = { kind: "clip", id: copy.id };
      } else {
        const key = {
          event: "events",
          subtitle: "subtitles",
          audio: "audio",
          effect: "effects",
          overlay: "overlays",
        }[selection.kind];
        if (!key) throw Error("请选择要复制的内容");
        mutate("复制内容", () => {
          copy = clone(selectObject());
          copy.id = uid("item");
          copy.options?.forEach((o) => (o.id = uid("option")));
          s()[key].push(copy);
        });
        selection.id = copy.id;
      }
      render();
      break;
    }
    case "confirm-delete-clip": {
      const ripple = $("#delete-ripple").value === "yes",
        linkedDelete = $("#delete-linked")?.checked || false;
      mutate("删除片段", () =>
        removeClip(s(), currentClip().id, ripple, linkedDelete),
      );
      selection = { kind: "scene" };
      closePanel();
      render();
      break;
    }
    case "add-overlay": {
      const list = Object.values(p().assets).filter((x) => x.kind === "image");
      panel(
        `<h2>叠加图片</h2>${list.map((a) => `<button class="full" data-action="use-overlay" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join("") || "<p>请先导入图片素材。</p>"}<button data-action="upload-library">导入图片</button>`,
      );
      break;
    }
    case "use-overlay": {
      const x = {
        id: uid("overlay"),
        assetId: button.dataset.id,
        startMs: Math.min(time, duration(s()) - 100),
        endMs: Math.min(duration(s()), time + 3000),
        x: 50,
        y: 50,
        width: 30,
      };
      mutate("添加叠加图片", () => {
        s().overlays ||= [];
        s().overlays.push(x);
      });
      selection = { kind: "overlay", id: x.id };
      closePanel();
      render();
      break;
    }
    case "edit-connection":
      showConnection(selected, button.dataset.path);
      break;
    case "check-project":
      showIssues(false);
      break;
    case "help":
      panel(
        "<h2>快捷操作</h2><p>双击场景进入编辑；拖动空白处移动画布；按住 Shift 拖动可框选。</p><p>Ctrl / ⌘ + 滚轮缩放画布。Ctrl / ⌘ + Z 撤销，Shift + Ctrl / ⌘ + Z 重做，Ctrl / ⌘ + S 保存。</p><p>时间轴拖动片段或两端调整时间，方向键微调 0.1 秒。</p>",
      );
      break;
    case "preview-desktop":
    case "preview-portrait":
    case "preview-landscape":
      $("#preview").dataset.device = action.slice(8);
      await preview();
      break;
    default:
      return false;
  }
  return true;
}

async function renderOpening() {
  still.pauseMedia();
  openingSession?.dispose();
  const session = (openingSession = new Session($(".opening-preview"), assets, {
    editor: true,
  }));
  try {
    if (page === "loading") await session.open(p(), { design: true });
    else {
      session.project = clone(p());
      await session.home(true);
    }
    if (openingSession !== session) return;
    const v = $(".opening-preview video");
    if (v) {
      v.pause();
      v.muted = true;
      const update = () => {
        $("#opening-seek").max = Number.isFinite(v.duration) ? v.duration : 100;
        $("#opening-seek").value = v.currentTime;
        $(".opening-time").textContent = v.currentTime.toFixed(1) + "s";
        $('[data-action="opening-play"]').textContent = v.paused
          ? "▷ 播放"
          : "Ⅱ 暂停";
      };
      ["loadedmetadata", "timeupdate", "play", "pause"].forEach((name) =>
        v.addEventListener(name, update),
      );
      update();
    }
    $(".opening-transport").hidden = !v;
    $(".opening-preview .load-progress small")?.setAttribute("hidden", "");
    // A sample only; actual loading always follows real resource readiness.
    const progress = $(".opening-preview progress");
    if (progress) progress.value = 45;
  } catch (e) {
    notify(e.message);
  }
}
function renderOpeningInspector() {
  const c = p()[page],
    scope = page;
  const assetOptions = (kind) => ({
    "": "无",
    ...Object.fromEntries(
      Object.values(p().assets)
        .filter((a) => a.kind === kind)
        .map((a) => [a.id, a.name]),
    ),
  });
  let html = "";
  if (openingPart === "background") {
    html =
      "<h2>背景</h2>" +
      field("视频", "video", c.video || "", {
        scope,
        options: assetOptions("video"),
      });
    if (page === "loading")
      html +=
        field("图片", "image", c.image || "", {
          scope,
          options: assetOptions("image"),
        }) +
        field("最少展示秒数", "minimumMs", c.minimumMs, {
          scope,
          type: "number",
          millis: true,
          min: 0,
          max: 30,
          step: 0.1,
        });
    if (page === "splash")
      html += field("文字入场效果", "effect", c.effect, {
        scope,
        options: { fade: "淡入", zoom: "缓慢放大", none: "直接显示" },
      });
  } else {
    const names = {
      title: "标题",
      subtitle: "副标题",
      progress: "加载进度",
      start: "开始提示",
    };
    html = "<h2>" + names[openingPart] + "</h2>";
    const key = {
      title: "title",
      subtitle: "subtitle",
      progress: "text",
      start: "startText",
    }[openingPart];
    html += field("文字", key, c[key] ?? "点击或按任意键开始", { scope });
    if (openingPart === "progress")
      html += field("进度颜色", "color", c.color, { scope, type: "color" });
    if (openingPart === "title" && page === "loading")
      html += field("排布", "titleLayout", c.titleLayout, {
        scope,
        options: { square: "方形", normal: "单行" },
      });
    const layout = c.layout?.[openingPart] || openingDefaults(openingPart);
    for (const [key, label, min, max] of [
      ["x", "横向位置 %", 0, 100],
      ["y", "纵向位置 %", 0, 100],
      ["size", "字号", 10, 160],
      ["width", "宽度 %", 5, 100],
    ])
      html += field(label, "layout." + openingPart + "." + key, layout[key], {
        scope,
        type: "number",
        min,
        max,
      });
    html += field(
      "文字颜色",
      "layout." + openingPart + ".color",
      layout.color,
      { scope, type: "color" },
    );
  }
  $(".inspector").innerHTML = html;
}
function openingDefaults(kind) {
  const el = $('.opening-preview [data-opening-element="' + kind + '"]'),
    frame = $(".opening-preview .opening-frame");
  if (el && frame) {
    const a = el.getBoundingClientRect(),
      b = frame.getBoundingClientRect();
    return {
      x: +(((a.x + a.width / 2 - b.x) / b.width) * 100).toFixed(1),
      y: +(((a.y + a.height / 2 - b.y) / b.height) * 100).toFixed(1),
      size: Math.round(
        (parseFloat(getComputedStyle(el).fontSize) / b.width) * 1920,
      ),
      width: +((a.width / b.width) * 100).toFixed(1),
      color: "#e5d6b1",
    };
  }
  return {
    x: 50,
    y: kind === "progress" || kind === "start" ? 82 : 40,
    size: kind === "title" ? 90 : 32,
    width: kind === "progress" ? 30 : 70,
    color: "#e5d6b1",
  };
}
function openingPointer(e) {
  if (e.button !== 0) return;
  const el = e.target.closest("[data-opening-element]");
  if (!el) {
    openingPart = "background";
    renderLibrary();
    renderOpeningInspector();
    return;
  }
  e.preventDefault();
  openingPart = el.dataset.openingElement;
  renderLibrary();
  renderOpeningInspector();
  const defaults = openingDefaults(openingPart),
    kind = openingPart,
    scope = page,
    frame = $(".opening-preview .opening-frame"),
    rect = frame.getBoundingClientRect(),
    start = { x: e.clientX, y: e.clientY };
  const controller = new AbortController();
  let dx = 0,
    dy = 0;
  window.addEventListener(
    "pointermove",
    (ev) => {
      dx = ((ev.clientX - start.x) / rect.width) * 100;
      dy = ((ev.clientY - start.y) / rect.height) * 100;
      el.style.translate =
        ev.clientX - start.x + "px " + (ev.clientY - start.y) + "px";
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "pointerup",
    () => {
      controller.abort();
      el.style.translate = "";
      if (Math.abs(dx) + Math.abs(dy) > 0.2)
        mutate("调整开场元素", () => {
          p()[scope].layout ||= {};
          p()[scope].layout[kind] = {
            ...defaults,
            ...p()[scope].layout[kind],
            x: +clamp(defaults.x + dx, 0, 100).toFixed(1),
            y: +clamp(defaults.y + dy, 0, 100).toFixed(1),
          };
        });
    },
    { once: true, signal: controller.signal },
  );
  window.addEventListener(
    "pointercancel",
    () => {
      controller.abort();
      el.style.translate = "";
    },
    { once: true, signal: controller.signal },
  );
}

function openGraphNode(id) {
  if (specialNode(id)) {
    page = id === LOADING ? "loading" : "splash";
    openingPart = "background";
    render();
    return;
  }
  enterScene(id);
}
function connectFlow(project, id, path, target) {
  if (id === LOADING) throw Error("加载完成后固定进入开屏");
  if (target === LOADING) throw Error("加载节点只用于作品入口");
  if (id === SPLASH) {
    if (specialNode(target)) throw Error("开屏需要连接普通剧情");
    project.entryId = target;
    return;
  }
  const scene = project.scenes.find((s) => s.id === id);
  if (!scene) throw Error("源场景不存在");
  if (!specialNode(target) && !project.scenes.some((s) => s.id === target))
    throw Error("目标场景不存在");
  set(
    scene,
    path,
    target === SPLASH ? { kind: "home" } : { kind: "scene", sceneId: target },
  );
}
function renderEdgeInspector(edge) {
  const fixed = edge.from === LOADING,
    entry = edge.from === SPLASH;
  $(".inspector").innerHTML =
    "<h2>剧情连接</h2>" +
    (fixed
      ? "<p>加载完成 → 开屏</p>"
      : '<button data-action="edit-flow-edge">更换目标</button>' +
        (entry
          ? ""
          : '<button class="danger" data-action="delete-flow-edge">断开连接</button>'));
}
function disconnectFlow() {
  const edge = board.activeEdge;
  if (!edge) return;
  if (specialNode(edge.from)) {
    notify("入口连接需保留，可更换起始剧情");
    return;
  }
  mutate("断开连接", (p) =>
    set(
      p.scenes.find((s) => s.id === edge.from),
      edge.path,
      { kind: "unlinked" },
    ),
  );
  board.activeEdge = null;
  render();
}
