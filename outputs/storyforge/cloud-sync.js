// Local drafts stay on this browser. Only explicit Save publishes a snapshot.
const cloudPlayer = document.documentElement.dataset.mode === "game";
let cloudSaving = false,
  gameVersion = "",
  gameStarting = false;
const cloudAssetCache = new Map();
function cloudToken() {
  return (
    sessionStorage.getItem("storyforge-publish-token") ||
    localStorage.getItem("storyforge-publish-token") ||
    ""
  );
}
async function cloudResponse(response) {
  if (response.ok) return response;
  const error = await response.json().catch(() => ({}));
  throw Object.assign(Error(error.error || `同步失败（${response.status}）`), {
    status: response.status,
  });
}
async function publishProject(snapshot) {
  if (cloudSaving) return;
  let token = cloudToken();
  if (!token) {
    token = prompt("首次同步：请输入本站发布密钥（只需连接一次）");
    if (!token?.trim()) {
      document.querySelector("#saved").textContent =
        "● 已保存本机 · 未连接游戏站";
      return;
    }
    localStorage.setItem("storyforge-publish-token", token.trim());
    token = token.trim();
  }
  cloudSaving = true;
  const button = document.querySelector("#saveConfig");
  button.disabled = true;
  try {
    const current = await fetch("/api/project", {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!current.ok && current.status !== 404) await cloudResponse(current);
    const revision = current.ok ? current.headers.get("ETag") : "none";
    const ids = [...new Set(projectAssets(snapshot).filter(Boolean))];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      button.textContent = `同步素材 ${i + 1}/${ids.length}`;
      if (/^asset-cloud-[a-f0-9]{64}$/.test(id)) continue;
      const resolved = asset(id),
        cacheKey = id + "\0" + resolved;
      let item = cloudAssetCache.get(cacheKey);
      if (!item) {
        let blob = id.startsWith("asset-") ? await getBlob(id) : null;
        if (!blob) {
          const response = await cloudResponse(
            await fetch(resolved || id, {
              signal: AbortSignal.timeout(120000),
            }),
          );
          blob = await response.blob();
        }
        const extension = (projectAssetName(snapshot, id, blob).match(
          /\.([a-z0-9]+)$/i,
        ) || [])[1]?.toLowerCase();
        const type = /^(image|video|audio)\//.test(blob.type)
          ? blob.type
          : {
              mp4: "video/mp4",
              webm: "video/webm",
              mov: "video/quicktime",
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              webp: "image/webp",
              gif: "image/gif",
            }[extension];
        if (!type) throw Error("无法识别素材格式：" + id);
        if (blob.size > 1024 * 1024 * 1024)
          throw Error("单个素材超过 1 GB，请压缩后再同步");
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
          ),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
        item = { blob, type, hash };
        cloudAssetCache.set(cacheKey, item);
      }
      const url = "/api/media/" + item.hash;
      const exists = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(30000),
      });
      if (!exists.ok) {
        if (exists.status !== 404) await cloudResponse(exists);
        const chunkSize = 20 * 1024 * 1024,
          total = Math.ceil(item.blob.size / chunkSize),
          partSizes = [];
        for (let part = 0; part < total; part++) {
          const chunk = item.blob.slice(
            part * chunkSize,
            Math.min(item.blob.size, (part + 1) * chunkSize),
            item.type,
          );
          partSizes.push(chunk.size);
          button.textContent = `同步素材 ${i + 1}/${ids.length} · ${part + 1}/${total}`;
          await cloudResponse(
            await fetch(`${url}/part/${part}`, {
              method: "PUT",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/octet-stream",
                "X-Total-Parts": String(total),
              },
              body: chunk,
              signal: AbortSignal.timeout(180000),
            }),
          );
        }
        await cloudResponse(
          await fetch(url, {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: item.type,
              size: item.blob.size,
              parts: total,
              partSizes,
            }),
            signal: AbortSignal.timeout(30000),
          }),
        );
      }
      remapProjectSource(snapshot, id, "asset-cloud-" + item.hash);
    }
    button.textContent = "发布配置…";
    await cloudResponse(
      await fetch("/api/publish", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "If-Match": revision,
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(30000),
      }),
    );
    document.querySelector("#saved").textContent = "● 本次保存已同步游戏站";
    notify("保存成功，独立游戏站已更新");
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem("storyforge-publish-token");
      sessionStorage.removeItem("storyforge-publish-token");
    }
    document.querySelector("#saved").textContent =
      "● 已保存本机 · 云端同步失败";
    notify(error.message + "；本机配置已保留，可再次保存重试");
  } finally {
    cloudSaving = false;
    button.disabled = false;
    button.textContent = "保存配置";
  }
}
function usePublishedProject(envelope) {
  if (!valid(envelope.project)) throw Error("游戏配置无效");
  project = envelope.project;
  gameVersion = envelope.version;
  selected = project.nodes[0].id;
  media.clear();
  for (const id of projectAssets(project).filter(Boolean)) {
    if (!/^asset-cloud-[a-f0-9]{64}$/.test(id)) throw Error("游戏素材地址无效");
    media.set(id, new URL("/api/media/" + id.slice(12), location.origin).href);
  }
  document.title = project.name;
  const title = document.querySelector("#gameTitle");
  if (title) title.textContent = project.name;
}
async function refreshPublishedProject() {
  const response = await cloudResponse(
    await fetch("/api/project", {
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    }),
  );
  usePublishedProject(await response.json());
}
async function startPublishedGame() {
  if (gameStarting) return;
  gameStarting = true;
  qteAudio.unlock();
  try {
    await refreshPublishedProject();
    document.querySelector("#gameUpdate").hidden = true;
    await start(true);
  } catch (error) {
    const message = document.querySelector("#gameMessage");
    if (message) message.textContent = error.message;
    notify(error.message);
  } finally {
    gameStarting = false;
  }
}
async function bootPublishedGame() {
  document.querySelector("#gameUpdate").onclick = startPublishedGame;
  await startPublishedGame();
  setInterval(async () => {
    if (document.hidden || gameStarting) return;
    try {
      const r = await fetch("/api/project", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return;
      const next = await r.json();
      if (next.version !== gameVersion) {
        if (activeRun) document.querySelector("#gameUpdate").hidden = false;
        else usePublishedProject(next);
      }
    } catch {}
  }, 30000);
}
// A setup URL is consumed locally; the key is never sent in a URL request.
if (!cloudPlayer) {
  const setup = new URLSearchParams(location.hash.slice(1)).get("publish-key");
  if (setup) {
    localStorage.setItem("storyforge-publish-token", setup);
    history.replaceState(null, "", location.pathname + location.search);
  }
}
