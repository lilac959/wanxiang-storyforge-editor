import {
  newProject,
  newScene,
  newEvent,
  uid,
  sceneTarget,
  endTarget,
} from "./model.mjs";
export function demoProject() {
  const p = newProject("互动影游 · 制作示例");
  p.variables = { score: 0 };
  p.assets = {
    "demo-video": {
      id: "demo-video",
      name: "分支剧情原始视频.mp4",
      source: "assets/chapter01-branch-2.mp4",
      kind: "video",
      mime: "video/mp4",
      durationMs: 7337,
      size: 0,
    },
    "demo-left": {
      id: "demo-left",
      name: "路线一.png",
      source: "assets/chapter01-01.png",
      kind: "image",
      mime: "image/png",
      size: 0,
    },
    "demo-right": {
      id: "demo-right",
      name: "路线二.png",
      source: "assets/chapter01-02.png",
      kind: "image",
      mime: "image/png",
      size: 0,
    },
    "demo-audio": {
      id: "demo-audio",
      name: "原创提示音.wav",
      source: "assets/demo-tone.wav",
      kind: "audio",
      mime: "audio/wav",
      durationMs: 2000,
      size: 0,
    },
  };
  const entry = newScene("入口 · 视频内的两次互动"),
    a = newScene("路线一 · 继续前行"),
    b = newScene("路线二 · 探索另一条路"),
    ea = newScene("结局一 · 旅程继续"),
    eb = newScene("结局二 · 新的发现");
  entry.video = {
    id: uid("clip"),
    assetId: "demo-video",
    inMs: 0,
    outMs: 7337,
  };
  const q = newEvent(1000, "qte", 2000);
  q.endMs = 3000;
  q.hint = "向右滑动，继续前行";
  q.success.actions = [{ variable: "score", op: "add", value: 1 }];
  const choice = newEvent(5000, "choice");
  choice.endMs = 7337;
  choice.options[0].text = "继续前行";
  choice.options[0].target = sceneTarget(a.id);
  choice.options[1].text = "探索另一条路";
  choice.options[1].target = sceneTarget(b.id);
  entry.events = [q, choice];
  entry.effects = [
    {
      id: uid("effect"),
      kind: "speed",
      startMs: 1000,
      endMs: 2500,
      value: 0.5,
    },
    { id: uid("effect"), kind: "bars", startMs: 0, endMs: 5000, value: 6 },
  ];
  entry.subtitles = [
    {
      id: uid("subtitle"),
      startMs: 0,
      endMs: 4000,
      text: "每一个动作，都可能改变下一段故事。",
      x: 50,
      y: 88,
      size: 30,
      color: "#ffffff",
      background: true,
    },
  ];
  entry.audio = [
    {
      id: uid("audio"),
      assetId: "demo-audio",
      startMs: 0,
      endMs: 2000,
      inMs: 0,
      volume: 0.25,
    },
  ];
  for (const [s, asset, next] of [
    [a, "demo-left", ea],
    [b, "demo-right", eb],
  ]) {
    s.source = "images";
    s.images = [{ id: uid("image"), assetId: asset, durationMs: 2000 }];
    s.next = sceneTarget(next.id);
  }
  for (const s of [ea, eb]) {
    s.role = "ending";
    s.subtitle = "再走一条路，发现另一种可能。";
    s.durationMs = 8000;
    const e = newEvent(0, "choice");
    e.endMs = 8000;
    e.options = [
      {
        id: uid("option"),
        text: "重新开始",
        target: sceneTarget(entry.id),
        condition: null,
        actions: [{ variable: "score", op: "set", value: 0 }],
        x: 0,
        y: 0,
      },
    ];
    s.events = [e];
    s.next = endTarget();
  }
  p.scenes = [entry, a, b, ea, eb];
  p.entryId = entry.id;
  p.editor.positions = {};
  p.scenes.forEach(
    (s, i) =>
      (p.editor.positions[s.id] = {
        x: 60 + (i === 0 ? 0 : i <= 2 ? 350 : 700),
        y: 60 + (i === 2 || i === 4 ? 280 : 0),
      }),
  );
  p.loading.title = "故事引擎";
  p.loading.titleLayout = "normal";
  p.splash.title = p.name;
  p.splash.subtitle = "在完整视频里，安排属于你的互动。";
  return p;
}
