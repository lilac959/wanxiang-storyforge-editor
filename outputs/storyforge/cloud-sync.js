// Deployment is explicit. Editors load the shared published snapshot.
const cloudPlayer = document.documentElement.dataset.mode === "game";
let cloudSaving = false,
  gameVersion = "",
  gameStarting = false,
  editorRevision = null,
  editorDirty = false,
  editorReady = false;
const cloudAssetCache = new Map();
// A new media URL bypasses responses cached before the expired uploads were restored.
function cloudMediaUrl(id) {
  const url = new URL("/api/media/" + id.slice(12), location.origin);
  url.searchParams.set("mediaRevision", "restored-20260920");
  return url.href;
}
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
async function retryCloudWrite(makeRequest, shouldRetry, attempts = 8) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await cloudResponse(await makeRequest());
    } catch (next) {
      error = next;
      if (!shouldRetry(next) || attempt === attempts - 1) throw next;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw error;
}
function markEditorDraft() {
  if (!editorReady || cloudPlayer) return;
  editorDirty = true;
  localStorage.setItem("storyforge-draft-base", editorRevision || "none");
  document.querySelector("#saved").textContent = "● 草稿已保存 · 尚未部署";
}
function backupEditorDraft() {
  const saved = localStorage.getItem("storyforge-project");
  if (saved && !localStorage.getItem("storyforge-draft-backup")) localStorage.setItem("storyforge-draft-backup", saved);
}
async function loadEditorDeployment() {
  const response = await fetch("/api/project", {cache:"no-store",signal:AbortSignal.timeout(30000)});
  if (response.status === 404) { editorRevision = "none"; return false; }
  await cloudResponse(response);
  const envelope = await response.json();
  if (!valid(envelope.project)) throw Error("云端配置无效，本机草稿已保留");
  backupEditorDraft();
  usePublishedProject(envelope);
  editorRevision = response.headers.get("X-Project-Revision") || response.headers.get("ETag")?.replace(/^W\//,"");
  editorDirty = false;
  localStorage.setItem("storyforge-project",JSON.stringify(project));
  localStorage.setItem("storyforge-draft-base",editorRevision);
  selected = project.nodes[0].id;
  page = "story";
  render();
  document.querySelector("#saved").textContent = "● 已加载部署版本";
  return true;
}
function watchEditorDeployment() {
  editorReady = true;
  document.querySelector("#restoreDraft").hidden = !localStorage.getItem("storyforge-draft-backup");
  setInterval(async () => {
    if (document.hidden || cloudSaving || activeRun) return;
    try {
      const r = await cloudResponse(await fetch("/api/project",{cache:"no-store",signal:AbortSignal.timeout(10000)}));
      const revision=r.headers.get("X-Project-Revision") || r.headers.get("ETag")?.replace(/^W\//,"");
      if (revision === editorRevision) return;
      if (editorDirty) {
        document.querySelector("#saved").textContent="● 云端有新部署 · 请先导出草稿再刷新";
      } else await loadEditorDeployment();
    } catch {}
  },30000);
}
async function restoreEditorDraft() {
  const saved=localStorage.getItem("storyforge-draft-backup");
  if (!saved) return;
  const draft=JSON.parse(saved);
  if (!valid(draft)) { notify("本机备份无效"); return; }
  project=draft;
  for(const id of projectAssets(project)) if (/^asset-cloud-[a-f0-9]{64}$/.test(id)) media.set(id,cloudMediaUrl(id));
  for(const id of projectAssets(project)) { const blob=await getBlob(id); if(blob)media.set(id,URL.createObjectURL(blob)); }
  selected=project.nodes[0].id;
  page="story";
  save();
  render();
  notify("已恢复本机草稿；检查后点击部署");
}
async function publishProject(snapshot, interactive = true) {
  if (cloudSaving) return;
  if (!editorRevision) { notify("尚未读取云端版本，请联网刷新后部署"); return; }
  const draftAtStart = JSON.stringify(project);
  let token = cloudToken();
  if (!token) {
    if (!interactive) return;
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
  const button = document.querySelector("#deployProject");
  button.disabled = true;
  try {
    const revision = editorRevision;
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
        await retryCloudWrite(
          () => fetch(url, {
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
          (error) => error.status === 400 && /素材第.+块尚未上传/.test(error.message),
        );
      }
      remapProjectSource(snapshot, id, "asset-cloud-" + item.hash);
    }
    button.textContent = "发布配置…";
    const publishedResponse = await retryCloudWrite(
      () => fetch("/api/publish", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "If-Match": revision,
          "X-Deploy-Protocol": "2",
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(30000),
      }),
      (error) => error.status === 400 && error.message === "有素材尚未上传完成",
    );
    const result = await publishedResponse.json();
    editorRevision = result.revision;
    editorDirty = JSON.stringify(project) !== draftAtStart;
    localStorage.setItem("storyforge-draft-base",editorRevision);
    document.querySelector("#saved").textContent = editorDirty ? "● 部署成功 · 仍有新的本机修改待部署" : "● 已部署 · 编辑器与游戏站共用此版本";
    notify("部署成功，其他电脑及游戏站将加载完整部署版本");
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem("storyforge-publish-token");
      sessionStorage.removeItem("storyforge-publish-token");

    }
    document.querySelector("#saved").textContent =
      "● 已保存本机 · 云端同步失败";
    document.querySelector("#saved").title = error.message;
    notify(error.message + "；本机配置已保留，可再次保存重试");
  } finally {
    cloudSaving = false;
    button.disabled = false;
    button.textContent = "部署";
  }
}
function usePublishedProject(envelope) {
  if (!valid(envelope.project)) throw Error("游戏配置无效");
  project = envelope.project;
  gameVersion = envelope.version;
  selected = project.nodes[0].id;
  if (cloudPlayer) media.clear();
  for (const id of projectAssets(project).filter(Boolean)) {
    if (!/^asset-cloud-[a-f0-9]{64}$/.test(id)) throw Error("游戏素材地址无效");
    media.set(id, cloudMediaUrl(id));
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
  addEventListener("beforeunload", (event) => {
    if (!cloudSaving) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
