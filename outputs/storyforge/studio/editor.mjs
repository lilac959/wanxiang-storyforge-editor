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
  graph = false,
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
  el.classList.toggle("error", ["error", "conflict"].includes(state));
  el.textContent =
    {
      local: storage.token
        ? "● 本机已保存 · 等待同步"
        : "● 本机已保存 · 尚未连接云端",
      saving: "● 正在同步草稿…",
      saved: "● 草稿已同步 · 尚未发布",
      upload: `↑ ${detail?.name || "素材"} · ${detail?.progress || 0}%`,
      conflict: "● 云端有其他修改 · 本机副本保留",
      error: "● 云端保存失败 · 可重试",
    }[state] || state;
  el.title = detail?.message || el.textContent;
}
function mutate(label, fn) {
  history.commit(label, fn);
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
  return `<h3>${label}</h3>${field("后续动作", path + ".kind", t.kind, { options: { continue: "继续当前视频", scene: "进入另一剧情段落", seek: "跳到当前视频位置", end: "结束作品" } })}${t.kind === "scene" ? field("目标段落", path + ".sceneId", t.sceneId, { options: Object.fromEntries(p().scenes.map((x) => [x.id, x.name])) }) : t.kind === "seek" ? seconds("跳转到（秒）", path + ".timeMs", t.timeMs) : ""}`;
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
    `<header class="topbar"><div class="brand"><b>叙</b>叙境<small>STORYFORGE</small></div><input class="project-name" aria-label="作品名称" data-field="name" data-scope="project"><span class="save-status"></span><button data-action="undo" title="撤销 Ctrl+Z">↶</button><button data-action="redo" title="重做 Ctrl+Shift+Z">↷</button><button data-action="save">保存草稿</button><button data-action="connect">连接云端</button><button data-action="import">导入</button><button data-action="export">导出</button><button data-action="versions">版本</button><button data-action="publish">发布作品</button><button class="primary" data-action="preview-all">▷ 试玩作品</button></header><div class="layout"><nav class="rail"><button data-page="story"><b>⌘</b>剧情编排</button><button data-page="assets"><b>▧</b>素材库</button><button data-page="loading"><b>◌</b>加载页面</button><button data-page="splash"><b>◈</b>开屏动画</button><button data-page="variables"><b>◇</b>剧情变量</button><button class="bottom" data-action="projects"><b>☷</b>作品与恢复</button></nav><aside class="library"></aside><main class="workspace"><div class="workspace-head"><h1><span class="eyebrow">STORY WORKSPACE</span><br>剧情编排</h1><button data-action="canvas-view">画面编辑</button><button data-action="graph-view">剧情地图</button><button data-action="preview-current">▷ 预览当前</button></div><div class="story-work"><div class="canvas-label"><span></span><small>16:9 · 自适应画布</small></div><div class="canvas"><div class="player-root"></div></div><div class="board-list"></div><div class="transport"><button data-action="preview-here" aria-label="从当前位置试玩">▷</button><span class="time-label"></span><input id="seek" type="range" min="0" step="10" aria-label="画面进度"><span class="duration-label"></span></div><div class="timeline-head"><span>时间轴 · 选择内容后在右侧编辑</span><label>缩放 <input id="zoom" type="range" min="1" max="5" step=".25" value="1.5"></label></div><div class="timeline-actions"><button data-action="add-qte">＋ 操作</button><button data-action="add-choice">＋ 选择</button><button data-action="add-hotspot">＋ 热点</button><button data-action="add-subtitle">＋ 字幕</button><button data-action="add-audio">＋ 音频</button><button data-action="add-speed">＋ 慢放区间</button><button data-action="add-bars">＋ 电影黑边</button></div><div class="timeline-scroll"></div><p class="hint">拖动片段或两端调整时间，方向键微调 0.1 秒。拖动画面中的互动调整位置。定位只查看画面，点击 ▷ 才执行互动。</p></div><div class="graph-scroll" hidden><div class="graph-board"></div></div><div class="settings-page" hidden></div></main><aside class="inspector"></aside></div>`;
  still = new PlayerView($(".canvas .player-root"), assets, {
    editing: true,
    onSelect: (id) => {
      selection = { kind: "event", id };
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
  $(".graph-board").addEventListener("pointerdown", graphPointer);
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
  if (!p().scenes.some((x) => x.id === selected)) selected = p().entryId;
  if (!selectObject()) selection = { kind: "scene" };
  time = clamp(time, 0, duration(s()));
  $(".project-name").value = p().name;
  document.title = `${p().name} · 叙境`;
  $('[data-action="undo"]').disabled = !history.past.length;
  $('[data-action="redo"]').disabled = !history.future.length;
  document
    .querySelectorAll("[data-page]")
    .forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  $(".library").innerHTML =
    `<div class="eyebrow">YOUR STORY, YOUR RULES</div><h2>剧情段落 <small>${p().scenes.length}</small></h2><p class="muted">一段视频，多次互动。<br>在地图连接不同的故事走向。</p><button class="full" data-action="add-scene">＋ 新建剧情段落</button>${p()
      .scenes.map(
        (x, i) =>
          `<div class="scene-item ${x.id === selected ? "selected" : ""}" data-scene="${esc(x.id)}" draggable="true" role="button" tabindex="0"><span class="number">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(x.name)}</strong><small>${(duration(x) / 1000).toFixed(1)} 秒 · ${x.events.length} 次互动</small></div>${p().entryId === x.id ? '<span class="entry">入口</span>' : ""}</div>`,
      )
      .join("")}`;
  $(".workspace-head h1").innerHTML =
    `<span class="eyebrow">STORY WORKSPACE</span><br>${{ story: "剧情编排", assets: "素材库", loading: "加载页面", splash: "开屏动画", variables: "剧情变量" }[page]}`;
  $(".story-work").hidden = page !== "story" || graph;
  $(".graph-scroll").hidden = page !== "story" || !graph;
  $(".settings-page").hidden = page === "story";
  $('[data-action="canvas-view"]').classList.toggle("active", !graph);
  $('[data-action="graph-view"]').classList.toggle("active", graph);
  if (page === "story") {
    if (graph) renderGraph();
    else {
      renderTimeline();
      paintStill();
    }
  } else renderSettings();
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
  if (scene.source === "images") {
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
  ])
    for (const x of scene[key])
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
              : kind === "audio"
                ? p().assets[x.assetId]?.name
                : x.kind === "speed"
                  ? `${x.value} 倍速`
                  : "电影黑边",
      });
  return list;
}
function renderTimeline() {
  if (page !== "story") return;
  const d = duration(s());
  const groups = [
    ["画面", ["video", "image"]],
    ["互动", ["event"]],
    ["字幕", ["subtitle"]],
    ["音频", ["audio"]],
    ["播放速度", ["effect"], "speed"],
    ["电影黑边", ["effect"], "bars"],
  ];
  $(".timeline-scroll").innerHTML =
    `<div class="timeline-inner" style="width:${zoom * 100}%"><div class="ruler">${[0, 0.25, 0.5, 0.75, 1].map((n) => `<span style="left:${n * 100}%">${((d * n) / 1000).toFixed(1)}s</span>`).join("")}</div>${groups
      .map(
        ([name, kinds, effectKind]) =>
          `<div class="track"><div class="track-label">${name}</div><div class="lane">${items()
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
    line.style.left = `calc(73px + (100% - 73px) * ${time / duration(s())})`;
  $(".time-label").textContent = sec(time).toFixed(1) + "s";
}
function renderInspector() {
  let html = "<h2>属性设置</h2>",
    obj = selectObject(),
    scene = s();
  if (page !== "story") {
    html +=
      '<p class="muted">在中间工作区编辑当前页面。剧情段落的设置可从左侧列表打开。</p>';
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
      `<button class="full" data-action="set-entry">设为作品入口</button><h3>播放内容</h3>` +
      field("正式播放来源", "source", scene.source, {
        options: { video: "视频", images: "分镜图片序列" },
      }) +
      `<button class="full" data-action="upload-scene">＋ 导入 / 替换视频与图片</button><button class="full" data-action="video-link">从视频直链导入</button>${scene.video ? `<button class="full" data-select-kind="video" data-select-id="${scene.video.id}">编辑视频入点 / 出点</button>` : seconds("无视频时长（秒）", "durationMs", scene.durationMs)}${targetFields("播放结束后", "next", scene.next)}<button class="full danger" data-action="delete-scene">删除当前段落</button>`;
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
  if (issues.length)
    html += `<div class="issues"><strong>当前检查</strong>${issues
      .slice(0, 8)
      .map((x) => `<p>${x.level === "error" ? "●" : "△"} ${esc(x.message)}</p>`)
      .join("")}</div>`;
  $(".inspector").innerHTML = html;
}
function renderSettings() {
  const box = $(".settings-page");
  if (page === "assets") {
    box.innerHTML = `<h2>作品素材库</h2><p class="muted">原始素材保留。点击使用，将素材放入左侧选中的剧情段落。</p><button class="primary" data-action="upload-library">＋ 导入视频 / 图片 / 音频</button>${Object.values(
      p().assets,
    )
      .map(
        (a) =>
          `<div class="asset-item"><strong>${esc(a.name)}</strong><small>${{ video: "视频", image: "图片", audio: "音频" }[a.kind]} · ${a.durationMs ? sec(a.durationMs).toFixed(2) + " 秒 · " : ""}${a.size ? (a.size / 1024 / 1024).toFixed(1) + " MB" : "内置 / 云端素材"} · ${p().scenes.filter((s) => [s.video?.assetId, ...s.images.map((f) => f.assetId), ...s.audio.map((f) => f.assetId)].includes(a.id)).length} 个段落使用</small><button data-action="use-asset" data-id="${a.id}">用于当前段落</button><button data-action="replace-asset" data-id="${a.id}">替换素材</button><button data-action="check-asset" data-id="${a.id}">检查可用性</button><button data-action="remove-asset" data-id="${a.id}">移除未使用素材</button></div>`,
      )
      .join("")}`;
    return;
  }
  if (page === "variables") {
    box.innerHTML = `<h2>剧情变量</h2><p class="muted">记录分数、是否获得物品等状态。互动可以按条件显示，也可以在完成后改变这些值。重新开始作品时恢复初始值。</p><button data-action="add-variable">＋ 新建变量</button>${Object.entries(
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
    `<button data-action="upload-opening">＋ 上传 / 替换背景素材</button><button data-action="preview-current">▷ 预览此页面</button><p class="muted">${page === "loading" ? "先准备开场所需素材，剧情运行时按需要读取后续内容。视频优先显示，图片可用作备用封面。" : "视频循环播放，玩家点击或按键后进入明确的开始段落。"}</p>`;
}
function ports(scene) {
  const list = [{ path: "next", label: "播放结束", target: scene.next }];
  scene.events.forEach((e, i) => {
    if (e.kind === "choice")
      e.options.forEach((o, j) =>
        list.push({
          path: `events.${i}.options.${j}.target`,
          label: o.text,
          target: o.target,
        }),
      );
    else
      list.push({
        path: `events.${i}.success.target`,
        label: `${gestures[e.gesture]} · 成功`,
        target: e.success.target,
      });
    if (e.kind !== "choice" || e.endMode !== "wait")
      list.push({
        path: `events.${i}.failure.target`,
        label: "失败 / 超时",
        target: e.failure.target,
      });
  });
  return list;
}
function renderGraph() {
  const positions = p().editor.positions;
  const size = {
    width: Math.max(
      1300,
      ...p().scenes.map((s) => (positions[s.id]?.x || 0) + 350),
    ),
    height: Math.max(
      1000,
      ...p().scenes.map(
        (s) => (positions[s.id]?.y || 0) + ports(s).length * 34 + 130,
      ),
    ),
  };
  let lines = "";
  for (const scene of p().scenes) {
    const from = positions[scene.id] || { x: 60, y: 60 };
    ports(scene).forEach((port, i) => {
      if (port.target.kind !== "scene") return;
      const to = positions[port.target.sceneId];
      if (!to) return;
      const x1 = from.x + 255,
        y1 = from.y + 80 + i * 34,
        x2 = to.x,
        y2 = to.y + 35;
      lines += `<path d="M ${x1} ${y1} C ${x1 + 80} ${y1},${x2 - 80} ${y2},${x2} ${y2}" marker-end="url(#arrow)"/>`;
    });
  }
  $(".graph-board").style.width = size.width + "px";
  $(".graph-board").style.height = size.height + "px";
  $(".graph-board").innerHTML =
    `<svg class="graph-lines"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" style="fill:#a4bf7a;stroke:none"/></marker></defs>${lines}</svg>${p()
      .scenes.map((scene) => {
        const pos = positions[scene.id] || { x: 60, y: 60 };
        return `<article class="graph-card ${scene.id === selected ? "selected" : ""}" data-graph-scene="${scene.id}" style="left:${pos.x}px;top:${pos.y}px"><h3>${p().entryId === scene.id ? "▷ " : ""}${esc(scene.name)}</h3><small>${scene.role === "ending" ? "结局 · " : scene.role === "death" ? "失败 · " : ""}${sec(duration(scene)).toFixed(1)} 秒 · ${scene.events.length} 次互动</small>${ports(
          scene,
        )
          .map(
            (port) =>
              `<button data-port="${port.path}" data-from="${scene.id}" class="${linkFrom?.sceneId === scene.id && linkFrom.path === port.path ? "pending" : ""}">${esc(port.label)} → ${esc(port.target.kind === "scene" ? p().scenes.find((x) => x.id === port.target.sceneId)?.name || "目标缺失" : { continue: "继续", end: "结束作品", seek: "视频内跳转" }[port.target.kind])}</button>`,
          )
          .join("")}</article>`;
      })
      .join("")}`;
  $(".canvas-label span").textContent =
    "点击出口，再点击目标段落连接；也可直接拖动出口到目标。";
}
function panel(html) {
  $(".panel-content").innerHTML = html;
  if (!$("#panel").open) $("#panel").showModal();
}
function closePanel() {
  $("#panel").close();
}
async function adopt(project, revision = "none", backup = true) {
  clearTimeout(saveTimer);
  storage.queue.pending = null;
  storage.queue.stopped = true;
  if (storage.queue.running) await storage.queue.running;
  if (history && backup) storage.backup(p(), "切换作品前");
  history = new History(project, changed);
  selected = project.entryId;
  selection = { kind: "scene" };
  page = "story";
  graph = false;
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
  status("● 本机草稿已恢复");
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
  if (!full && page === "splash") {
    previewSession.project = clone(p());
    await previewSession.home();
  } else
    await previewSession.open(
      p(),
      !full && page === "loading"
        ? { only: "loading" }
        : full
          ? {}
          : { sceneId: selected, time: here ? time : 0 },
    );
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
  if (asset.kind === "video") {
    scene.video = {
      id: uid("clip"),
      assetId: asset.id,
      inMs: 0,
      outMs: asset.durationMs,
    };
    scene.source = "video";
  } else if (asset.kind === "image") {
    const f = { id: uid("image"), assetId: asset.id, durationMs: 3000 };
    const index = after
      ? scene.images.findIndex((x) => x.id === after) + 1
      : scene.images.length;
    scene.images.splice(index, 0, f);
    scene.source = "images";
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
    if (
      context.mode === "scene" &&
      files.filter((f) => f.type.startsWith("video/")).length > 1
    )
      throw Error("当前段落只支持一个主视频，请分开导入");
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
  switch (action) {
    case "undo":
      history.undo();
      break;
    case "redo":
      history.redo();
      break;
    case "save":
      storage.saveLocal(p());
      await sync();
      notify(
        storage.token ? "已执行草稿保存，请查看顶部状态" : "草稿已保存到本机",
      );
      break;
    case "canvas-view":
      page = "story";
      graph = false;
      render();
      break;
    case "graph-view":
      page = "story";
      graph = true;
      render();
      notify("点击一个出口，再点击目标段落建立连接");
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
        `<h2>选择音频</h2>${list.map((a) => `<button class="full" data-action="use-asset" data-id="${a.id}">${esc(a.name)}</button>`).join("")}<button data-action="upload-scene">＋ 导入新音频</button>`,
      );
      break;
    }
    case "delete-item": {
      const key = {
        event: "events",
        image: "images",
        subtitle: "subtitles",
        audio: "audio",
        effect: "effects",
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
    case "use-asset": {
      const a = p().assets[button.dataset.id];
      mutate("使用素材", (p) => addAssetToScene(p, s(), a));
      closePanel();
      page = "story";
      selection = { kind: "scene" };
      render();
      break;
    }
    case "replace-asset":
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
        notify("这个素材仍在使用，请先移除对应内容");
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
        '<h2>连接创作者云端</h2><p>授权仅保存在当前浏览器会话。连接后，编辑会自动同步私有草稿。</p><label class="field">发布授权<input id="cloud-key" type="password" autocomplete="off"></label><button class="primary" data-action="confirm-connect">连接并检查草稿</button>',
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
      closePanel();
      await sync();
      break;
    }
    case "load-cloud": {
      const draft = await storage.draft(p().id);
      await adopt(migrate(draft.project), draft.revision);
      closePanel();
      notify("已打开云端草稿，本机原稿保留在恢复列表");
      break;
    }
    case "publish":
      if (busy) throw Error("请等待素材导入完成");
      if (!storage.token) {
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
        const url = new URL("/game", location.origin);
        url.searchParams.set("version", result.version);
        panel(
          `<h2>发布成功</h2><p>已验证独立版本可以读取。草稿后续修改不会改变此版本。</p><p><a href="${esc(url.href)}" target="_blank" rel="noopener">打开本次发布的作品</a></p><p><a href="/game" target="_blank" rel="noopener">作品固定链接</a></p>`,
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
      const list = await storage.versions();
      let current;
      try {
        current = (await storage.published()).version;
      } catch {}
      panel(
        `<h2>发布版本</h2><p>恢复旧发布版不会覆盖当前草稿。</p>${list.length ? list.map((v) => `<div class="version"><strong>${esc(v.name)}</strong><p>${esc(new Date(v.updatedAt).toLocaleString())}${v.version === current ? " · 当前公开版本" : ""}</p><a href="/game?version=${v.version}" target="_blank" rel="noopener">查看此版</a> <button data-action="restore-version" data-id="${v.version}">恢复为公开版本</button></div>`).join("") : "<p>尚未发布。</p>"}`,
      );
      break;
    }
    case "restore-version":
      await storage.restore(button.dataset.id);
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
        `<h2>作品与恢复</h2><p>切换前会保留当前作品的本机备份。</p><button data-action="new-project">新建空白作品</button> <button data-action="demo">打开制作示例</button><h3>云端草稿</h3>${cloud.map((x) => `<button class="full" data-action="open-project" data-id="${x.id}">${esc(x.name)} · ${esc(new Date(x.updatedAt).toLocaleString())}</button>`).join("") || "<p>连接云端后可查看。</p>"}<h3>本机恢复副本</h3>${backups.map((x) => `<button class="full" data-action="restore-backup" data-id="${esc(x.key)}">${esc(x.label)} · ${esc(new Date(x.updatedAt).toLocaleString())}</button>`).join("") || "<p>尚无恢复副本。</p>"}<p><a href="legacy.html" target="_blank">打开旧版编辑器（用于旧数据检查）</a></p>`,
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
function timelinePointer(e) {
  const clip = e.target.closest("[data-clip]");
  if (!clip) {
    const ruler = e.target.closest(".ruler");
    if (ruler) {
      const rect = ruler.getBoundingClientRect();
      time = clamp(
        Math.round(((e.clientX - rect.left) / rect.width) * duration(s())),
        0,
        duration(s()),
      );
      paintStill();
      updatePlayhead();
    }
    return;
  }
  e.preventDefault();
  selection = { kind: clip.dataset.kind, id: clip.dataset.clip };
  renderInspector();
  paintStill();
  const obj = selectObject(),
    before = clone(obj),
    edge = e.target.dataset.edge,
    rect = clip.parentElement.getBoundingClientRect(),
    startX = e.clientX,
    d = duration(s());
  let delta = 0;
  const controller = new AbortController();
  window.addEventListener(
    "pointermove",
    (ev) => {
      delta =
        Math.round((((ev.clientX - startX) / rect.width) * d) / 100) * 100;
      clip.style.transform = `translateX(${edge ? 0 : ev.clientX - startX}px)`;
      if (edge) clip.style.opacity = ".65";
    },
    { signal: controller.signal },
  );
  const finish = (ev) => {
    controller.abort();
    clip.style.transform = "";
    clip.style.opacity = "";
    if (ev.type === "pointercancel" || !delta) {
      renderTimeline();
      return;
    }
    mutate("调整时间轴", () => {
      if (selection.kind === "video") {
        if (edge === "left")
          obj.inMs = clamp(before.inMs + delta, 0, before.outMs - 100);
        else if (edge === "right")
          obj.outMs = clamp(
            before.outMs + delta,
            before.inMs + 100,
            p().assets[obj.assetId].durationMs || 7200000,
          );
      } else if (selection.kind === "image") {
        if (edge) obj.durationMs = Math.max(100, before.durationMs + delta);
        else {
          const list = s().images,
            index = list.findIndex((x) => x.id === obj.id);
          let pos = 0;
          const drop = items().find((x) => x.id === obj.id).start + delta,
            j = list.findIndex((x) => {
              pos += x.durationMs;
              return drop < pos;
            });
          list.splice(j < 0 ? list.length - 1 : j, 0, list.splice(index, 1)[0]);
        }
      } else {
        if (edge === "left")
          obj.startMs = clamp(
            before.startMs + delta,
            0,
            before.endMs - (selection.kind === "event" ? 0 : 100),
          );
        else if (edge === "right")
          obj.endMs = clamp(
            before.endMs + delta,
            before.startMs + (selection.kind === "event" ? 0 : 100),
            d,
          );
        else {
          const length = before.endMs - before.startMs;
          obj.startMs = clamp(before.startMs + delta, 0, d - length);
          obj.endMs = obj.startMs + length;
        }
      }
    });
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
    if (selection.kind === "image")
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
  const el = e.target.closest("[data-edit-event]");
  if (!el || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selection = { kind: "event", id: el.dataset.editEvent };
  const event = selectObject(),
    option = event.options.find((x) => x.id === el.dataset.optionId),
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
      mutate("调整互动位置", () => {
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
function graphPointer(e) {
  const card = e.target.closest("[data-graph-scene]");
  if (!card || e.button !== 0) return;
  const port = e.target.closest("[data-port]"),
    sceneId = card.dataset.graphScene,
    start = { x: e.clientX, y: e.clientY },
    pos = p().editor.positions[sceneId] || { x: 60, y: 60 };
  let dx = 0,
    dy = 0;
  const controller = new AbortController();
  window.addEventListener(
    "pointermove",
    (ev) => {
      dx = ev.clientX - start.x;
      dy = ev.clientY - start.y;
      if (!port) {
        card.style.left = Math.max(0, pos.x + dx) + "px";
        card.style.top = Math.max(0, pos.y + dy) + "px";
      }
    },
    { signal: controller.signal },
  );
  const finish = (ev) => {
    controller.abort();
    if (ev.type === "pointercancel") {
      renderGraph();
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      suppressClick = true;
      if (port) {
        const target = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest("[data-graph-scene]")?.dataset.graphScene;
        if (target)
          mutate("连接剧情", (p) =>
            set(
              p.scenes.find((x) => x.id === sceneId),
              port.dataset.port,
              { kind: "scene", sceneId: target },
            ),
          );
      } else
        mutate(
          "移动剧情卡片",
          (p) =>
            (p.editor.positions[sceneId] = {
              x: Math.max(0, pos.x + dx),
              y: Math.max(0, pos.y + dy),
            }),
        );
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
document.addEventListener("click", async (e) => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const button = e.target.closest("button");
  try {
    if (button?.dataset.action) {
      await handleAction(button.dataset.action, button);
      return;
    }
    if (button?.dataset.page) {
      page = button.dataset.page;
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
    const card = e.target.closest("[data-graph-scene]");
    if (card) {
      const id = card.dataset.graphScene;
      if (linkFrom) {
        const from = linkFrom;
        linkFrom = null;
        mutate("连接剧情", (p) =>
          set(
            p.scenes.find((x) => x.id === from.sceneId),
            from.path,
            { kind: "scene", sceneId: id },
          ),
        );
      }
      selected = id;
      selection = { kind: "scene" };
      renderInspector();
      renderGraph();
      return;
    }
    const item = e.target.closest("[data-scene]");
    if (item) {
      selected = item.dataset.scene;
      selection = { kind: "scene" };
      page = "story";
      time = 0;
      render();
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
  mutate("修改属性", () => {
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
});
document.addEventListener("keydown", (e) => {
  if ($("#preview").open) return;
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
