import { clone, references, migrate, validate, uid } from "./model.mjs";
import { SaveQueue } from "./history.mjs";
import { inspect } from "./assets.mjs";
export const LOCAL_KEY = "storyforge-v2-draft";
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export async function response(r) {
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw Object.assign(Error(b.error || `服务暂不可用（${r.status}）`), {
      status: r.status,
    });
  }
  return r.json();
}
export class Storage {
  constructor(assets, status = () => {}) {
    this.assets = assets;
    this.status = status;
    this.token =
      sessionStorage.getItem("storyforge-publish-token") ||
      localStorage.getItem("storyforge-publish-token") ||
      "";
    this.queue = new SaveQueue(
      (p, rev) => this.writeCloud(p, rev),
      (state, detail) => {
        if (state === "saved") {
          const saved = this.readLocal();
          if (saved?.project?.id === detail.projectId) {
            saved.revision = this.queue.revision;
            this.setLocal(saved);
            const catalog = JSON.parse(
              localStorage.getItem("storyforge-projects") || "{}",
            );
            if (catalog[detail.projectId]) {
              catalog[detail.projectId].revision = this.queue.revision;
              localStorage.setItem(
                "storyforge-projects",
                JSON.stringify(catalog),
              );
            }
          }
        }
        this.status(state, detail);
      },
    );
    this.uploading = new Map();
  }
  setToken(token) {
    this.token = token.trim();
    localStorage.setItem("storyforge-publish-token", this.token);
    sessionStorage.removeItem("storyforge-publish-token");
  }
  headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }
  async playerUrl() {
    try {
      const config = await response(
        await fetch("/api/site", {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        }),
      );
      const url = new URL(config.playerUrl, location.origin);
      if (["https:", "http:"].includes(url.protocol)) return url.href;
    } catch {}
    return new URL("/game", location.origin).href;
  }
  readLocal() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY));
    } catch {
      return null;
    }
  }
  setLocal(envelope) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(envelope));
    } catch {
      throw Error("本机空间不足，请立即导出备份");
    }
  }
  saveLocal(project) {
    const saved = this.readLocal();
    this.setLocal({
      project: clone(project),
      revision: this.queue.revision,
      updatedAt: new Date().toISOString(),
      origin: saved?.origin || "local",
    });
    const catalog = JSON.parse(
      localStorage.getItem("storyforge-projects") || "{}",
    );
    if (!catalog[project.id]?.deleted) {
      catalog[project.id] = {
        project: clone(project),
        revision: this.queue.revision,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem("storyforge-projects", JSON.stringify(catalog));
    }
    this.status("local");
  }
  backup(project, label = "导入前") {
    const key = `storyforge-v2-backup-${Date.now()}`;
    localStorage.setItem(
      key,
      JSON.stringify({ project, label, updatedAt: new Date().toISOString() }),
    );
    return key;
  }
  backups() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith("storyforge-v2-backup-"))
      .map((key) => {
        try {
          return { key, ...JSON.parse(localStorage.getItem(key)) };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async draft(id) {
    return response(
      await fetch(`/api/v2/draft?id=${encodeURIComponent(id)}`, {
        headers: this.headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    );
  }
  async published(version = "", projectId = "") {
    return response(
      await fetch(
        version
          ? `/api/v2/release/${encodeURIComponent(version)}`
          : "/api/v2/published" +
              (projectId ? "?id=" + encodeURIComponent(projectId) : ""),
        { cache: "no-store", signal: AbortSignal.timeout(20000) },
      ),
    );
  }
  async legacy() {
    return response(
      await fetch("/api/project", {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      }),
    );
  }
  async writeCloud(project, revision) {
    const p = await this.prepare(project, true);
    return {
      ...(await response(
        await fetch("/api/v2/draft", {
          method: "PUT",
          headers: this.headers({
            "Content-Type": "application/json",
            "If-Match": revision,
          }),
          body: JSON.stringify({ project: p }),
          signal: AbortSignal.timeout(30000),
        }),
      )),
      projectId: p.id,
    };
  }
  async prepare(project, all = false) {
    const p = clone(project);
    for (const id of all ? Object.keys(p.assets) : references(p)) {
      const a = p.assets[id];
      if (/^\/api\/media\/[a-f0-9]{64}$/.test(a.source)) continue;
      const source = await this.upload(a);
      a.source = source;
    }
    return p;
  }
  async upload(asset) {
    const key = asset.id + "|" + asset.source;
    if (this.uploading.has(key)) return this.uploading.get(key);
    const promise = this.doUpload(asset).catch((e) => {
      this.uploading.delete(key);
      throw e;
    });
    this.uploading.set(key, promise);
    return promise;
  }
  async doUpload(a) {
    this.status("upload", { name: a.name, progress: 0 });
    const blob = await this.assets.file(a);
    if (blob.size > 1024 * 1024 * 1024) throw Error("单个素材超过 1 GB");
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const url = "/api/media/" + hash;
    const check = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(30000),
    });
    if (!check.ok) {
      if (check.status !== 404) await response(check);
      const chunkSize = 20 * 1024 * 1024,
        parts = Math.ceil(blob.size / chunkSize),
        partSizes = [];
      for (let part = 0; part < parts; part++) {
        const chunk = blob.slice(part * chunkSize, (part + 1) * chunkSize);
        partSizes.push(chunk.size);
        await this.retry(async () =>
          response(
            await fetch(`${url}/part/${part}`, {
              method: "PUT",
              headers: this.headers({
                "Content-Type": "application/octet-stream",
                "X-Total-Parts": String(parts),
              }),
              body: chunk,
              signal: AbortSignal.timeout(180000),
            }),
          ),
        );
        this.status("upload", {
          name: a.name,
          progress: Math.round(((part + 1) / parts) * 100),
        });
      }
      await this.retry(
        async () =>
          response(
            await fetch(url, {
              method: "POST",
              headers: this.headers({ "Content-Type": "application/json" }),
              body: JSON.stringify({
                type: a.mime,
                size: blob.size,
                parts,
                partSizes,
              }),
              signal: AbortSignal.timeout(30000),
            }),
          ),
        true,
      );
    }
    return url;
  }
  async retry(fn, consistency = false) {
    for (let i = 0; i < 5; i++) {
      try {
        return await fn();
      } catch (e) {
        if (
          i === 4 ||
          (!consistency &&
            e.status &&
            ![429, 500, 502, 503, 504].includes(e.status)) ||
          (consistency &&
            e.status &&
            ![400, 429, 500, 502, 503, 504].includes(e.status))
        )
          throw e;
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
  }
  async publish(project) {
    const issues = validate(project, { publish: true });
    if (issues.some((x) => x.level === "error"))
      throw Error(
        issues
          .filter((x) => x.level === "error")
          .map((x) => x.message)
          .join("；"),
      );
    for (const id of references(project)) {
      const a = project.assets[id];
      this.status("upload", { name: "检查 " + a.name, progress: 0 });
      await inspect(await this.assets.url(a), a.kind);
    }
    const p = await this.prepare(project);
    let version = "none";
    try {
      version = (await this.published("", p.id)).version;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    return response(
      await fetch("/api/v2/publish?id=" + encodeURIComponent(p.id), {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          "If-Match": version,
        }),
        body: JSON.stringify({ project: p }),
        signal: AbortSignal.timeout(60000),
      }),
    );
  }
  async versions(projectId = "") {
    return response(
      await fetch(
        "/api/v2/versions" +
          (projectId ? "?id=" + encodeURIComponent(projectId) : ""),
        {
          headers: this.headers(),
          cache: "no-store",
        },
      ),
    );
  }
  async restore(version, projectId = "") {
    const latest = await this.published("", projectId);
    return response(
      await fetch(
        "/api/v2/restore" +
          (projectId ? "?id=" + encodeURIComponent(projectId) : ""),
        {
          method: "POST",
          headers: this.headers({
            "Content-Type": "application/json",
            "If-Match": latest.version,
          }),
          body: JSON.stringify({ version }),
        },
      ),
    );
  }
}

export async function exportZip(project, assets) {
  const p = clone(project),
    manifest = {},
    files = [];
  for (const id of Object.keys(p.assets)) {
    const a = p.assets[id],
      blob = await assets.file(a),
      name = a.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
    const path = `assets/${Object.keys(manifest).length + 1}_${name}`;
    manifest[id] = { path, name: a.name, type: a.mime };
    files.push({ name: path, blob });
  }
  files.unshift(
    {
      name: "project.storyforge.json",
      blob: new Blob([JSON.stringify(p, null, 2)]),
    },
    {
      name: "assets.json",
      blob: new Blob([JSON.stringify(manifest, null, 2)]),
    },
    {
      name: "使用说明.txt",
      blob: new Blob([
        "在故事引擎 TaleSpark编辑器选择“导入项目”，导入整个 ZIP。素材保持原始字节；无需解压。",
      ]),
    },
  );
  return globalThis.createProjectZip(files);
}
export async function importZip(file, assets) {
  let raw,
    manifest = {},
    entries;
  if (/\.zip$/i.test(file.name)) {
    entries = await globalThis.readProjectZip(file);
    raw = JSON.parse(await entries.get("project.storyforge.json").text());
    manifest = JSON.parse(await entries.get("assets.json").text());
  } else raw = JSON.parse(await file.text());
  const p = migrate(raw);
  const structural = validate(p).filter((x) => x.level === "error");
  if (structural.length) throw Error(structural[0].message);
  // Fresh local identities protect current media from interrupted imports.
  for (const id of Object.keys(p.assets)) {
    let blob,
      name = p.assets[id].name;
    if (entries) {
      const item = manifest[id];
      if (!item || !entries.has(item.path))
        throw Error(`项目包缺少素材：${name}`);
      blob = new File([entries.get(item.path)], item.name || name, {
        type: item.type,
      });
    } else if (raw.assets?.[id] && typeof raw.assets[id] === "string") {
      const r = await fetch(raw.assets[id]);
      blob = new File([await r.blob()], name, {
        type: r.headers.get("Content-Type"),
      });
    }
    if (blob) {
      const a = await assets.import(blob);
      p.assets[id] = { ...a, id, source: a.id };
    }
  }
  p.id = uid("project");
  return { project: p, original: raw };
}
