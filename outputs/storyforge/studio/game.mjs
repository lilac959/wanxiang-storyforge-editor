import { AssetStore } from "./assets.mjs";
import { Storage, esc } from "./storage.mjs";
import { migrate, validate, openingCard } from "./model.mjs";
import { Session } from "./session.mjs";
const root = document.querySelector("#game"),
  assets = new AssetStore(),
  storage = new Storage(assets);
const session = new Session(root, assets);
const params = new URLSearchParams(location.search),
  version = params.get("version"),
  projectId = params.get("project");
async function boot() {
  try {
    let envelope;
    try {
      envelope = await storage.published(version || "", projectId || "");
    } catch (error) {
      if (version || projectId || ![404, 503].includes(error.status))
        throw error;
      envelope = await storage.legacy();
    }
    const p = migrate(envelope.project);
    const issues = validate(p).filter((x) => x.level === "error");
    if (issues.length)
      throw Error("作品配置需要作者修复：" + issues[0].message);
    document.title = p.name;
    assets.cacheVersion = envelope.version || p.id;
    const loading = openingCard(p, "loading");
    const cover = p.assets[loading?.opening?.image];
    if (cover) {
      try {
        localStorage.setItem(
          `storyforge-cover:${version || projectId || "default"}`,
          JSON.stringify({
            url: new URL(cover.source, location.href).href,
            ratio: p.canvasRatio,
          }),
        );
      } catch {}
    }
    await session.open(p);
  } catch (error) {
    root.innerHTML = `<div class="opening"><div class="opening-error"><h1>作品暂不可用</h1><p>${esc(error.message)}</p><button id="retry">重新读取作品</button></div></div>`;
    root.querySelector("button").onclick = boot;
  }
}
boot();
