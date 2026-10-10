import { timelineThumbnail, audioWaveform } from "./timeline-media.mjs";
import { rulerTicks, previewRate, zoomScroll } from "./timeline-controls.mjs";
import {
  moveSelection,
  copySelection,
  pasteSelection,
} from "./timeline-selection.mjs";
import {
  trackRows,
  assignTrack,
  reorderTrack,
  interactionConflicts,
  materializeTracks,
} from "./tracks.mjs";
const trackPreview = new Map();
function previewTracks() {
  const key = p().id + ":" + selected;
  if (!trackPreview.has(key))
    trackPreview.set(key, { hidden: new Set(), locked: new Set() });
  return trackPreview.get(key);
}
import { projectCatalog } from "./project-catalog.mjs";
import { AssetLibrary, mediaUses, deletionPlan } from "./asset-library.mjs";
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
  liftVisual,
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
  unifyCards,
  openingRole,
  openingCard,
  openingElements,
  changeRole,
  setCardNext,
  migrate,
  validate,
  duration,
  references,
  targetsOf,
  gestures,
  endTarget,
} from "./model.mjs";
import { AssetStore, resolveOpeningMedia, inspect } from "./assets.mjs";
import {
  Storage,
  esc,
  exportZip,
  importZip,
  LOCAL_KEY,
  response,
} from "./storage.mjs";
import { History } from "./history.mjs";
import { repairTechnicalData, describeIssues } from "./check-project.mjs";
import { PlayerView } from "./player-view.mjs";
import { Session } from "./session.mjs";

const $ = (s) => document.querySelector(s),
  assets = new AssetStore();
let timelinePlaying = false,
  timelineFrame = 0,
  scrubFrame = 0,
  snapEnabled = true;
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
  pendingRole = null,
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
let idleWorkspace = false;
let pendingAssetDeletion = [],
  pendingProjectPurge = [];
let projectRequest = 0,
  workspaceReturn = null;
let projectCloudReady = false;
let timelineClipboard = null;
const timelineSelection = new Set();
const propertyTabs = new Map();
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
    history.commit(label, (project) => {
      for (const scene of project.scenes) materializeTracks(scene);
      fn(project);
      for (const scene of project.scenes) materializeTracks(scene);
    });
  } catch (error) {
    notify(error.message);
    throw error;
  }
}
function changed() {
  if (idleWorkspace) return;
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
  if (idleWorkspace) return;
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
  if (selection.kind === "opening")
    return scene.opening?.elements?.[selection.id];
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
  if (path === "next" && openingRole(s()))
    return (
      `<h3>${s().role === "loading" ? "加载完成后" : "点击开始后"}</h3>` +
      field("后续动作", "next.kind", t.kind, {
        options: { scene: "进入另一张节点", unlinked: "待连接" },
      }) +
      (t.kind === "scene"
        ? field("目标节点", "next.sceneId", t.sceneId, {
            options: Object.fromEntries(
              p()
                .scenes.filter(
                  (x) =>
                    x.role !== "loading" &&
                    (s().role !== "splash" || !openingRole(x)),
                )
                .map((x) => [x.id, x.name]),
            ),
          })
        : "")
    );
  return `<h3>${label}</h3>${field("后续动作", path + ".kind", t.kind, { options: { continue: "继续当前视频", scene: "进入另一剧情节点", seek: "跳到当前视频位置", end: "结束作品", unlinked: "待连接", home: "返回开屏" } })}${t.kind === "scene" ? field("目标节点", path + ".sceneId", t.sceneId, { options: Object.fromEntries(p().scenes.map((x) => [x.id, x.name])) }) : t.kind === "seek" ? seconds("跳转到（秒）", path + ".timeMs", t.timeMs) : ""}`;
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
        sceneEnd: "当前节点播完后执行",
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
    '<header class="topbar"><div class="brand"><b>T</b>故事引擎 TaleSpark</div><span class="top-divider"></span><span class="project-name" aria-label="作品名称"></span><span class="save-status"></span><button data-action="undo" aria-label="撤销" title="撤销 Ctrl+Z">↶</button><button data-action="redo" aria-label="重做" title="重做 Ctrl+Shift+Z">↷</button><button data-action="save">保存</button><details class="more-menu general-menu"><summary aria-label="通用菜单" title="通用菜单">☰</summary><div><button data-action="import">导入作品</button><button data-action="export">导出备份</button><hr><button data-action="check-project">检查作品</button><button data-action="versions">发布历史</button><hr><button data-action="help">帮助与快捷键</button></div></details><button data-action="preview-all">▷ 完整试玩</button><button class="primary" data-action="publish">发布</button></header>\n<div class="layout"><nav class="rail"><button data-page="story" title="剧情画布"><b>⌘</b>画布</button><button data-page="assets" title="素材库"><b>▧</b>素材</button><button data-page="theme" title="作品设置"><b>⚙</b>设置</button><button class="bottom" data-action="projects" title="作品管理"><b>▦</b>作品</button></nav><aside class="library"></aside><main class="workspace"><div class="workspace-head"><button data-action="graph-view" class="back-button" title="返回剧情画布">← 画布</button><h1>剧情画布</h1><button data-action="canvas-view">进入编辑</button><button data-action="preview-current">▷ 试玩当前节点</button><details class="more-menu"><summary title="预览尺寸">预览设备</summary><div><button data-action="preview-desktop">桌面预览</button><button data-action="preview-portrait">手机竖屏</button><button data-action="preview-landscape">手机横屏</button></div></details></div><div class="story-work"><div class="canvas-label"><span></span></div><div class="canvas"><div class="player-root"></div></div><div class="board-list" hidden></div><div class="transport"><button data-action="preview-here" aria-label="播放预览" title="播放预览（空格）">▷ 播放</button><span class="time-label"></span><input id="seek" type="range" min="0" step="10" aria-label="画面进度"><span class="duration-label"></span></div><div class="timeline-head"><span>时间轴</span><div class="clip-tools"><button data-action="split-clip" title="在播放头处分割">分割</button><button data-action="copy-item" title="复制选中内容 Ctrl+C">复制</button><button data-action="paste-item" title="粘贴到播放指针 Ctrl+V">粘贴</button><button data-action="delete-item" title="删除选中内容">删除</button><button data-action="toggle-snap" aria-pressed="true">吸附：开</button><button data-action="fit-timeline">显示全部</button></div><label>缩放 <input id="zoom" type="range" min="1" max="8" step=".25" value="1.5"></label></div><div class="timeline-actions"><button data-action="upload-scene">＋ 素材</button><button data-action="add-qte">动作互动</button><button data-action="add-choice">分支选择</button><button data-action="add-hotspot">点击区域</button><button data-action="add-subtitle">字幕</button><button data-action="add-audio">音频</button><button data-action="add-overlay">叠加画面</button><details class="more-menu"><summary>效果</summary><div><button data-action="add-speed">慢放区间</button><button data-action="add-bars">电影黑边</button></div></details></div><div class="timeline-scroll"></div></div><div class="graph-area"><div class="graph-toptools"><button data-action="toggle-directory" title="展开或收起节点目录">节点目录</button><button class="primary" data-action="new-card">＋ 新建节点</button><div class="selection-tools"><button data-action="copy-scenes">复制</button><button data-action="delete-scenes">删除</button></div></div><div class="graph-scroll"><div class="graph-board"></div></div><div class="graph-bottomtools"><span></span><button data-action="zoom-out" aria-label="缩小画布">−</button><button data-action="reset-zoom" id="graph-scale" title="恢复 100%">100%</button><button data-action="zoom-in" aria-label="放大画布">＋</button><button data-action="fit-graph">适应画布</button><details class="more-menu graph-view-menu"><summary>视图</summary><div><button data-action="pan-mode">拖动画布</button><button data-action="select-mode">框选节点</button><hr><button data-action="toggle-lines" aria-pressed="false">显示全部连线</button><button data-action="toggle-minimap" aria-pressed="true">显示小地图</button><button data-action="locate-entry">定位起始节点</button><button data-action="arrange-selection">整理选中节点</button></div></details><button data-action="arrange-graph" title="按剧情关系整理全部">整理布局</button></div><div class="minimap" title="点击定位节点"></div></div><div class="opening-work" hidden><div class="opening-preview"></div><div class="opening-transport"><button data-action="opening-play">▷ 播放</button><input type="range" id="opening-seek" min="0" max="100" step="0.01" value="0" aria-label="开场视频进度"><span class="opening-time">0.0s</span></div></div><div class="settings-page" hidden></div><div class="projects-page" hidden></div></main><aside class="inspector"></aside></div>';
  setupEditingLayout();
  still = new PlayerView($(".canvas .player-root"), assets, {
    editing: true,
    onSelect: (id, kind = "event") => {
      selection = { kind, id };
      timelineSelection.clear();
      timelineSelection.add(id);
      renderInspector();
      renderTimeline();
      revealTimelineItem(id);
      markPreviewSelection();
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
  $("#seek").hidden = true;
  $("#zoom").oninput = (e) => {
    setTimelineZoom(+e.target.value);
  };
  $(".timeline-scroll").addEventListener("pointerdown", timelinePointer);
  $(".timeline-scroll").addEventListener("keydown", timelineKey);
  $(".timeline-scroll").addEventListener("wheel", timelineWheel, {
    passive: false,
  });
  $(".timeline-scroll").addEventListener("contextmenu", timelineContext);
  document.addEventListener("keydown", previewKeys);
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".timeline-context"))
      $(".timeline-context")?.remove();
  });
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
    mutate("调整节点顺序", (p) => {
      const i = p.scenes.findIndex((x) => x.id === id),
        j = p.scenes.findIndex((x) => x.id === to);
      if (i >= 0 && j >= 0) p.scenes.splice(j, 0, p.scenes.splice(i, 1)[0]);
    });
  });
}
function render() {
  stopTimelinePlayback();
  if (idleWorkspace) page = "projects";
  document.body.dataset.page = page;
  document
    .querySelectorAll(".topbar button[data-action], .rail button[data-page]")
    .forEach((b) => {
      b.disabled =
        idleWorkspace &&
        !["import", "help", "projects"].includes(b.dataset.action);
    });
  if (idleWorkspace) {
    $(".project-name").textContent = "";
    status("请选择或新建作品");
  }
  $(".projects-page").hidden = page !== "projects";
  if (page === "projects") {
    document.body.dataset.view = "projects";
    $(".workspace-head").hidden = true;
    $(".story-work").hidden = true;
    $(".graph-area").hidden = true;
    $(".opening-work").hidden = true;
    $(".settings-page").hidden = true;
    document
      .querySelectorAll(".rail button")
      .forEach((b) => b.classList.remove("active"));
    $(".rail .bottom").classList.add("active");
    return;
  }
  $(".rail .bottom").classList.remove("active");
  const menu = $(".general-menu");
  const menuHost = $(".topbar");
  if (menu.parentElement !== menuHost) {
    menu.removeAttribute("open");
    menuHost.insertBefore(menu, menuHost.querySelector('[data-action="save"]'));
  }
  if (menu.nextElementSibling?.dataset.action !== "save")
    menuHost.insertBefore(menu, menuHost.querySelector('[data-action="save"]'));
  for (const a of ["redo", "undo"]) {
    const b = $(".topbar [data-action=" + a + "]");
    if (b) $(".graph-bottomtools").prepend(b);
  }
  if (!p().scenes.some((x) => x.id === selected)) selected = p().entryId;
  if (!selectObject()) selection = { kind: "scene" };
  time = clamp(Number.isFinite(time) ? time : 0, 0, editableDuration());
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
    page === "story" ? "▷ 试玩当前节点" : "▷ 预览";
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
  $(".time-label").textContent = (time / 1000).toFixed(2) + "s";
  const sceneDuration = duration(s());
  $(".duration-label").textContent = Number.isFinite(sceneDuration)
    ? (sceneDuration / 1000).toFixed(1) + "s"
    : "时长待修复";
  $("#seek").max = editableDuration();
  $("#seek").value = time;
  still.previewHiddenTracks = previewTracks().hidden;
  still.timelineRate = previewRate(s(), time);
  still
    .renderStill(p(), s(), time, null)
    .then(() => markPreviewSelection())
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
                ? "点击区域"
                : gestures[x.gesture]
            : kind === "subtitle"
              ? x.text
              : ["audio", "overlay"].includes(kind)
                ? p().assets[x.assetId]?.name
                : x.kind === "speed"
                  ? `${x.value} 倍速`
                  : "电影黑边",
      });
  if (openingRole(scene))
    for (const [id, range] of Object.entries(scene.opening.elements || {}))
      if (
        (scene.role === "loading"
          ? ["title", "subtitle", "progress"]
          : ["title", "subtitle", "start"]
        ).includes(id)
      )
        list.push({
          id,
          kind: "opening",
          start: range.startMs,
          end: range.endMs,
          label: {
            title: "标题",
            subtitle: "副标题",
            progress: "加载进度",
            start: "开始按钮",
          }[id],
        });
  return list;
}
function renderTimeline() {
  if (page !== "story") return;
  const d = timelineSpan();
  const all = items(),
    rows = trackRows(s()),
    state = previewTracks();
  const conflicts = interactionConflicts(s());
  const main = {
    id: "main",
    name: "主画面",
    kind: "video",
    items: all.filter((x) => ["video", "image", "clip"].includes(x.kind)),
  };
  const opening = all
    .filter((x) => x.kind === "opening")
    .map((x) => ({
      id: "opening:" + x.id,
      name: x.label,
      kind: "opening",
      items: [x],
    }));
  const effects = ["speed", "bars"]
    .map((kind) => ({
      id: kind,
      name: kind === "speed" ? "播放速度" : "电影黑边",
      kind: "effect",
      items: all.filter(
        (x) =>
          x.kind === "effect" &&
          s().effects.find((e) => e.id === x.id)?.kind === kind,
      ),
    }))
    .filter((r) => r.items.length);
  const mapped = rows.map((row) => ({
    ...row,
    items: row.items.map((x) => all.find((v) => v.id === x.id)).filter(Boolean),
  }));
  const display = [
    ...mapped.filter((r) => r.kind === "event"),
    ...opening,
    ...mapped.filter((r) => r.kind === "visual"),

    main,
    ...mapped.filter((r) => r.kind === "audio"),

    ...effects,
  ];
  const scroll = $(".timeline-scroll").scrollLeft;
  const ticks = rulerTicks(
    d,
    Math.max(200, $(".timeline-scroll").clientWidth * zoom - 70),
  );
  $(".timeline-scroll").innerHTML =
    `<div class="timeline-inner" style="width:${zoom * 100}%"><div class="ruler">${ticks.map((t) => `<span style="left:${(t / d) * 100}%">${(t / 1000).toFixed(t < 1000 ? 2 : 1)}s</span>`).join("")}${(s().markers || []).map((x) => `<button class="timeline-marker" data-action="goto-marker" data-id="${esc(x.id)}" style="left:${(x.timeMs / d) * 100}%" title="${esc(x.name)} · ${(x.timeMs / 1000).toFixed(2)} 秒">◆</button>`).join("")}</div>${display
      .map((row) => {
        const type = row.kind === "visual" ? "overlay" : row.kind;
        const hidden = state.hidden.has(row.id),
          locked = state.locked.has(row.id);
        return `<div class="track ${hidden ? "preview-hidden" : ""} ${locked ? "track-locked" : ""}" data-track="${type}" data-track-id="${esc(row.id)}"><div class="track-label"><span>${esc(row.name)}</span><div class="track-controls">${["visual", "audio"].includes(row.kind) ? `<button data-action="track-preview" data-id="${esc(row.id)}" title="${row.kind === "audio" ? "仅在编辑预览中静音" : "仅在编辑预览中隐藏"}" aria-pressed="${hidden}">${row.kind === "audio" ? "♪" : "◉"}</button>` : ""}<button data-action="track-lock" data-id="${esc(row.id)}" aria-label="${locked ? "解锁轨道" : "锁定轨道"}" title="${locked ? "解锁轨道" : "锁定轨道"}" aria-pressed="${locked}">${locked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0"/></svg>'}</button></div></div><div class="lane">${
          row.kind === "event"
            ? conflicts
                .filter((c) =>
                  row.items.some((x) => x.id === c.a.id || x.id === c.b.id),
                )
                .map(
                  (c) =>
                    `<button class="interaction-conflict" data-action="timeline-conflict" data-id="${esc(c.a.id)}" style="left:${(c.start / d) * 100}%;width:${Math.max(0.5, ((c.end - c.start) / d) * 100)}%" title="两个独立互动同时等待操作，点击查看">!</button>`,
                )
                .join("")
            : ""
        }${row.items.map((x) => `<div tabindex="0" role="button" aria-label="${esc(x.label)}" data-clip="${esc(x.id)}" data-kind="${x.kind}" class="clip ${x.kind} ${x.kind === "event" ? "fixed-duration" : ""} ${selection.id === x.id || timelineSelection.has(x.id) ? "selected" : ""}" style="${timelineItemStyle(x, d)}" title="${esc(x.label)} · ${sec(x.start)}—${sec(x.end)} 秒${x.kind === "event" ? " · 固定时长，整体拖动调整出现位置" : ""}">${x.kind === "event" ? '<span class="interaction-clip-icon" aria-hidden="true">◇</span>' : '<i class="handle left" data-edge="left"></i>'}<span class="clip-name">${esc(x.label)}</span>${x.kind === "event" ? "" : '<i class="handle right" data-edge="right"></i>'}</div>`).join("")}</div></div>`;
      })
      .join(
        "",
      )}<div class="playhead"><button class="playhead-grip" aria-label="拖动播放头" title="拖动播放头"></button><span class="playhead-time"></span></div></div>`;
  $(".timeline-scroll").scrollLeft = scroll;
  updatePlayhead();
  paintTimelineMedia();
}
function updatePlayhead() {
  const line = $(".playhead");
  if (line)
    line.style.left = `calc(70px + (100% - 70px) * ${time / timelineSpan()})`;
  $(".time-label").textContent = sec(time).toFixed(2) + "s";
  if ($(".playhead-time"))
    $(".playhead-time").textContent = sec(time).toFixed(2) + "s";
  const c = ["clip", "video", "image"].includes(selection.kind)
    ? visualClips(s()).find((x) => x.id === selection.id)
    : null;
  const button = $('.timeline-head [data-action="split-clip"]');
  if (button)
    button.disabled =
      !c || time <= c.startMs || time >= c.startMs + clipLength(c);
}
function renderInspector() {
  const panel = $(".inspector"),
    scroll =
      panel.querySelector(".inspector-body")?.scrollTop || panel.scrollTop;
  renderInspectorContent();
  organizeProperties(panel);
  fixInspectorHeader();
  if (page === "story" && graph) {
    const close = document.createElement("button");
    close.className = "inspector-close";
    close.dataset.action = "close-inspector";
    close.setAttribute("aria-label", "关闭属性面板");
    close.textContent = "×";
    panel.prepend(close);
  }
  (panel.querySelector(".inspector-body") || panel).scrollTop = scroll;
}
function renderInspectorContent() {
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
      `<h2>${id === LOADING ? "加载" : "开屏"}</h2><button data-action="edit-special">进入编辑</button><p class="muted">${id === LOADING ? "准备完成后进入开屏" : "点击开始后进入起始节点"}</p>`;
    return;
  }
  if (page === "loading" || page === "splash") {
    renderOpeningInspector();
    return;
  }
  if (page === "story" && selection.kind === "opening") {
    renderOpeningElementInspector();
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
      seconds("节点开始（秒）", "startMs", obj.startMs) +
      seconds("素材入点（秒）", "inMs", obj.inMs) +
      seconds("素材出点（秒）", "outMs", obj.outMs) +
      '<div class="mini-actions"><button data-action="clip-before">前移</button><button data-action="clip-after">后移</button><button data-action="split-clip">分割</button><button data-action="copy-item">复制</button><button data-action="delete-item">删除</button></div>';
  } else if (page === "story" && selection.kind === "overlay") {
    html =
      `<h2>叠加${p().assets[obj.assetId]?.kind === "video" ? "视频" : "图片"}</h2>` +
      seconds("出现时间（秒）", "startMs", obj.startMs) +
      seconds("结束时间（秒）", "endMs", obj.endMs) +
      (p().assets[obj.assetId]?.kind === "video"
        ? seconds("从素材哪里开始（秒）", "inMs", obj.inMs || 0) +
          field("视频原声音量", "volume", obj.volume ?? 1, {
            type: "number",
            min: 0,
            max: 1,
            step: 0.05,
          })
        : "") +
      field("横向位置 %", "x", obj.x, { type: "number", min: 0, max: 100 }) +
      field("纵向位置 %", "y", obj.y, { type: "number", min: 0, max: 100 }) +
      field("宽度 %", "width", obj.width, {
        type: "number",
        min: 1,
        max: 100,
      }) +
      '<button data-action="delete-item">删除叠加素材</button>';
  } else if (page !== "story") {
    html += "";
  } else if (selection.kind === "scene")
    html +=
      field("节点名称", "name", scene.name) +
      field("剧情提示", "subtitle", scene.subtitle, { type: "textarea" }) +
      field("节点用途", "role", scene.role, {
        options: {
          story: "剧情",
          loading: "加载",
          splash: "开屏",
          death: "失败",
          ending: "结局",
        },
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
      `<button class="full" data-action="upload-scene">＋ 添加视频 / 图片</button><button class="full" data-action="video-link">从视频直链导入</button>${scene.video ? `<button class="full" data-select-kind="video" data-select-id="${scene.video.id}">编辑视频入点 / 出点</button>` : visualClips(scene).length ? "" : seconds("空节点时长（秒）", "durationMs", scene.durationMs)}${targetFields("播放结束后", "next", scene.next)}<button class="full danger" data-action="delete-scene">删除当前节点</button>`;
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
        options: { qte: "动作互动", choice: "分支选择", hotspot: "点击区域" },
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
        field("入场动效", "entryMotion", obj.entryMotion || "classic", {
          options: { classic: "经典动效", fade: "淡入", none: "直接显示" },
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
        }) +
        field("入场动效", "entryMotion", obj.entryMotion || "none", {
          options: { none: "直接显示", fade: "淡入" },
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
        }) +
        seconds("淡入时长（秒）", "fadeInMs", obj.fadeInMs || 0) +
        seconds("淡出时长（秒）", "fadeOutMs", obj.fadeOutMs || 0);
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
    html += `<div class="issues"><strong>这张节点有 ${critical.length} 项需要处理</strong><button data-action="check-project">查看问题与处理方式</button></div>`;
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
      "<h2>节点</h2>" +
      field("名称", "name", scene.name) +
      field("用途", "role", scene.role, {
        options: {
          story: "剧情",
          loading: "加载",
          splash: "开屏",
          ending: "结局",
          death: "失败",
        },
      }) +
      (openingRole(scene)
        ? ""
        : '<div class="mini-actions"><button data-action="set-entry">设为起始节点</button></div>') +
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
        .join("");
  if (page === "story" && selection.kind === "scene" && openingRole(scene))
    html += openingSettings(scene);
  $(".inspector").innerHTML = html;
  if (page === "story" && !graph && selection.kind === "scene") {
    const host = $(".inspector"),
      disclosure = document.createElement("details");
    disclosure.innerHTML = "<summary>节点显示设置</summary>";
    for (const path of ["subtitle", "clean", "grayscale", "pending"]) {
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
function openingSettings(scene) {
  const c = scene.opening,
    scope = "scene";
  return (
    "<h3>开场设置</h3>" +
    field("循环背景", "opening.loop", !!c.loop, { scope, type: "checkbox" }) +
    (scene.role === "loading"
      ? field("最少展示（秒）", "opening.minimumMs", c.minimumMs || 0, {
          scope,
          type: "number",
          millis: true,
          min: 0,
          max: 30,
          step: 0.1,
        })
      : field("文字入场", "opening.effect", c.effect || "none", {
          scope,
          options: { none: "直接显示", fade: "淡入", zoom: "缓慢放大" },
        })) +
    "<details><summary>标题与按钮</summary>" +
    field("标题", "opening.title", c.title || "", { scope }) +
    field("副标题", "opening.subtitle", c.subtitle || "", { scope }) +
    (scene.role === "loading"
      ? field("加载提示", "opening.text", c.text || "", { scope }) +
        field("进度颜色", "opening.color", c.color || "#e5d6b1", {
          scope,
          type: "color",
        }) +
        field("标题排布", "opening.titleLayout", c.titleLayout || "normal", {
          scope,
          options: { square: "方形", normal: "单行" },
        })
      : field(
          "开始按钮文字",
          "opening.startText",
          c.startText ?? "点击或按任意键开始",
          { scope },
        )) +
    "</details>"
  );
}
function renderOpeningElementInspector() {
  const key = selection.id,
    c = s().opening,
    range = selectObject(),
    label = {
      title: "标题",
      subtitle: "副标题",
      progress: "加载进度",
      start: "开始按钮",
    }[key],
    property = {
      title: "title",
      subtitle: "subtitle",
      progress: "text",
      start: "startText",
    }[key];
  let html =
    `<h2>${label}</h2>` +
    field("文字", "opening." + property, c[property] ?? "", {
      scope: "scene",
    }) +
    seconds("出现时间（秒）", "startMs", range.startMs) +
    seconds("结束时间（秒）", "endMs", range.endMs) +
    field("隐藏", "hidden", range.hidden, { type: "checkbox" });
  const style = c.layout?.[key] || openingDefaults(key);
  for (const [name, label, min, max] of [
    ["x", "横向位置 %", 0, 100],
    ["y", "纵向位置 %", 0, 100],
    ["size", "字号", 1, 300],
    ["width", "宽度 %", 1, 100],
  ])
    html += field(label, `opening.layout.${key}.${name}`, style[name], {
      scope: "scene",
      type: "number",
      min,
      max,
    });
  html += field("文字颜色", `opening.layout.${key}.color`, style.color, {
    scope: "scene",
    type: "color",
  });
  $(".inspector").innerHTML = html;
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
    `<button data-action="upload-opening">＋ 上传 / 替换背景素材</button><p class="muted">${page === "loading" ? "" : "视频循环播放，玩家点击或按键后进入明确的开始节点。"}</p>`;
}
function ports(scene) {
  if (openingRole(scene))
    return [
      {
        path: "next",
        label: scene.role === "loading" ? "加载完成" : "点击开始",
        target: scene.next,
      },
    ];
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
  if (idleWorkspace) return;
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
  if (history && backup && !idleWorkspace) {
    if (project.id === p().id && revision !== storage.queue.revision)
      storage.saveLocal(p());
    else await saveCurrent();
  }
  clearTimeout(saveTimer);
  storage.queue.pending = null;
  storage.queue.stopped = true;
  if (storage.queue.running) await storage.queue.running;
  if (history && backup && !idleWorkspace) storage.backup(p(), "切换作品前");
  project = unifyCards(project);
  await resolveOpeningMedia(project, assets).catch((e) => notify(e.message));
  idleWorkspace = false;
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
  if (project && archiveList()[project.id]?.deleted) project = null;
  idleWorkspace = !project;
  if (!project) project = newProject(); // Internal shell only; never saved until explicit creation.
  if (!idleWorkspace && storage.token && !saved) {
    try {
      const draft = await storage.draft(project.id);
      project = migrate(draft.project);
      revision = draft.revision;
    } catch {}
  }
  project = unifyCards(project);
  await resolveOpeningMedia(project, assets).catch((e) => notify(e.message));
  history = new History(project, changed);
  selected = project.entryId;
  shell();
  storage.queue.revision = revision;
  if (!idleWorkspace) storage.saveLocal(project);
  render();
  if (idleWorkspace) await showProjects();
  else status("已保存到本机");
}
async function preview({ full = false, here = false } = {}) {
  stopTimelinePlayback();
  previewSession?.dispose();
  const previewProject = clone(p());
  for (const scene of previewProject.scenes) {
    const hidden = trackPreview.get(p().id + ":" + scene.id)?.hidden;
    if (!hidden) continue;
    scene.previewHiddenTracks = [...hidden];
  }
  previewSession = new Session($(".preview-host"), assets, {
    editor: true,
    onExit: () => $("#preview").close(),
    onBlocked: (sceneId, eventId) => {
      $("#preview").close();
      selected = sceneId;
      page = "story";
      graph = false;
      selection = eventId ? { kind: "event", id: eventId } : { kind: "scene" };
      render();
    },
  });
  $("#preview").showModal();
  const previewPage =
    page === "story" && graph && specialNode([...board.selected][0])
      ? [...board.selected][0] === LOADING
        ? "loading"
        : "splash"
      : page;
  if (!full && previewPage === "splash") {
    previewSession.project = previewProject;
    await previewSession.home();
  } else
    await previewSession.open(
      previewProject,
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
        '">添加到当前节点</button>',
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
      '">添加到当前节点</button>',
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
let checkRequest = 0,
  checkState = null;
async function showIssues(publishing, { repair = true } = {}) {
  if (busy) throw Error("请等待素材导入完成");
  const request = ++checkRequest,
    before = JSON.stringify(p()),
    projectId = p().id;
  panel(`<h2>正在检查作品</h2><p>正在读取素材信息，自动处理能确定的问题…</p>`);
  const result = repair
    ? await repairTechnicalData(p(), async (a) =>
        inspect(await assets.url(a), a.kind),
      )
    : { project: p(), repairs: [], failures: [] };
  if (request !== checkRequest || !$("#panel").open) return;
  if (before !== JSON.stringify(p())) {
    panel(
      '<h2>作品已发生变化</h2><p>本次检查结果未应用，请重新检查最新内容。</p><button data-action="check-project">重新检查</button>',
    );
    return;
  }
  if (!checkState || checkState.projectId !== projectId)
    checkState = { projectId, repairs: [] };
  if (result.repairs.length) {
    storage.backup(p(), "作品检查自动修复前");
    mutate("作品检查自动修复", (project) =>
      Object.assign(project, result.project),
    );
    checkState.repairs = result.repairs;
    checkState.transaction = history.past.at(-1);
  }
  checkState.publishing = publishing;
  checkState.issues = describeIssues(p(), {
    publish: true,
    failures: result.failures,
  });
  renderCheckReport();
}
function renderCheckReport() {
  const { issues, repairs, publishing } = checkState;
  const errors = issues.filter((x) => x.level === "error"),
    warnings = issues.filter((x) => x.level !== "error");
  const groups = new Map();
  for (const x of [...errors, ...warnings]) {
    const key = x.sceneId || "@project";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const canUndo =
    checkState.transaction && history.past.at(-1) === checkState.transaction;
  panel(
    `<section class="check-report"><h2>${publishing ? "发布前检查" : "作品检查"}</h2><div class="check-summary"><strong>${errors.length ? `${errors.length} 项需要处理` : "没有阻止发布的问题"}</strong><span>${warnings.length ? `另有 ${warnings.length} 项提醒` : ""}</span><button data-action="check-again">重新检查</button></div>${repairs.length ? `<details class="check-repairs"><summary>已自动修复 ${repairs.length} 项 · 查看记录</summary>${repairs.map((r) => `<p>${esc(r.message)}</p>`).join("")}<button data-action="undo-check-repairs" ${canUndo ? "" : "disabled"}>撤销本次自动修复</button>${canUndo ? "" : "<small>修复后已有其他编辑，可通过顶部撤销逐步恢复，或在作品中打开修复前副本。</small>"}</details>` : ""}${!issues.length ? '<p class="check-success">当前配置检查通过。发布时会继续确认素材和运行端能否读取。</p>' : [...groups].map(([id, list]) => `<details class="check-group" open><summary>${esc(p().scenes.find((s) => s.id === id)?.name || "作品与素材")} <small>${list.length} 项</small></summary>${list.map((x) => `<article class="check-item ${x.level}"><span class="check-level">${x.level === "error" ? "需要处理 · 发布前" : "提醒 · 可继续编辑和发布"}</span><h3>${esc(x.title)}</h3><p>${esc(x.detail)}</p><button data-action="locate-issue" data-index="${issues.indexOf(x)}">${esc(x.action)}</button>${x.relatedId ? `<button data-action="locate-related" data-issue="${issues.indexOf(x)}">定位另一个互动</button>` : ""}</article>`).join("")}</details>`).join("")}${publishing && !errors.length ? '<button class="primary" data-action="confirm-publish">检查素材并发布此版本</button>' : ""}</section>`,
  );
}
async function locateIssue(index) {
  const issue = checkState?.issues[index];
  if (!issue) return;
  closePanel();
  if (issue.view === "asset" && p().assets[issue.assetId]) {
    await previewAsset(issue.assetId);
    return;
  }
  if (issue.view === "variables") {
    page = "variables";
    render();
    return;
  }
  if (!issue.sceneId) {
    page = /起始|开始|开屏|加载/.test(issue.message || "") ? "story" : "theme";
    graph = page === "story";
    render();
    return;
  }
  selected = issue.sceneId;
  page = "story";
  graph = issue.view === "graph";
  inspectorOpen = true;
  selection =
    !graph && issue.itemId
      ? { kind: issue.itemKind, id: issue.itemId }
      : { kind: "scene" };
  time = clamp(issue.timeMs || 0, 0, editableDuration());
  render();
  if (graph) {
    board.selected = new Set([selected]);
    board.highlight();
    board.locate(selected);
    const outlet = [...$(".inspector").querySelectorAll("[data-path]")].find(
      (el) => el.dataset.path === issue.routePath,
    );
    outlet?.classList.add("check-field");
    outlet?.scrollIntoView({ block: "nearest" });
  } else {
    const clip = [
      ...$(".timeline-scroll").querySelectorAll("[data-clip]"),
    ].find((el) => el.dataset.clip === issue.itemId);
    clip?.scrollIntoView({ block: "nearest", inline: "center" });
    clip?.classList.add("check-focus");
    const field =
      issue.field &&
      [...$(".inspector").querySelectorAll("[data-field]")].find(
        (el) => el.dataset.field === issue.field,
      );
    field?.classList.add("check-field");
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: "nearest" });
  }
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
function placeTimelineAsset(asset, at, track, scene = s(), trackId) {
  if (!asset) throw Error("素材已不存在，请重新选择");
  if (
    ["video", "audio"].includes(asset.kind) &&
    (!Number.isSafeInteger(asset.durationMs) || asset.durationMs < 100)
  )
    throw Error("素材时长尚未读取，请先检查作品或重新导入素材");
  if (scene === s() && previewTracks().locked.has(trackId))
    throw Error("目标轨道已锁定");
  p().assets[asset.id] = asset;
  if (["video", "image"].includes(asset.kind) && track !== "overlay") {
    const c = insertVisual(scene, asset, at);
    return { kind: "clip", id: c.id };
  }
  const d = duration(scene),
    start = clamp(at, 0, Math.max(0, d - 100));
  if (["image", "video"].includes(asset.kind)) {
    const x = {
      id: uid("overlay"),
      inMs: 0,
      volume: 1,
      assetId: asset.id,
      startMs: start,
      endMs: start + (asset.kind === "video" ? asset.durationMs : 3000),
      x: 50,
      y: 50,
      width: 35,
    };
    assignTrack(scene, "overlay", x, trackId);
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
  assignTrack(scene, "audio", x, trackId);
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
            selection = placeTimelineAsset(
              a,
              context.at,
              context.track,
              scene,
              context.trackId,
            );
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
  if (action === "add-library-item") {
    if (button.dataset.kind === "ui") return handleAction("use-ui", button);
    if (page !== "story" || graph) {
      page = "story";
      graph = false;
      selection = { kind: "scene" };
      render();
    }
    mutate(
      "添加素材到播放指针",
      () =>
        (selection = placeTimelineAsset(
          p().assets[button.dataset.id],
          time,
          null,
          s(),
        )),
    );
    renderTimeline();
    renderInspector();
    revealTimelineItem(selection.id);
    return;
  }
  if (
    ["add-subtitle", "add-speed", "add-bars"].includes(action) &&
    (page !== "story" || graph)
  ) {
    page = "story";
    graph = false;
    selection = { kind: "scene" };
    render();
  }
  if (await workspaceAction(action, button)) return;
  switch (action) {
    case "track-up":
    case "track-down":
      mutate("调整轨道层次", () =>
        reorderTrack(s(), button.dataset.id, action === "track-up" ? -1 : 1),
      );
      break;
    case "track-preview": {
      const hidden = previewTracks().hidden,
        id = button.dataset.id;
      hidden.has(id) ? hidden.delete(id) : hidden.add(id);
      renderTimeline();
      paintStill();
      break;
    }
    case "track-lock": {
      const locked = previewTracks().locked,
        id = button.dataset.id;
      locked.has(id) ? locked.delete(id) : locked.add(id);
      renderTimeline();
      renderInspector();
      break;
    }
    case "timeline-conflict":
      await showIssues(false, { repair: false });
      break;
    case "locate-related": {
      const issue = checkState.issues[Number(button.dataset.issue)];
      const event = p()
        .scenes.find((x) => x.id === issue.sceneId)
        ?.events.find((x) => x.id === issue.relatedId);
      if (event) {
        checkState.issues.push({
          ...issue,
          itemId: event.id,
          timeMs: event.startMs,
        });
        await locateIssue(checkState.issues.length - 1);
      }
      break;
    }
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
      const scene = newScene("新的剧情节点");
      mutate("新建节点", (p) => {
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
      if (openingRole(s())) throw Error("请选择普通剧情节点作为起始节点");
      mutate("设置入口", (p) => {
        p.entryId = selected;
        const splash = openingCard(p, "splash");
        if (splash) splash.next = { kind: "scene", sceneId: selected };
      });
      break;
    case "delete-scene": {
      await workspaceAction("delete-scenes", button);
      break;

      if (p().scenes.length === 1) {
        notify("至少保留一个剧情节点");
        break;
      }
      const inbound = p().scenes.filter((x) =>
        targetsOf(x).some((t) => t.kind === "scene" && t.sceneId === selected),
      );
      panel(
        `<h2>删除「${esc(s().name)}」</h2><p>${inbound.length ? `以下节点引用了它：${inbound.map((x) => esc(x.name)).join("、")}。这些出口将设为“结束作品”。` : "没有其他节点连接到这里。"}删除后可撤销，原始素材仍保留。</p><button class="danger" data-action="confirm-delete-scene">删除并处理连接</button>`,
      );
      break;
    }
    case "confirm-delete-scene": {
      const id = selected;
      mutate("删除节点", (p) => {
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
      deleteTimelineSelected();
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
      if (openingRole(s()))
        throw Error("加载和开屏不使用剧情互动，请编辑开场元素");
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
        assignTrack(s(), "event", event);
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
      button.setAttribute("aria-pressed", String(board.showAllLines));
      board.lines();
      break;
    case "toggle-minimap":
      $(".minimap").hidden = !$(".minimap").hidden;
      button.setAttribute("aria-pressed", String(!$(".minimap").hidden));
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
    case "batch-remove-assets": {
      const plan = deletionPlan(p(), mediaLibrary.selected);
      pendingAssetDeletion = plan.unused;
      panel(
        `<h2>删除所选素材</h2><p>可删除 ${plan.unused.length} 项未使用素材。${plan.used.length ? `另有 ${plan.used.length} 项正在使用，本次保留。` : ""}</p>${plan.used
          .map(
            (id) =>
              `<p>${esc(p().assets[id].name)}：${mediaUses(p(), id)
                .map((x) => esc(x.name))
                .join("、")}</p>`,
          )
          .join(
            "",
          )}<p>只从当前作品素材库移除，电脑原文件保留。</p><button class="danger" data-action="confirm-batch-assets" ${plan.unused.length ? "" : "disabled"}>删除 ${plan.unused.length} 项未使用素材</button>`,
      );
      break;
    }
    case "confirm-batch-assets": {
      const plan = deletionPlan(p(), pendingAssetDeletion);
      mutate("批量移除素材", (project) => {
        for (const id of plan.unused) delete project.assets[id];
      });
      mediaLibrary.selected.clear();
      pendingAssetDeletion = [];
      closePanel();
      break;
    }
    case "purge-project":
    case "clear-project-trash": {
      if (storage.token && !projectCloudReady)
        throw Error("请等待云端作品读取完成后再清理回收站");
      pendingProjectPurge = projectRows
        .filter(
          (x) =>
            x.deleted &&
            (action === "clear-project-trash" || x.id === button.dataset.id),
        )
        .map((x) => x.id);
      if (!pendingProjectPurge.length) break;
      panel(
        `<h2>${action === "clear-project-trash" ? "清空回收站" : "彻底删除作品"}</h2><p>将永久删除 ${pendingProjectPurge.length} 个作品的本机和云端草稿及对应本机恢复副本，无法恢复。已发布的作品链接保留。</p><button class="danger" data-action="confirm-project-purge">确认永久删除</button>`,
      );
      break;
    }
    case "confirm-project-purge": {
      const rows = projectRows.filter(
        (x) => x.deleted && pendingProjectPurge.includes(x.id),
      );
      const cloudIds = rows.filter((x) => x.cloud).map((x) => x.id);
      if (cloudIds.length)
        await response(
          await fetch("/api/v2/purge", {
            method: "POST",
            headers: storage.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ ids: cloudIds }),
          }),
        );
      const list = archiveList();
      for (const row of rows) {
        delete list[row.id];
        for (const backup of storage.backups())
          if (backup.project?.id === row.id)
            localStorage.removeItem(backup.key);
        if (storage.readLocal()?.project?.id === row.id)
          localStorage.removeItem("storyforge-v2-draft");
      }
      saveArchive(list);
      pendingProjectPurge = [];
      await showProjects();
      break;
    }
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
    case "toggle-snap":
      snapEnabled = !snapEnabled;
      button.textContent = snapEnabled ? "吸附：开" : "吸附：关";
      button.setAttribute("aria-pressed", String(snapEnabled));
      break;
    case "fit-timeline":
      setTimelineZoom(1, 70);
      break;
    case "add-marker":
      panel(
        `<h2>添加时间标记</h2><label class="field">名称<input id="marker-name" value="时间标记"></label><button data-action="save-marker">添加</button>`,
      );
      break;
    case "save-marker": {
      const name = $("#marker-name").value.trim() || "时间标记";
      mutate("添加时间标记", () => {
        s().markers ||= [];
        s().markers.push({ id: uid("marker"), name, timeMs: time });
      });
      $("#panel").close();
      break;
    }
    case "goto-marker": {
      const marker = s().markers.find((x) => x.id === button.dataset.id);
      stopTimelinePlayback();
      time = marker.timeMs;
      paintStill();
      updatePlayhead();
      panel(
        `<h2>${esc(marker.name)}</h2><p>${(time / 1000).toFixed(2)} 秒</p><label class="field">名称<input id="marker-name" value="${esc(marker.name)}"></label><button data-action="rename-marker" data-id="${esc(marker.id)}">保存名称</button><button data-action="delete-marker" data-id="${esc(marker.id)}">删除标记</button>`,
      );
      break;
    }
    case "rename-marker": {
      const name = $("#marker-name").value.trim() || "时间标记";
      mutate(
        "修改时间标记",
        () => (s().markers.find((x) => x.id === button.dataset.id).name = name),
      );
      $("#panel").close();
      break;
    }
    case "delete-marker":
      mutate(
        "删除时间标记",
        () =>
          (s().markers = s().markers.filter((x) => x.id !== button.dataset.id)),
      );
      $("#panel").close();
      break;
    case "lift-selected":
      mutate("提到叠加轨道", () => {
        const c = currentClip();
        const x = liftVisual(s(), c.id, c.startMs);
        assignTrack(s(), "overlay", x);
        selection = { kind: "overlay", id: x.id };
      });
      break;
    case "align-start":
    case "align-end": {
      assertTimelineUnlocked();
      const obj = selectObject(),
        isMain = ["clip", "video", "image"].includes(selection.kind);
      mutate("对齐播放头", () => {
        if (isMain) {
          const c = currentClip();
          moveClip(
            s(),
            c.id,
            action === "align-start" ? time : time - clipLength(c),
          );
        } else {
          const length = obj.endMs - obj.startMs;
          obj.startMs = Math.max(
            0,
            action === "align-start" ? time : time - length,
          );
          obj.endMs = obj.startMs + length;
          if (
            ["event", "subtitle", "audio", "overlay"].includes(selection.kind)
          )
            assignTrack(s(), selection.kind, obj, obj.trackId);
        }
      });
      break;
    }
    case "preview-current":
      await preview();
      break;
    case "preview-here":
      toggleTimelinePlayback();
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
        await showIssues(true);
      }
      break;
    }
    case "load-cloud": {
      const resumePublish = publishAfterConnect;
      const draft = await storage.draft(p().id);
      await adopt(migrate(draft.project), draft.revision);
      closePanel();
      notify("已打开云端草稿，本机原稿保留在恢复列表");
      if (resumePublish) await showIssues(true);
      break;
    }
    case "publish":
      if (busy) throw Error("请等待素材导入完成");
      if (!storage.token) {
        publishAfterConnect = true;
        await handleAction("connect", button);
        break;
      }
      await showIssues(true);
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
    case "locate-issue":
      await locateIssue(Number(button.dataset.index));
      break;
    case "check-again":
      await showIssues(checkState?.publishing || false);
      break;
    case "undo-check-repairs": {
      if (
        !checkState?.transaction ||
        history.past.at(-1) !== checkState.transaction
      )
        throw Error("修复后已有其他编辑，请使用顶部撤销或打开修复前副本");
      history.undo();
      checkState.repairs = [];
      checkState.transaction = null;
      await showIssues(checkState.publishing, { repair: false });
      break;
    }
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
        `<h2>作品与恢复</h2><p>切换前会保留当前作品的本机备份。</p><button data-action="new-project">新建空白作品</button><h3>云端草稿</h3>${
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
function editableDuration() {
  const d = duration(s());
  return Number.isFinite(d) && d > 0
    ? d
    : Math.max(
        1000,
        ...items()
          .map((x) => x.end)
          .filter(Number.isFinite),
      );
}
function timelineSpan() {
  const d = editableDuration();
  return Math.max(1000, d) + Math.max(2000, d * 0.15);
}
function timelineItemStyle(x, d) {
  const start = Number.isFinite(x.start) ? Math.max(0, x.start) : 0;
  const valid =
    Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start;
  return `left:${(start / d) * 100}%;width:${valid ? Math.max(0.6, ((x.end - x.start) / d) * 100) : 8}%`;
}
function snappedTime(value, exclude, width, alt = false) {
  value = Math.max(0, Math.round(value));
  if (alt || !snapEnabled) return value;
  const threshold = (8 / Math.max(1, width)) * timelineSpan();
  const points = [
    0,
    time,
    ...(s().markers || []).map((x) => x.timeMs),
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
  if (previewTracks().locked.has(track?.dataset.trackId)) {
    if (phase !== "move") notify("目标轨道已锁定");
    return;
  }
  const rect = lane.getBoundingClientRect();
  let at = snappedTime(
    ((e.clientX - rect.left) / rect.width) * timelineSpan(),
    null,
    rect.width,
    e.altKey,
  );
  if (["video", "image"].includes(kind) && track?.dataset.track !== "overlay")
    at = insertionPoint(s(), at);
  if (phase === "move") {
    const guide = document.createElement("div");
    guide.className = "timeline-drop";
    guide.style.left = (at / timelineSpan()) * 100 + "%";
    const assetLength =
      kind === "ui"
        ? 5000
        : kind === "image"
          ? 3000
          : p().assets[id]?.durationMs || 3000;
    guide.style.width = Math.max(1, (assetLength / timelineSpan()) * 100) + "%";
    guide.textContent =
      (at / 1000).toFixed(1) +
      " 秒 · " +
      (track?.dataset?.track === "overlay"
        ? "叠加（重叠时新建轨道）"
        : track?.dataset.track === "video"
          ? "插入主画面"
          : "放入轨道（重叠时新建）");
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
        assignTrack(s(), "event", event, track?.dataset.trackId);
        s().events.push(event);
        selection = { kind: "event", id: event.id };
      } else
        selection = placeTimelineAsset(
          p().assets[id],
          at,
          track?.dataset.track,
          s(),
          track?.dataset.trackId,
        );
    });
    renderInspector();
  } catch (error) {
    notify(error.message);
  }
}
let cancelTimelineGesture = null;
function selectedTimelineIds() {
  return new Set(
    selection.id && !timelineSelection.has(selection.id)
      ? [selection.id]
      : timelineSelection.size
        ? timelineSelection
        : [],
  );
}
function assertTimelineUnlocked(ids = selectedTimelineIds()) {
  for (const clip of $(".timeline-scroll").querySelectorAll("[data-clip]"))
    if (
      ids.has(clip.dataset.clip) &&
      previewTracks().locked.has(clip.closest(".track").dataset.trackId)
    )
      throw Error("选中的轨道已锁定，请先解锁");
}
function beginTimelinePan(e) {
  e.preventDefault();
  const scroll = $(".timeline-scroll"),
    start = {
      x: e.clientX,
      y: e.clientY,
      left: scroll.scrollLeft,
      top: scroll.scrollTop,
    };
  const controller = new AbortController();
  const finish = () => {
    controller.abort();
    cancelTimelineGesture = null;
  };
  cancelTimelineGesture = finish;
  window.addEventListener(
    "pointermove",
    (ev) => {
      scroll.scrollLeft = start.left - ev.clientX + start.x;
      scroll.scrollTop = start.top - ev.clientY + start.y;
    },
    { signal: controller.signal },
  );
  window.addEventListener("pointerup", finish, {
    once: true,
    signal: controller.signal,
  });
  window.addEventListener("pointercancel", finish, {
    once: true,
    signal: controller.signal,
  });
}
function beginTimelineBox(e) {
  e.preventDefault();
  const scroll = $(".timeline-scroll"),
    inner = scroll.querySelector(".timeline-inner");
  const bounds = scroll.getBoundingClientRect();
  const start = {
    x: e.clientX - bounds.left + scroll.scrollLeft,
    y: e.clientY - bounds.top + scroll.scrollTop,
  };
  const box = document.createElement("div");
  box.className = "timeline-selection-box";
  inner.append(box);
  const controller = new AbortController();
  const original = new Set(e.shiftKey ? selectedTimelineIds() : []);
  let moved = false;
  const cleanup = () => {
    controller.abort();
    box.remove();
    cancelTimelineGesture = null;
  };
  cancelTimelineGesture = () => {
    cleanup();
    timelineSelection.clear();
    original.forEach((id) => timelineSelection.add(id));
    renderTimeline();
  };
  window.addEventListener(
    "pointermove",
    (ev) => {
      const x = ev.clientX - bounds.left + scroll.scrollLeft,
        y = ev.clientY - bounds.top + scroll.scrollTop;
      if (Math.hypot(x - start.x, y - start.y) < 4 && !moved) return;
      moved = true;
      const left = Math.min(start.x, x),
        top = Math.min(start.y, y),
        right = Math.max(start.x, x),
        bottom = Math.max(start.y, y);
      Object.assign(box.style, {
        left: left + "px",
        top: top + "px",
        width: right - left + "px",
        height: bottom - top + "px",
      });
      timelineSelection.clear();
      original.forEach((id) => timelineSelection.add(id));
      const ir = inner.getBoundingClientRect();
      for (const clip of inner.querySelectorAll("[data-clip]")) {
        const r = clip.getBoundingClientRect();
        if (
          !previewTracks().locked.has(clip.closest(".track").dataset.trackId) &&
          clip.dataset.kind !== "opening" &&
          r.right - ir.left > left &&
          r.left - ir.left < right &&
          r.bottom - ir.top > top &&
          r.top - ir.top < bottom
        )
          timelineSelection.add(clip.dataset.clip);
        clip.classList.toggle(
          "selected",
          timelineSelection.has(clip.dataset.clip),
        );
      }
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "pointerup",
    (ev) => {
      cleanup();
      if (!moved) {
        timelineSelection.clear();
        selection = { kind: "scene" };
        const ruler = scroll.querySelector(".ruler").getBoundingClientRect();
        time = clamp(
          ((ev.clientX - ruler.left) / ruler.width) * timelineSpan(),
          0,
          editableDuration(),
        );
        updatePlayhead();
        queueStill();
      } else {
        const clip = [...scroll.querySelectorAll("[data-clip]")].find((el) =>
          timelineSelection.has(el.dataset.clip),
        );
        selection = clip
          ? { kind: clip.dataset.kind, id: clip.dataset.clip }
          : { kind: "scene" };
      }
      renderTimeline();
      renderInspector();
    },
    { once: true, signal: controller.signal },
  );
  window.addEventListener("pointercancel", () => cancelTimelineGesture?.(), {
    once: true,
    signal: controller.signal,
  });
}
function beginTimelineGroupDrag(e) {
  const ids = selectedTimelineIds();
  try {
    assertTimelineUnlocked(ids);
  } catch (error) {
    notify(error.message);
    return;
  }
  const entries = items().filter((x) => ids.has(x.id));
  if (
    entries.some((x) => !Number.isFinite(x.start) || !Number.isFinite(x.end))
  ) {
    notify("请先修复选中片段的时间");
    return;
  }
  const scroll = $(".timeline-scroll"),
    lane = scroll.querySelector(".lane").getBoundingClientRect(),
    initialScroll = scroll.scrollLeft;
  const controller = new AbortController();
  let delta = 0,
    moved = false;
  const cleanup = () => {
    controller.abort();
    cancelTimelineGesture = null;
  };
  cancelTimelineGesture = () => {
    cleanup();
    renderTimeline();
  };
  window.addEventListener(
    "pointermove",
    (ev) => {
      if (Math.abs(ev.clientX - e.clientX) < 4 && !moved) return;
      moved = true;
      const raw =
        ((ev.clientX - e.clientX + scroll.scrollLeft - initialScroll) /
          lane.width) *
        timelineSpan();
      delta = Math.max(
        -Math.min(...entries.map((x) => x.start)),
        Math.round(raw),
      );
      for (const x of entries) {
        const clip = [...scroll.querySelectorAll("[data-clip]")].find(
          (el) => el.dataset.clip === x.id,
        );
        if (clip)
          clip.style.left = ((x.start + delta) / timelineSpan()) * 100 + "%";
      }
      const bounds = scroll.getBoundingClientRect();
      if (ev.clientX > bounds.right - 25) scroll.scrollLeft += 12;
      if (ev.clientX < bounds.left + 85) scroll.scrollLeft -= 12;
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "pointerup",
    () => {
      cleanup();
      if (moved)
        try {
          mutate("移动选中片段", () => moveSelection(s(), ids, delta));
        } catch (error) {
          notify(error.message);
        }
      renderTimeline();
      renderInspector();
      queueStill();
    },
    { once: true, signal: controller.signal },
  );
  window.addEventListener("pointercancel", () => cancelTimelineGesture?.(), {
    once: true,
    signal: controller.signal,
  });
}
function timelinePointer(e) {
  if (e.button === 1) return beginTimelinePan(e);
  if (e.button !== 0 || e.target.closest("[data-action]")) return;
  let clip = e.target.closest("[data-clip]");
  if (
    clip &&
    previewTracks().locked.has(clip.closest(".track").dataset.trackId)
  ) {
    selection = { kind: clip.dataset.kind, id: clip.dataset.clip };
    renderInspector();
    return;
  }
  stopTimelinePlayback();
  if (!clip) {
    if (e.target.closest(".ruler,.playhead")) beginTimelineScrub(e);
    else if (!e.target.closest(".track-label")) {
      const bounds = $(".timeline-scroll").getBoundingClientRect();
      if (e.clientX < bounds.right - 12 && e.clientY < bounds.bottom - 12)
        beginTimelineBox(e);
    }
    return;
  }
  e.preventDefault();
  const edge = clip.dataset.kind === "event" ? null : e.target.dataset.edge;
  if (e.shiftKey) {
    const id = clip.dataset.clip;
    if (!timelineSelection.size && selection.id && selection.id !== id)
      timelineSelection.add(selection.id);
    timelineSelection.has(id)
      ? timelineSelection.delete(id)
      : timelineSelection.add(id);
    const active = timelineSelection.has(id)
      ? id
      : [...timelineSelection].at(-1);
    const item = items().find((x) => x.id === active);
    selection = item ? { kind: item.kind, id: active } : { kind: "scene" };
    renderTimeline();
    renderInspector();
    markPreviewSelection();
    return;
  }
  if (!timelineSelection.has(clip.dataset.clip)) timelineSelection.clear();
  timelineSelection.add(clip.dataset.clip);
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
  if (timelineSelection.size > 1 && !edge) return beginTimelineGroupDrag(e);
  const obj = selectObject(),
    before = clone(obj);
  if (!obj) return;
  const entry = items().find((x) => x.id === obj.id);
  if (
    !entry ||
    !Number.isFinite(entry.start) ||
    !Number.isFinite(entry.end) ||
    entry.end <= entry.start
  ) {
    notify("这个片段的时间需要先修复，请在右侧填写有效时间或打开作品检查");
    return;
  }
  const rect = clip.parentElement.getBoundingClientRect(),
    span = timelineSpan(),
    source = items().find((x) => x.id === obj.id),
    startX = e.clientX,
    startY = e.clientY,
    startScroll = $(".timeline-scroll").scrollLeft;
  let delta = 0,
    moved = false,
    dropRow = null;
  const controller = new AbortController(),
    guide = document.createElement("div");
  guide.className = "timeline-snap";
  clip.parentElement.append(guide);
  const anchor = edge === "right" ? source.end : source.start;
  window.addEventListener(
    "pointermove",
    (ev) => {
      if (!edge) {
        dropRow = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest(".track");
        $(".timeline-scroll")
          .querySelectorAll(".drop-lane")
          .forEach((x) => x.classList.remove("drop-lane"));
        dropRow?.querySelector(".lane")?.classList.add("drop-lane");
      }
      const raw =
        ((ev.clientX -
          startX +
          $(".timeline-scroll").scrollLeft -
          startScroll) /
          rect.width) *
        span;
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
      moved ||=
        Math.abs(ev.clientX - startX) > 3 ||
        (!edge && Math.abs(ev.clientY - startY) > 3);
      let lo =
        edge === "left"
          ? Math.max(0, Math.min(source.end - 100, source.start + delta))
          : edge === "right"
            ? source.start
            : Math.max(0, source.start + delta);
      let hi =
        edge === "right"
          ? Math.max(source.start + 100, source.end + delta)
          : edge === "left"
            ? source.end
            : lo + source.end - source.start;
      if (edge && selection.kind === "clip") {
        const draft = clone(s());
        trimVisual(
          draft,
          obj.id,
          edge,
          delta,
          obj.kind === "video" ? p().assets[obj.assetId].durationMs : 7200000,
        );
        const trimmed = draft.clips.find((x) => x.id === obj.id);
        lo = trimmed.startMs;
        hi = lo + clipLength(trimmed);
      } else if (selection.kind !== "clip") {
        const d = editableDuration(),
          min = selection.kind === "event" ? 0 : 100;
        const media =
          selection.kind === "audio" ||
          (selection.kind === "overlay" &&
            p().assets[obj.assetId]?.kind === "video");
        if (edge === "left")
          lo = Math.max(
            media ? before.startMs - (before.inMs || 0) : 0,
            Math.min(before.endMs - min, lo),
          );
        else if (edge === "right")
          hi = clamp(
            hi,
            before.startMs + min,
            media
              ? Math.min(
                  d,
                  before.startMs +
                    p().assets[obj.assetId].durationMs -
                    (before.inMs || 0),
                )
              : d,
          );
        else {
          lo = clamp(lo, 0, d - (source.end - source.start));
          hi = lo + source.end - source.start;
        }
      }
      delta = edge === "right" ? hi - source.end : lo - source.start;
      target = anchor + delta;
      clip.style.left = (lo / span) * 100 + "%";
      clip.style.width = Math.max(0.6, ((hi - lo) / span) * 100) + "%";
      guide.style.left = (target / span) * 100 + "%";
      guide.dataset.label = `${(lo / 1000).toFixed(2)}—${(hi / 1000).toFixed(2)} 秒 · 时长 ${((hi - lo) / 1000).toFixed(2)} 秒`;
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
    cancelTimelineGesture = null;
    guide.remove();
    if (ev.type === "pointercancel" || !moved) {
      renderTimeline();
      return;
    }
    suppressClick = true;
    try {
      mutate("调整时间轴", () => {
        if (
          !edge &&
          dropRow &&
          previewTracks().locked.has(dropRow.dataset.trackId)
        )
          throw Error("目标轨道已锁定");
        if (!edge && dropRow) {
          const allowed =
            selection.kind === "clip"
              ? ["video", "overlay"]
              : ["overlay", "subtitle"].includes(selection.kind)
                ? ["overlay"]
                : [selection.kind];
          if (!allowed.includes(dropRow.dataset.track))
            throw Error("请放到相应类型的轨道；叠加画面放在主画面上方");
        }
        if (selection.kind === "clip") {
          if (!edge && dropRow?.dataset.track === "overlay") {
            const x = liftVisual(s(), obj.id, before.startMs + delta);
            assignTrack(s(), "overlay", x, dropRow.dataset.trackId);
            selection = { kind: "overlay", id: x.id };
          } else if (edge)
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
            if (
              selection.kind === "audio" ||
              (selection.kind === "overlay" &&
                p().assets[obj.assetId]?.kind === "video")
            ) {
              const change = Math.max(
                -before.inMs,
                obj.startMs - before.startMs,
              );
              obj.startMs = before.startMs + change;
              obj.inMs = before.inMs + change;
            }
          } else if (edge === "right") {
            const limit =
              selection.kind === "audio" ||
              (selection.kind === "overlay" &&
                p().assets[obj.assetId]?.kind === "video")
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
          if (
            ["overlay", "subtitle", "audio", "event"].includes(selection.kind)
          ) {
            assignTrack(
              s(),
              selection.kind,
              obj,
              !edge && dropRow ? dropRow.dataset.trackId : obj.trackId,
            );
          }
        }
      });
    } catch (error) {
      notify(error.message);
      renderTimeline();
    }
  };
  cancelTimelineGesture = () => finish({ type: "pointercancel" });
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
  if (!clip || !e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key))
    return;
  if (previewTracks().locked.has(clip.closest(".track").dataset.trackId))
    return;
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
      if (["subtitle", "overlay", "audio", "event"].includes(selection.kind))
        assignTrack(s(), selection.kind, obj, obj.trackId);
    }
  });
}
function canvasPointer(e) {
  const openingEl = e.target.closest("[data-opening-element]");
  if (openingEl && openingRole(s()) && e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    const key = openingEl.dataset.openingElement,
      bounds = openingEl.closest(".opening-frame").getBoundingClientRect(),
      before = clone(s().opening.layout?.[key] || openingDefaults(key)),
      x = e.clientX,
      y = e.clientY;
    selection = { kind: "opening", id: key };
    renderInspector();
    const controller = new AbortController();
    let dx = 0,
      dy = 0;
    window.addEventListener(
      "pointermove",
      (ev) => {
        dx = ((ev.clientX - x) / bounds.width) * 100;
        dy = ((ev.clientY - y) / bounds.height) * 100;
        Object.assign(openingEl.style, {
          position: "absolute",
          left: clamp(before.x + dx, 0, 100) + "%",
          top: clamp(before.y + dy, 0, 100) + "%",
          bottom: "auto",
          right: "auto",
          transform: "translate(-50%,-50%)",
          translate: "none",
          margin: "0",
        });
      },
      { signal: controller.signal },
    );
    const finish = (ev) => {
      controller.abort();
      if (ev.type !== "pointercancel" && Math.abs(dx) + Math.abs(dy) > 0.1) {
        suppressClick = true;
        mutate("移动开场元素", () => {
          s().opening.layout ||= {};
          s().opening.layout[key] = {
            ...before,
            x: +clamp(before.x + dx, 0, 100).toFixed(1),
            y: +clamp(before.y + dy, 0, 100).toFixed(1),
          };
        });
      }
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
    return;
  }
  const el = e.target.closest("[data-edit-event],[data-edit-item]");
  if (!el || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selection = {
    kind: el.dataset.editKind || "event",
    id: el.dataset.editItem || el.dataset.editEvent,
  };
  timelineSelection.clear();
  timelineSelection.add(selection.id);
  renderTimeline();
  renderInspector();
  revealTimelineItem(selection.id);
  markPreviewSelection();
  try {
    assertTimelineUnlocked();
  } catch {
    return;
  }
  const event = selectObject(),
    option = event.options?.find((x) => x.id === el.dataset.optionId),
    obj = option || event,
    before = { x: obj.x, y: obj.y },
    rect = $(".canvas .play-stage").getBoundingClientRect(),
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
    if (button?.dataset.action === "close-inspector") {
      inspectorOpen = false;
      document.body.dataset.inspector = "false";
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
      notify("点击目标节点完成连接");
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
  if (page === "story" && !graph && scope === "selection") {
    try {
      assertTimelineUnlocked();
    } catch (error) {
      notify(error.message);
      renderInspector();
      return;
    }
  }
  if (scope === "scene") obj = s();
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
    if (path === "role" && value !== obj.role) {
      const other = openingCard(p(), value);
      if (
        openingRole({ role: value }) &&
        ((other && other.id !== selected) ||
          s().events.length ||
          selected === p().entryId)
      ) {
        pendingRole = { id: selected, role: value };
        panel(
          `<h2>改为${value === "loading" ? "加载" : "开屏"}节点？</h2><p>${other && other.id !== selected ? `原${value === "loading" ? "加载" : "开屏"}节点“${esc(other.name)}”将改为剧情，内容保留。` : ""}${s().events.length ? "已有互动和分支暂时停用，改回剧情后可恢复。" : ""}${selected === p().entryId ? "起始节点将改为另一张剧情节点。" : ""}</p><button data-action="confirm-role">确认修改</button><button data-action="close-panel">取消</button>`,
        );
      } else mutate("修改节点用途", (p) => changeRole(p, selected, value));
      return;
    }
    mutate("修改属性", () => {
      if (scope === "scene" && path.startsWith("opening.layout.")) {
        const key = path.split(".")[2];
        s().opening.layout ||= {};
        s().opening.layout[key] ||= openingDefaults(key);
      }
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
      if (
        ["startMs", "endMs"].includes(path) &&
        ["subtitle", "overlay", "audio", "event"].includes(selection.kind)
      )
        assignTrack(s(), selection.kind, obj, obj.trackId);
      if (
        selection.kind === "scene" &&
        path === "next.sceneId" &&
        openingRole(obj)
      )
        setCardNext(p(), selected, obj.next);
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
$("#panel").addEventListener("close", () => {
  checkRequest++;
  clearAssetPreview();
  if (pendingRole) {
    pendingRole = null;
    render();
  }
});
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
  timelineSelection.clear();
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
      $(".selection-tools").hidden = n < 2;
      const tools = $(".selection-tools");
      if (n >= 2) {
        board.surface.append(tools);
        const positions = [...board.selected]
          .map((id) => board.positions[id])
          .filter(Boolean);
        tools.style.left = Math.min(...positions.map((p) => p.x)) + "px";
        tools.style.top =
          Math.max(8, Math.min(...positions.map((p) => p.y)) - 44) + "px";
      }
      $('[data-action="arrange-selection"]').hidden = n < 2;
    },
    preview: () => preview(),
    select: (id) => {
      inspectorOpen = !specialNode(id);
      document.body.dataset.inspector = String(inspectorOpen);
      if (!specialNode(id)) selected = id;
      selection = { kind: "scene" };
      renderInspector();
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
          '<h2>起始节点</h2><select id="entry-target">' +
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
        mutate("素材创建节点", (p) => addAssetToScene(p, scene, p.assets[aid]));
        return;
      }
      if (transfer.files.length) {
        const scene = createScene("新节点");
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
    guide.textContent =
      (at / 1000).toFixed(1) +
      " 秒 · " +
      (track?.dataset.track === "overlay"
        ? "叠加（重叠时新建轨道）"
        : "插入轨道");
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
    if (
      previewTracks().locked.has(e.target.closest(".track")?.dataset.trackId)
    ) {
      clearDrop();
      notify("目标轨道已锁定");
      return;
    }
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
    if (ui && openingRole(s())) {
      notify("加载和开屏不使用剧情互动，请编辑开场元素");
      return;
    }
    try {
      if (aid || ui) {
        mutate("拖入时间轴", () => {
          if (ui) {
            const event = componentEvent(
              ui,
              clamp(at, 0, Math.max(0, duration(s()) - 100)),
            );
            event.endMs = Math.min(duration(s()), event.startMs + 5000);
            assignTrack(
              s(),
              "event",
              event,
              e.target.closest(".track")?.dataset.trackId,
            );
            s().events.push(event);
            selection = { kind: "event", id: event.id };
          } else
            selection = placeTimelineAsset(
              p().assets[aid],
              at,
              track,
              s(),
              e.target.closest(".track")?.dataset.trackId,
            );
        });
        renderInspector();
      } else if (e.dataTransfer.files.length)
        await importFiles([...e.dataTransfer.files], {
          mode: "timeline",
          sceneId: selected,
          at,
          track,
          trackId: e.target.closest(".track")?.dataset.trackId,
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
  if (page !== "story" || graph) sidebarLibrary.dispose();
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
    `<div class="sidebar-title">节点目录 <small>${p().scenes.length}</small></div><input id="scene-search" placeholder="搜索节点" value="${esc(sceneSearch)}">${p()
      .scenes.filter((x) =>
        x.name.toLowerCase().includes(sceneSearch.toLowerCase()),
      )
      .map(
        (x, i) =>
          `<div class="scene-item ${x.id === selected ? "selected" : ""}" data-scene="${x.id}" draggable="true" role="button" tabindex="0"><span class="number">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(x.name)}</strong><small>${sec(duration(x)).toFixed(1)}s${p().entryId === x.id ? " · 入口" : ""}${x.role === "ending" ? " · 结局" : ""}</small></div></div>`,
      )
      .join("")}`;
}
function createScene(name = "新节点", role = "story", source = "sequence") {
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
      x: Math.round((80 - board.camera.x) / board.scale),
      y: Math.round((100 - board.camera.y) / board.scale),
    };
  while (
    Object.values(positions).some(
      (p) =>
        Math.abs(p.x - position.x) < 260 && Math.abs(p.y - position.y) < 200,
    )
  )
    position.y += 220;
  mutate("新建并连接节点", (p) => {
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
    `<h2>${esc(port?.label || "剧情连接")}</h2><label class="field">下一节点<select id="connection-target"><option value="unlinked">待连接</option>${openingRole(scene) ? "" : '<option value="end">结束作品</option><option value="continue">继续播放</option><option value="home">返回开屏</option>'}${p()
      .scenes.filter(
        (x) =>
          x.role !== "loading" && (scene.role !== "splash" || !openingRole(x)),
      )
      .map(
        (x) =>
          `<option value="${x.id}" ${t.sceneId === x.id ? "selected" : ""}>${esc(x.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><button class="primary" data-action="save-connection">确定</button> <button data-action="create-connected">新建并连接节点</button> <button data-action="unlink">移除连接</button>`,
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
    `<h2>删除片段</h2><label class="field">后续内容<select id="delete-ripple"><option value="no">保留时间空隙</option><option value="yes">删除并前移后续内容</option></select></label>${linked(s(), c.id).length ? '<label class="field check"><input id="delete-linked" type="checkbox">同时删除关联字幕、互动和声音</label>' : ""}<button class="danger" data-action="confirm-delete-clip">删除片段</button>`,
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
  const request = ++projectRequest;
  projectCloudReady = !storage.token;
  if (page !== "projects")
    workspaceReturn = {
      page,
      graph,
      selected,
      selection: clone(selection),
      time,
    };
  closePanel();
  page = "projects";
  render();
  const local = archiveList(),
    backups = storage.backups();
  void renderProjects(
    local,
    [],
    backups,
    storage.token ? "正在读取云端作品…" : "",
  );
  if (!idleWorkspace) storage.saveLocal(p());
  if (!storage.token) return;
  try {
    const cloud = await response(
      await fetch("/api/v2/projects", {
        headers: storage.headers(),
        signal: AbortSignal.timeout(15000),
      }),
    );
    if (request !== projectRequest || page !== "projects") return;
    projectCloudReady = true;
    await renderProjects(archiveList(), cloud, storage.backups());
  } catch {
    if (request === projectRequest && page === "projects")
      await renderProjects(
        archiveList(),
        [],
        storage.backups(),
        "云端作品暂时无法读取，本机作品仍可打开。",
      );
  }
}
async function renderProjects(local, cloud, backups, cloudError = "") {
  projectRows = projectCatalog(local, cloud);
  const card = (row) => {
    const current = !idleWorkspace && row.id === p().id;
    return (
      '<article class="project-card" data-project-card="' +
      esc(row.id) +
      '"><div class="project-cover">▣</div><div class="project-card-heading"><h3>' +
      esc(row.name) +
      '</h3><details class="more-menu project-actions"><summary aria-label="' +
      esc(row.name) +
      '操作">更多操作</summary><div><button data-action="rename-project" data-id="' +
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
  $(".projects-page").innerHTML =
    (idleWorkspace
      ? ""
      : '<button data-action="return-workspace">← 返回编辑</button>') +
    '<h2>我的作品</h2><div class="mini-actions"><button class="primary" data-action="new-project">＋ 新建作品</button><button data-action="import">导入作品</button></div>' +
    (cloudError ? '<p role="status">' + cloudError + "</p>" : "") +
    '<div class="project-grid">' +
    projectRows
      .filter((x) => !x.deleted)
      .map(card)
      .join("") +
    '</div><details class="project-recovery"><summary>回收站</summary><button class="danger" data-action="clear-project-trash" ' +
    (projectRows.some((x) => x.deleted) ? "" : "disabled") +
    ">清空回收站</button>" +
    projectRows
      .filter((x) => x.deleted)
      .map(
        (x) =>
          '<button class="full" data-action="restore-managed-project" data-id="' +
          esc(x.id) +
          '">恢复 ' +
          esc(x.name) +
          '</button><button class="danger" data-action="purge-project" data-id="' +
          esc(x.id) +
          '">彻底删除</button>',
      )
      .join("") +
    '</details><details class="project-recovery"><summary>本机恢复副本</summary>' +
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
    "</details>";
  await Promise.all(
    projectRows
      .filter((x) => !x.deleted && x.local)
      .map(async (row) => {
        const project = row.local.project;
        const first = visualClips(
          project.scenes.find((x) => x.id === project.entryId) ||
            project.scenes[0],
        )[0];
        const asset =
          project.assets[
            project.loading.image || project.loading.video || first?.assetId
          ];
        const host = [...document.querySelectorAll("[data-project-card]")]
          .find((x) => x.dataset.projectCard === row.id)
          ?.querySelector(".project-cover");
        if (!host || !asset || !["image", "video"].includes(asset.kind)) return;
        try {
          const url = await assets.url(asset);
          if (!host.isConnected) return;
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
      }),
  );
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
    if (!list.length) throw Error("请选择节点");
    return list;
  };
  switch (action) {
    case "projects":
      await showProjects();
      break;
    case "return-workspace":
      if (idleWorkspace) break;
      projectRequest++;
      if (workspaceReturn)
        ({ page, graph, selected, selection, time } = workspaceReturn);
      else {
        page = "story";
        graph = true;
      }
      render();
      break;
    case "close-panel":
      closePanel();
      break;
    case "confirm-role":
      mutate("修改节点用途", (p) =>
        changeRole(p, pendingRole.id, pendingRole.role),
      );
      closePanel();
      break;
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
      if (idleWorkspace || id !== p().id)
        await adopt(migrate(value.project), value.revision || "none");
      else {
        projectRequest++;
        if (workspaceReturn)
          ({ page, graph, selected, selection, time } = workspaceReturn);
        else {
          page = "story";
          graph = true;
        }
        render();
      }
      closePanel();
      break;
    }
    case "delete-project": {
      const id = button.dataset.id,
        row = projectRows.find((x) => x.id === id);
      if (id === p().id && !idleWorkspace) await saveCurrent();
      if (storage.token)
        await response(
          await fetch("/api/v2/archive", {
            method: "POST",
            headers: storage.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ id, deleted: true }),
          }),
        ).catch((error) => {
          if (error.status !== 404) throw error;
        });
      const list = archiveList();
      if (list[id]) {
        list[id].deleted = true;
        saveArchive(list);
      }
      if (id === p().id && !idleWorkspace) await leaveDeletedProject();
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
      if (id === p().id && !idleWorkspace) await leaveDeletedProject();
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
        '<h2>新建节点</h2><label class="field">名称<input id="new-scene-name" placeholder="节点名称" value="新节点"></label><label class="field">类型<select id="new-scene-type"><option value="story">空白节点</option><option value="video">视频节点</option><option value="image">图片节点</option><option value="ending">结局</option><option value="death">失败节点</option></select></label><button class="primary" data-action="create-card">创建</button>',
      );
      break;
    case "create-card": {
      const type = $("#new-scene-type").value,
        name = $("#new-scene-name").value.trim() || "新节点";
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
        "重命名节点",
        () => (s().name = $("#rename-scene").value.trim() || s().name),
      );
      closePanel();
      break;
    case "make-ending":
      mutate("设为结局", () => {
        changeRole(p(), selected, "ending");
        s().next = endTarget();
      });
      closePanel();
      break;
    case "copy-scenes": {
      let copied;
      mutate("复制节点", (p) => (copied = copyScenes(p, ids())));
      selected = copied[0].id;
      board.selected = new Set(copied.map((s) => s.id));
      closePanel();
      render();
      break;
    }
    case "delete-scenes": {
      pendingDelete = ids();
      const keep = p().scenes.filter((s) => !pendingDelete.includes(s.id));
      if (!keep.some((s) => !openingRole(s)))
        throw Error("至少保留一张剧情节点");
      const inbound = p().scenes.filter(
        (s) =>
          !pendingDelete.includes(s.id) &&
          targetsOf(s).some(
            (t) => t.kind === "scene" && pendingDelete.includes(t.sceneId),
          ),
      );
      panel(
        `<h2>删除 ${pendingDelete.length} 张节点？</h2><p>${pendingDelete.some((id) => p().scenes.find((s) => s.id === id)?.role === "loading") ? "删除加载节点后，使用默认资源准备提示。" : ""}${pendingDelete.some((id) => p().scenes.find((s) => s.id === id)?.role === "splash") ? "删除开屏后，启动流程直接进入起始节点。" : ""}${inbound.length ? "关联节点：" + inbound.map((x) => esc(x.name)).join("、") + "。剧情出口将标记为待连接，开场连接会调整到起始节点。" : "删除后可以撤销，素材仍保留。"}</p>${
          pendingDelete.includes(p().entryId)
            ? `<label class="field">新的故事入口<select id="new-entry">${keep
                .filter((s) => !openingRole(s))
                .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
                .join("")}</select></label>`
            : ""
        }<button class="danger" data-action="confirm-delete-scenes">删除节点</button>`,
      );
      break;
    }
    case "confirm-delete-scenes": {
      const entry = $("#new-entry")?.value || p().entryId;
      mutate("删除节点", (p) => deleteScenes(p, pendingDelete, entry));
      selected = p().entryId;
      board.selected = new Set([selected]);
      closePanel();
      render();
      break;
    }
    case "save-connection": {
      const value = $("#connection-target").value;
      mutate("修改连接", (p) => {
        const target = ["unlinked", "end", "continue", "home"].includes(value)
          ? { kind: value }
          : { kind: "scene", sceneId: value };
        if (connectionEdit.path === "next")
          setCardNext(p, connectionEdit.id, target);
        else
          set(
            p.scenes.find((x) => x.id === connectionEdit.id),
            connectionEdit.path,
            target,
          );
      });
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
        scene = createScene("新节点");
      mutate("连接新节点", (p) =>
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
      board.locate(openingCard(p(), "loading")?.id || p().entryId);
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
      mutate("设置起始节点", (p) => (p.entryId = $("#entry-target").value));
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
        action === "arrange-selection"
          ? [...board.selected][0]
          : openingCard(p(), "loading")?.id ||
              openingCard(p(), "splash")?.id ||
              p().entryId,
      );
      break;
    }
    case "split-clip": {
      assertTimelineUnlocked();
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
      assertTimelineUnlocked();
      mutate("调整片段顺序", () =>
        reorderClip(s(), currentClip().id, action === "clip-before" ? -1 : 1),
      );
      break;
    case "copy-item": {
      assertTimelineUnlocked();
      timelineClipboard = copySelection(s(), selectedTimelineIds());
      notify("已复制，在目标时间粘贴即可");
      break;
    }
    case "paste-item":
      pasteTimelineCopied();
      break;
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
      const list = Object.values(p().assets).filter((x) =>
        ["image", "video"].includes(x.kind),
      );
      panel(
        `<h2>叠加画面</h2>${list.map((a) => `<button class="full" data-action="use-overlay" data-id="${esc(a.id)}">${esc(a.name)}</button>`).join("") || "<p>请先导入图片或视频素材。</p>"}<button data-action="upload-library">导入素材</button>`,
      );
      break;
    }
    case "use-overlay": {
      mutate("添加叠加画面", () => {
        selection = placeTimelineAsset(
          p().assets[button.dataset.id],
          time,
          "overlay",
        );
      });
      closePanel();
      render();
      break;
    }
    case "edit-connection":
      showConnection(selected, button.dataset.path);
      break;
    case "check-project":
      await showIssues(false);
      break;
    case "help":
      panel(
        "<h2>快捷操作</h2><p>双击节点进入编辑；拖动空白处移动画布；Shift 拖动框选节点；按住空格或鼠标中键也可拖动画布。</p><p>Ctrl / ⌘ + 滚轮缩放画布。Ctrl / ⌘ + Z 撤销，Shift + Ctrl / ⌘ + Z 重做，Ctrl / ⌘ + S 保存。</p><p>时间轴：空格播放 / 暂停；拖动播放指针查看画面；拖动空白处框选，Shift 点击多选；Ctrl / ⌘ + C 复制、V 粘贴、B 分割；Delete 删除并保留空隙。方向键逐帧，Shift + 方向键移动 1 秒。互动片段只能整体移动，时间范围在右侧设置。</p>",
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
  const el =
      $('.canvas [data-opening-element="' + kind + '"]') ||
      $('.opening-preview [data-opening-element="' + kind + '"]'),
    frame = el?.closest(".opening-frame");
  if (el && frame && !el.hidden && el.getBoundingClientRect().width > 0) {
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
    x: kind === "progress" ? 17.75 : 50,
    y: kind === "progress" || kind === "start" ? 86 : 40,
    size: kind === "title" ? 90 : 35,
    width: kind === "progress" ? 23.5 : 70,
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
  const sourceNode = project.scenes.find((s) => s.id === id),
    targetNode = project.scenes.find((s) => s.id === target);
  if (targetNode?.role === "loading") throw Error("加载节点只用于作品启动");
  if (sourceNode?.role === "splash" && openingRole(targetNode))
    throw Error("开屏请连接剧情节点");
  if (
    sourceNode?.role === "loading" &&
    !["splash", "story"].includes(targetNode?.role)
  )
    throw Error("加载请连接开屏或剧情节点");
  if (target === LOADING) throw Error("加载节点只用于作品入口");
  if (id === SPLASH) {
    if (specialNode(target)) throw Error("开屏需要连接普通剧情");
    project.entryId = target;
    return;
  }
  const scene = project.scenes.find((s) => s.id === id);
  if (!scene) throw Error("源节点不存在");
  if (!specialNode(target) && !project.scenes.some((s) => s.id === target))
    throw Error("目标节点不存在");
  if (path === "next") {
    setCardNext(project, id, { kind: "scene", sceneId: target });
    return;
  }
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
    notify("入口连接需保留，可更换起始节点");
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

function stopTimelinePlayback() {
  timelinePlaying = false;
  cancelAnimationFrame(timelineFrame);
  if (still) {
    still.timelinePlaying = false;
    still.pauseMedia();
  }
  const button = $('[data-action="preview-here"]');
  if (button) {
    button.textContent = "▷ 播放";
    button.setAttribute("aria-label", "播放预览");
  }
}
function toggleTimelinePlayback() {
  if (timelinePlaying) {
    stopTimelinePlayback();
    return;
  }
  if (time >= editableDuration()) time = 0;
  timelinePlaying = true;
  still.timelinePlaying = true;
  const button = $('[data-action="preview-here"]');
  button.textContent = "Ⅱ 暂停";
  button.setAttribute("aria-label", "暂停预览");
  let previous = performance.now();
  const step = (now) => {
    if (!timelinePlaying || page !== "story" || graph) {
      stopTimelinePlayback();
      return;
    }
    if (!still.loading && !still.message.hidden) {
      stopTimelinePlayback();
      return;
    }
    if (!still.loading && !still.buffering)
      time = Math.min(
        editableDuration(),
        time + Math.min(100, now - previous) * previewRate(s(), time),
      );
    previous = now;
    paintStill();
    updatePlayhead();
    followPlayhead();
    if (time >= editableDuration()) {
      stopTimelinePlayback();
      return;
    }
    timelineFrame = requestAnimationFrame(step);
  };
  timelineFrame = requestAnimationFrame(step);
}
function followPlayhead() {
  const scroll = $(".timeline-scroll"),
    inner = scroll.querySelector(".timeline-inner");
  if (!inner) return;
  const x = 70 + ((inner.clientWidth - 70) * time) / timelineSpan();
  if (x - scroll.scrollLeft > scroll.clientWidth - 30)
    scroll.scrollLeft = x - scroll.clientWidth + 100;
  if (x - scroll.scrollLeft < 70) scroll.scrollLeft = Math.max(0, x - 100);
}
function queueStill() {
  if (scrubFrame) return;
  scrubFrame = requestAnimationFrame(() => {
    scrubFrame = 0;
    paintStill();
  });
}
function beginTimelineScrub(e) {
  e.preventDefault();
  const scroll = $(".timeline-scroll"),
    ruler = scroll.querySelector(".ruler");
  if (!ruler) return;
  const controller = new AbortController();
  let pointerX = e.clientX,
    frame;
  scroll.classList.add("scrubbing");
  const move = () => {
    const rect = ruler.getBoundingClientRect();
    time = clamp(
      Math.round(((pointerX - rect.left) / rect.width) * timelineSpan()),
      0,
      editableDuration(),
    );
    updatePlayhead();
    queueStill();
  };
  const autoScroll = () => {
    const r = scroll.getBoundingClientRect();
    const delta =
      pointerX > r.right - 30 ? 14 : pointerX < r.left + 90 ? -14 : 0;
    if (delta) {
      scroll.scrollLeft += delta;
      move();
    }
    frame = requestAnimationFrame(autoScroll);
  };
  move();
  frame = requestAnimationFrame(autoScroll);
  window.addEventListener(
    "pointermove",
    (ev) => {
      pointerX = ev.clientX;
      move();
    },
    { signal: controller.signal },
  );
  const finish = () => {
    controller.abort();
    cancelTimelineGesture = null;
    cancelAnimationFrame(frame);
    scroll.classList.remove("scrubbing");
    paintStill();
  };
  cancelTimelineGesture = finish;
  window.addEventListener("pointerup", finish, {
    once: true,
    signal: controller.signal,
  });
  window.addEventListener("pointercancel", finish, {
    once: true,
    signal: controller.signal,
  });
}
function setTimelineZoom(value, viewportX) {
  const scroll = $(".timeline-scroll"),
    inner = scroll.querySelector(".timeline-inner");
  const local =
    viewportX ??
    Math.min(
      scroll.clientWidth - 30,
      Math.max(
        70,
        70 +
          ((inner.clientWidth - 70) * time) / timelineSpan() -
          scroll.scrollLeft,
      ),
    );
  const fraction = (scroll.scrollLeft + local - 70) / (inner.clientWidth - 70);
  zoom = clamp(value, 1, 8);
  $("#zoom").value = zoom;
  renderTimeline();
  scroll.scrollLeft = zoomScroll(
    fraction,
    scroll.querySelector(".timeline-inner").clientWidth - 70,
    local,
  );
}
function timelineWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    setTimelineZoom(
      zoom * Math.exp(-e.deltaY * 0.002),
      e.clientX - e.currentTarget.getBoundingClientRect().left,
    );
  } else if (e.shiftKey) {
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY || e.deltaX;
  }
}
function previewKeys(e) {
  if (
    e.defaultPrevented ||
    page !== "story" ||
    graph ||
    e.target.closest(
      'input:not([type="range"]),textarea,select,[contenteditable="true"]',
    ) ||
    document.querySelector("dialog[open]")
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    if (e.repeat) return;
    toggleTimelinePlayback();
  } else if (
    ["ArrowLeft", "ArrowRight"].includes(e.key) &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey
  ) {
    e.preventDefault();
    stopTimelinePlayback();
    time = clamp(
      time + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1000 : 1000 / 30),
      0,
      editableDuration(),
    );
    updatePlayhead();
    queueStill();
    followPlayhead();
  } else if (e.key === "Escape") {
    cancelTimelineGesture?.();
    timelineSelection.clear();
    selection = { kind: "scene" };
    $(".timeline-context")?.remove();
    renderTimeline();
    renderInspector();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    timelineSelection.clear();
    for (const clip of $(".timeline-scroll").querySelectorAll("[data-clip]"))
      if (
        !previewTracks().locked.has(clip.closest(".track").dataset.trackId) &&
        clip.dataset.kind !== "opening"
      )
        timelineSelection.add(clip.dataset.clip);
    renderTimeline();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    try {
      timelineClipboard = copySelection(s(), selectedTimelineIds());
      e.preventDefault();
    } catch (error) {
      notify(error.message);
    }
  } else if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "v" &&
    timelineClipboard
  ) {
    e.preventDefault();
    try {
      pasteTimelineCopied();
    } catch (error) {
      notify(error.message);
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
    e.preventDefault();
    handleAction("split-clip", { dataset: {} }).catch((error) =>
      notify(error.message),
    );
  } else if (e.key === "Delete") {
    e.preventDefault();
    try {
      deleteTimelineSelected();
    } catch (error) {
      notify(error.message);
    }
  }
}
function timelineContext(e) {
  const label = e.target.closest(".track-label");
  if (label) {
    e.preventDefault();
    $(".timeline-context")?.remove();
    const id = label.closest(".track").dataset.trackId;
    const menu = document.createElement("div");
    menu.className = "timeline-context";
    menu.innerHTML = `<button data-action="track-lock" data-id="${esc(id)}">${previewTracks().locked.has(id) ? "解锁轨道" : "锁定轨道"}</button><button data-action="track-up" data-id="${esc(id)}">轨道上移</button><button data-action="track-down" data-id="${esc(id)}">轨道下移</button>`;
    document.body.append(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + "px";
    menu.style.top =
      Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + "px";
    menu.onclick = () => menu.remove();
    return;
  }
  const clip = e.target.closest("[data-clip]");
  if (!clip) {
    e.preventDefault();
    $(".timeline-context")?.remove();
    const menu = document.createElement("div");
    menu.className = "timeline-context";
    menu.innerHTML =
      '<button data-action="add-marker">在播放头处添加标记</button>';
    document.body.append(menu);
    menu.style.left = Math.min(e.clientX, window.innerWidth - 240) + "px";
    menu.style.top = Math.min(e.clientY, window.innerHeight - 60) + "px";
    menu.onclick = () => menu.remove();
    return;
  }
  e.preventDefault();
  $(".timeline-context")?.remove();
  stopTimelinePlayback();
  selection = { kind: clip.dataset.kind, id: clip.dataset.clip };
  renderInspector();
  const main = ["clip", "video", "image"].includes(selection.kind),
    c = main ? currentClip() : null;
  const locked = previewTracks().locked.has(
    clip.closest(".track").dataset.trackId,
  );
  const actions = [
    [
      "split-clip",
      "分割",
      !c || time <= c.startMs || time >= c.startMs + clipLength(c),
    ],
    ["copy-item", "复制", selection.kind === "opening"],
    ["delete-item", "删除", false],
    ["align-start", "开始位置对齐播放头", selection.kind === "opening"],
    [
      "align-end",
      "结束位置对齐播放头",
      ["opening", "event"].includes(selection.kind),
    ],
    ...(main ? [["lift-selected", "提到叠加轨道", false]] : []),
  ];
  const menu = document.createElement("div");
  menu.className = "timeline-context";
  menu.setAttribute("role", "menu");
  menu.innerHTML = actions
    .map(
      ([a, label, disabled]) =>
        `<button data-action="${a}" ${disabled || locked ? "disabled" : ""}>${label}</button>`,
    )
    .join("");
  document.body.append(menu);
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + "px";
  menu.style.top =
    Math.max(
      0,
      Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8),
    ) + "px";
  menu.addEventListener("click", () => menu.remove());
}

// One editing workspace: media above, timeline across the entire bottom.
function setupEditingLayout() {
  const timeline = document.createElement("section");
  timeline.className = "timeline-dock";
  timeline.setAttribute("aria-label", "节点时间轴");
  const grip = document.createElement("div");
  grip.className = "panel-resize timeline-resize";
  grip.dataset.resize = "timeline";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", "调整时间轴高度");
  timeline.append(grip, $(".timeline-head"), $(".timeline-scroll"));
  $(".layout").append(timeline);
  $(".timeline-actions").remove();
  const undo = document.createElement("button"),
    redo = document.createElement("button");
  undo.dataset.action = "undo";
  undo.textContent = "↶";
  undo.title = "撤销 Ctrl+Z";
  undo.setAttribute("aria-label", "撤销");
  redo.dataset.action = "redo";
  redo.textContent = "↷";
  redo.title = "重做 Ctrl+Shift+Z";
  redo.setAttribute("aria-label", "重做");
  $(".clip-tools").prepend(undo, redo);
  for (const [host, name, label] of [
    [".library", "library", "调整素材区宽度"],
    [".inspector", "inspector", "调整属性区宽度"],
  ]) {
    const handle = document.createElement("div");
    handle.className = `panel-resize ${name}-resize`;
    handle.dataset.resize = name;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", label);
    $(".layout").append(handle);
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem("talespark-panel-sizes") || "{}",
    );
    for (const [key, value] of Object.entries(saved))
      if (
        ["library", "inspector", "timeline"].includes(key) &&
        Number.isFinite(value)
      )
        document.body.style.setProperty(
          `--${key}-size`,
          clamp(value, 180, 600) + "px",
        );
  } catch {}
  document.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest("[data-resize]");
    if (!handle || document.body.dataset.view !== "scene" || e.button !== 0)
      return;
    e.preventDefault();
    const name = handle.dataset.resize,
      host = name === "timeline" ? timeline : $("." + name);
    const size = name === "timeline" ? host.offsetHeight : host.offsetWidth,
      start = name === "timeline" ? e.clientY : e.clientX;
    const controller = new AbortController();
    document.body.classList.add("resizing-panels");
    const move = (ev) => {
      const delta = (name === "timeline" ? ev.clientY : ev.clientX) - start;
      const max =
        name === "timeline"
          ? Math.max(180, window.innerHeight - 350)
          : Math.max(220, (window.innerWidth - 440) / 2);
      document.body.style.setProperty(
        `--${name}-size`,
        clamp(
          size + delta * (name === "library" ? 1 : -1),
          name === "timeline" ? 180 : 220,
          max,
        ) + "px",
      );
    };
    const finish = () => {
      controller.abort();
      document.body.classList.remove("resizing-panels");
      const saved = Object.fromEntries(
        ["library", "inspector", "timeline"]
          .map((key) => [
            key,
            parseFloat(
              getComputedStyle(document.body).getPropertyValue(`--${key}-size`),
            ),
          ])
          .filter(([, n]) => Number.isFinite(n)),
      );
      localStorage.setItem("talespark-panel-sizes", JSON.stringify(saved));
    };
    window.addEventListener("pointermove", move, { signal: controller.signal });
    window.addEventListener("pointerup", finish, {
      once: true,
      signal: controller.signal,
    });
    window.addEventListener("pointercancel", finish, {
      once: true,
      signal: controller.signal,
    });
  });
}
function revealTimelineItem(id) {
  const clip = [...$(".timeline-scroll").querySelectorAll("[data-clip]")].find(
    (el) => el.dataset.clip === id,
  );
  if (!clip) return;
  const scroll = $(".timeline-scroll"),
    a = clip.getBoundingClientRect(),
    b = scroll.getBoundingClientRect();
  if (a.left < b.left + 70) scroll.scrollLeft -= b.left + 82 - a.left;
  else if (a.right > b.right) scroll.scrollLeft += a.right - b.right + 12;
  if (a.top < b.top + 26) scroll.scrollTop -= b.top + 38 - a.top;
  else if (a.bottom > b.bottom) scroll.scrollTop += a.bottom - b.bottom + 12;
}
function markPreviewSelection() {
  for (const el of $(".canvas").querySelectorAll(
    "[data-edit-event],[data-edit-item]",
  ))
    el.classList.toggle(
      "editor-selected",
      (el.dataset.editEvent || el.dataset.editItem) === selection.id,
    );
}
function organizeProperties(panel) {
  if (page !== "story" || graph) return;
  const key = `${selected}:${selection.kind}:${selection.id || "node"}`;
  const type = selection.kind;
  const labels =
    type === "event"
      ? { appearance: "外观", interaction: "交互", story: "剧情" }
      : type === "subtitle"
        ? { appearance: "文本与样式", timing: "时间" }
        : type === "audio"
          ? { audio: "音频", timing: "时间" }
          : ["clip", "video", "image", "overlay"].includes(type)
            ? { appearance: "画面", timing: "时间", audio: "音频" }
            : null;
  if (!labels) return;
  const groups = Object.fromEntries(
    Object.keys(labels).map((k) => {
      const el = document.createElement("section");
      el.className = "property-section";
      el.dataset.propertySection = k;
      return [k, el];
    }),
  );
  const classify = (path) => {
    if (type === "event") {
      if (
        /^(success|failure|condition|linkedClipId)(\.|$)|^options\.\d+\.(target|actions|condition)/.test(
          path,
        )
      )
        return "story";
      if (
        /^(hint|x|y|scale|sound|volume|uiComponent|entryMotion)(\.|$)|^options\.\d+\.(text|x|y)/.test(
          path,
        )
      )
        return "appearance";
      return "interaction";
    }
    if (/^(startMs|endMs|inMs|outMs|durationMs|linkedClipId)$/.test(path))
      return "timing";
    if (
      /^(volume|fadeInMs|fadeOutMs)$/.test(path) ||
      (type === "audio" && path === "assetId")
    )
      return "audio";
    return type === "audio" ? "audio" : "appearance";
  };
  const children = [...panel.children],
    heading = panel.querySelector("h2");
  const extras = [];
  const distribute = (node) => {
    if (node === heading) return;
    if (node.matches("h3")) {
      if (type === "event" && /成功|失败|超时|选择后/.test(node.textContent))
        groups.story.append(node);
      return;
    }
    if (node.matches(".two")) {
      [...node.children].forEach(distribute);
      return;
    }
    if (
      node.matches(".issues") ||
      node.matches('[data-action="delete-item"]')
    ) {
      extras.push(node);
      return;
    }
    const fields = [...node.querySelectorAll("[data-field]")];
    let tab = fields.length
      ? classify(fields[0].dataset.field)
      : type === "event"
        ? "appearance"
        : Object.keys(labels)[0];
    if (
      node.matches('[data-action="add-option"]') ||
      node.classList.contains("option-card")
    )
      tab = "story";
    const path = node.querySelector("[data-path]")?.dataset.path;
    if (type === "event" && path) tab = classify(path);
    if (node.matches(".option-card")) {
      const containers = {};
      for (const child of [...node.children]) {
        if (child.matches("h4")) continue;
        const field = child.querySelector("[data-field]");
        const target = field ? classify(field.dataset.field) : "story";
        if (!containers[target]) {
          containers[target] = document.createElement("div");
          containers[target].className = "option-card";
          containers[target].append(node.querySelector("h4").cloneNode(true));
          groups[target].append(containers[target]);
        }
        containers[target].append(child);
      }
      return;
    }
    (groups[tab] || groups[Object.keys(labels)[0]]).append(node);
  };
  children.forEach(distribute);
  const tabs = document.createElement("div");
  tabs.className = "property-tabs";
  tabs.setAttribute("role", "tablist");
  const available = Object.keys(groups).filter(
    (k) => groups[k].childElementCount,
  );
  let active = propertyTabs.get(key);
  if (!available.includes(active)) active = available[0];
  const activate = (tab) => {
    propertyTabs.set(key, tab);
    for (const button of tabs.children) {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
      button.tabIndex = button.dataset.tab === tab ? 0 : -1;
    }
    for (const [name, group] of Object.entries(groups))
      group.hidden = name !== tab;
  };
  for (const tab of available) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tab = tab;
    button.textContent = labels[tab];
    button.setAttribute("role", "tab");
    button.onclick = () => activate(tab);
    tabs.append(button);
  }
  tabs.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const index = available.indexOf(propertyTabs.get(key));
    const next =
      available[
        (index + (e.key === "ArrowRight" ? 1 : -1) + available.length) %
          available.length
      ];
    activate(next);
    tabs.querySelector(`[data-tab="${next}"]`).focus();
  };
  panel.replaceChildren(
    ...(heading ? [heading] : []),
    tabs,
    ...Object.values(groups),
    ...extras,
  );
  activate(active);
  if (type === "event") {
    const item = items().find((x) => x.id === selection.id);
    if (item && !(time >= item.start && time <= item.end)) {
      const jump = document.createElement("button");
      jump.className = "full locate-interaction";
      jump.textContent = "定位到出现位置";
      jump.onclick = () => {
        stopTimelinePlayback();
        time = item.start;
        paintStill();
        updatePlayhead();
        renderInspector();
        revealTimelineItem(item.id);
      };
      panel.insertBefore(jump, tabs);
    }
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent =
      "固定时长互动：在时间轴整体移动，在这里设置出现范围和操作时限。";
    groups.interaction.prepend(hint);
  }
  const grip = document.createElement("div");
  grip.className = "panel-resize inspector-resize";
  grip.dataset.resize = "inspector";
  grip.setAttribute("role", "separator");
  grip.setAttribute("aria-label", "调整属性区宽度");
  try {
    assertTimelineUnlocked();
  } catch {
    panel
      .querySelectorAll("input,select,textarea,button:not([role=tab])")
      .forEach((el) => (el.disabled = true));
    const notice = document.createElement("p");
    notice.className = "muted";
    notice.textContent = "轨道已锁定，解锁后可调整素材。";
    panel.prepend(notice);
  }
}
async function paintTimelineMedia() {
  const scene = s(),
    project = p();
  for (const el of $(".timeline-scroll").querySelectorAll("[data-clip]")) {
    const kind = el.dataset.kind,
      id = el.dataset.clip;
    const item =
      kind === "clip"
        ? scene.clips.find((x) => x.id === id)
        : kind === "video"
          ? scene.video
          : kind === "image"
            ? scene.images.find((x) => x.id === id)
            : kind === "audio"
              ? scene.audio.find((x) => x.id === id)
              : kind === "overlay"
                ? scene.overlays.find((x) => x.id === id)
                : null;
    const asset = project.assets[item?.assetId];
    if (!asset || el.offsetWidth < 65) continue;
    try {
      if (kind === "audio") {
        const url = await assets.url(asset),
          waveform = await audioWaveform(
            url,
            item.inMs || 0,
            item.endMs - item.startMs,
          );
        if (!el.isConnected) continue;
        if (waveform) {
          const picture = document.createElement("img");
          picture.className = "clip-waveform";
          picture.alt = "音频波形";
          picture.src = waveform;
          el.prepend(picture);
        }
      } else {
        const url = await assets.url(asset),
          thumbnail = await timelineThumbnail(url, asset.kind);
        if (!el.isConnected) continue;
        const picture = document.createElement("img");
        picture.className = "clip-thumbnail";
        picture.alt = "";
        picture.src = thumbnail;
        el.prepend(picture);
      }
    } catch {}
  }
}

function deleteTimelineSelected() {
  assertTimelineUnlocked();
  if (selection.kind === "opening") {
    mutate("隐藏开场元素", () => (selectObject().hidden = true));
    return;
  }
  const ids = selectedTimelineIds();
  if (!ids.size) return;
  mutate("删除选中片段", () => {
    ensureSequence(s());
    for (const id of ids)
      if (s().clips.some((x) => x.id === id)) removeClip(s(), id, false, false);
    for (const key of ["events", "subtitles", "overlays", "audio", "effects"])
      s()[key] = s()[key].filter((x) => !ids.has(x.id));
  });
  timelineSelection.clear();
  selection = { kind: "scene" };
  render();
}
function pasteTimelineCopied() {
  if (!timelineClipboard) {
    notify("请先复制素材");
    return;
  }
  if (
    previewTracks().locked.has("main") &&
    timelineClipboard.entries.some((x) => x.key === "clips")
  )
    throw Error("主画面轨道已锁定");
  const kinds = {
    events: "event",
    subtitles: "subtitle",
    audio: "audio",
    effects: "effect",
    overlays: "overlay",
    clips: "clip",
  };
  let entries;
  mutate("粘贴片段", () => {
    entries = pasteSelection(s(), timelineClipboard, time, () => uid("item"));
    for (const x of entries)
      if (["events", "subtitles", "audio", "overlays"].includes(x.key)) {
        if (previewTracks().locked.has(x.item.trackId)) delete x.item.trackId;
        assignTrack(s(), kinds[x.key], x.item, x.item.trackId);
      }
  });
  timelineSelection.clear();
  entries.forEach((x) => timelineSelection.add(x.item.id));
  selection = { kind: kinds[entries[0].key], id: entries[0].item.id };
  render();
  revealTimelineItem(selection.id);
}

async function leaveDeletedProject() {
  clearTimeout(saveTimer);
  storage.queue.pending = null;
  storage.queue.stopped = true;
  if (storage.queue.running) await storage.queue.running;
  stopTimelinePlayback();
  previewSession?.dispose();
  idleWorkspace = true;
  dirty = false;
  workspaceReturn = null;
  if (storage.readLocal()?.project?.id === p().id)
    localStorage.removeItem("storyforge-v2-draft");
  page = "projects";
}
function fixInspectorHeader() {
  if (page !== "story" || graph) return;
  const host = $(".inspector");
  if (host.querySelector(".inspector-body")) return;
  const header = document.createElement("div");
  header.className = "inspector-header";
  const body = document.createElement("div");
  body.className = "inspector-body";
  for (const el of [...host.children]) {
    if (el.matches("h2, .property-tabs")) header.append(el);
    else body.append(el);
  }
  host.replaceChildren(header, body);
}
