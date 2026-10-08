import { AssetStore } from "./assets.mjs";
import { Storage, esc } from "./storage.mjs";
import { migrate, validate } from "./model.mjs";
import { Session } from "./session.mjs";
const root = document.querySelector("#game"),
  assets = new AssetStore(),
  storage = new Storage(assets);
const session = new Session(root, assets);
const version = new URLSearchParams(location.search).get("version");
async function boot() {
  try {
    let envelope;
    try {
      envelope = await storage.published(version || "");
    } catch (error) {
      if (version || ![404, 503].includes(error.status)) throw error;
      envelope = await storage.legacy();
    }
    const p = migrate(envelope.project);
    const issues = validate(p).filter((x) => x.level === "error");
    if (issues.length)
      throw Error("作品配置需要作者修复：" + issues[0].message);
    document.title = p.name;
    await session.open(p);
  } catch (error) {
    root.innerHTML = `<div class="opening"><div class="opening-error"><h1>作品暂不可用</h1><p>${esc(error.message)}</p><button id="retry">重新读取作品</button></div></div>`;
    root.querySelector("button").onclick = boot;
  }
}
boot();
