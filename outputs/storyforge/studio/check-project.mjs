import { clone, uid, validate, duration, gestures } from "./model.mjs";

const positive = (x) => Number.isSafeInteger(x) && x > 0;
const seconds = (x) =>
  Number.isFinite(x) ? `${+(x / 1000).toFixed(3)} 秒` : "未读取";
const eventName = (x) =>
  x?.hint ||
  (x?.kind === "choice"
    ? "选择互动"
    : x?.kind === "hotspot"
      ? "热点互动"
      : gestures[x?.gesture] || "操作互动");

// Never infer trim points, routes, gesture timing, or other creative decisions.
export async function repairTechnicalData(project, inspectAsset) {
  const fixed = clone(project),
    repairs = [],
    failures = [];
  const pending = Object.values(fixed.assets).filter(
    (a) =>
      a &&
      (["video", "audio"].includes(a.kind)
        ? !positive(a.durationMs)
        : a.kind === "image" && (!positive(a.width) || !positive(a.height))),
  );
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (index < pending.length) {
        const a = pending[index++];
        try {
          const meta = await inspectAsset(a);
          if (a.kind !== "image" && !positive(meta.durationMs))
            throw Error("未能读取有效时长");
          if (
            a.kind === "image" &&
            (!positive(meta.width) || !positive(meta.height))
          )
            throw Error("未能读取图片尺寸");
          for (const key of ["durationMs", "width", "height"])
            if (!positive(a[key]) && positive(meta[key])) a[key] = meta[key];
          repairs.push({
            message: `已补齐「${a.name}」的${a.kind === "image" ? "图片尺寸" : "素材时长"}`,
            assetId: a.id,
          });
        } catch (error) {
          failures.push({ assetId: a.id, message: error.message });
        }
      }
    }),
  );
  for (const scene of fixed.scenes) {
    const entries = [
      ...(scene.clips || []),
      ...(scene.images || []),
      ...(scene.events || []),
      ...(scene.subtitles || []),
      ...(scene.audio || []),
      ...(scene.effects || []),
      ...(scene.overlays || []),
      ...(scene.video ? [scene.video] : []),
      ...(scene.events || []).flatMap((e) => e?.options || []),
    ];
    let count = 0;
    for (const item of entries)
      if (item && !item.id) {
        item.id = uid("item");
        count++;
      }
    if (count)
      repairs.push({
        message: `已补齐「${scene.name}」中 ${count} 个内容的内部编号`,
        sceneId: scene.id,
      });
  }
  return { project: fixed, repairs, failures };
}

export function describeIssues(
  project,
  { publish = false, failures = [] } = {},
) {
  const raw = validate(project, { publish });
  const issues = raw.filter(
    (x) =>
      !(
        x.message.includes("待配置") &&
        raw.some(
          (other) =>
            other.sceneId === x.sceneId &&
            /缺少.*素材|缺少视频或图片/.test(other.message),
        )
      ) &&
      !(
        x.message === "剧情时长无效" &&
        raw.some(
          (other) =>
            other.sceneId === x.sceneId &&
            /片段时间|入点和出点/.test(other.message),
        )
      ),
  );
  const result = issues.map((issue) => {
    const s = project.scenes.find((s) => s.id === issue.sceneId);
    const collections = {
      clip: "clips",
      image: "images",
      event: "events",
      subtitle: "subtitles",
      audio: "audio",
      effect: "effects",
      overlay: "overlays",
    };
    const item =
      issue.itemKind === "video"
        ? s?.video
        : s?.[collections[issue.itemKind]]?.find((x) => x?.id === issue.itemId);
    const asset = project.assets[issue.assetId || item?.assetId];
    let title = issue.message,
      detail = "",
      action = issue.itemId ? "前往对应内容" : "前往节点";
    let view = "editor";
    const label =
      asset?.name ||
      issue.label ||
      (issue.itemKind === "event" ? eventName(item) : "");
    if (title === "画面片段时间无效" || title === "视频入点和出点无效") {
      title = "画面片段的时间需要修改";
      detail = `素材：${label || "未指定"}。截取开始 ${seconds(item?.inMs)}，截取结束 ${seconds(item?.outMs)}${item?.startMs !== undefined ? `，放置位置 ${seconds(item.startMs)}` : ""}。开始和结束需有效，结束应晚于开始，片段至少持续 0.1 秒。`;
      action = "前往片段";
    } else if (title === "主画面片段不能重叠") {
      title = "两个主画面同时播放";
      const previous = (s?.clips || []).filter(
        (c) =>
          c !== item &&
          c.startMs <= item?.startMs &&
          c.startMs + c.outMs - c.inMs > item?.startMs,
      )[0];
      detail = `「${project.assets[previous?.assetId]?.name || "前一个片段"}」与「${label || "当前片段"}」重叠。请决定前后排列，或将其中一个作为叠加画面。`;
      action = "前往重叠位置";
    } else if (/超过素材时长/.test(title)) {
      detail = `素材：${label || "未指定"}，原素材时长 ${seconds(asset?.durationMs)}。请缩短截取范围或更换素材。系统不会替你决定保留哪一段。`;
      action = "前往片段";
    } else if (issue.code === "interaction-route-conflict") {
      detail =
        "两个互动会在同一时刻等待超时，却配置了不同的剧情去向。请统一失败去向或错开结束时间；轨道上下顺序不决定剧情。";
      action = "前往互动时间轴";
    } else if (title === "同时出现的互动位置接近，可能互相遮挡") {
      detail =
        "两个互动可以同时出现，但画面位置接近。请在预览画面调整位置；重叠区域由上方轨道的互动接收操作。";
      action = "前往互动时间轴";
    } else if (
      /未连接的剧情出口|连接的剧情节点不存在|剧情去向无效/.test(title)
    ) {
      title = /不存在/.test(title)
        ? "出口连接的节点已不存在"
        : "剧情出口还没有确定去向";
      detail = `${label ? `「${label}」：` : "播放结束后："}请连接后续节点，或明确设为结束作品、继续播放。系统不会替你选择剧情走向。`;
      action = "查看节点出口";
      view = "graph";
    } else if (title === "剧情时长无效") {
      title = "节点没有有效的播放时长";
      detail = `当前时长 ${seconds(s && duration(s))}。请添加画面，或检查已有片段的时间。`;
    } else if (/无法到达/.test(title)) {
      title = "这张节点没有接入起始节点";
      detail =
        "如果这是备用内容，可以保留；如果需要在作品中出现，请连接到已有剧情。";
      view = "graph";
      action = "查看节点连接";
    } else if (/互动时间|视频位置结束|长按时长/.test(title)) {
      detail = `${label || "互动"}：开始 ${seconds(item?.startMs)}，结束 ${seconds(item?.endMs)}。请检查互动区间、结束方式及操作时限。`;
      action = "前往互动时间轴";
    } else if (/素材引用|素材类型/.test(title)) {
      detail = `${label || "使用的素材"}无法对应到有效素材。请替换素材或删除这个片段。`;
    } else if (/缺少.*素材|缺少视频或图片/.test(title)) {
      title = "这张节点还没有添加画面";
      detail =
        "请进入节点，将视频或图片从素材库拖到画面轨道。完成内容后，再取消待配置标记。";
      action = "进入节点添加画面";
    } else if (/占位选项文字/.test(title)) {
      title = "选项文字还没有填写完成";
      detail =
        "仍使用「选项一」「选项二」等默认文字。可以进入互动修改，也可以按当前文字发布。";
    } else if (/变量/.test(title)) {
      detail =
        "请检查变量是否已创建，以及条件或结果动作使用的值是否与变量类型一致。";
      view = issue.sceneId ? "editor" : "variables";
    } else {
      detail = `${label ? `对应内容：${label}。` : ""}请检查${issue.sceneId ? "这张节点的对应配置" : "作品的对应配置"}；系统保留原内容，等待你决定。`;
    }
    return {
      ...issue,
      title,
      detail,
      action,
      view,
      field: /片段时间|入点和出点|超过素材时长/.test(issue.message)
        ? "outMs"
        : /互动时间|互动区间/.test(issue.message)
          ? "startMs"
          : null,
    };
  });
  for (const failure of failures) {
    const a = project.assets[failure.assetId];
    const uses = project.scenes.filter((s) =>
      [
        s.video?.assetId,
        ...(s.clips || []).map((c) => c.assetId),
        ...(s.images || []).map((c) => c.assetId),
        ...(s.audio || []).map((c) => c.assetId),
        ...(s.overlays || []).map((c) => c.assetId),
      ].includes(failure.assetId),
    );
    result.push({
      level: uses.length ? "error" : "warning",
      sceneId: uses[0]?.id,
      assetId: failure.assetId,
      title: `无法读取「${a?.name || "素材"}」`,
      detail: `${failure.message}。请预览素材并确认文件是否可用，需要时重新上传或替换。`,
      view: "asset",
      action: "预览素材",
    });
  }
  return result;
}
