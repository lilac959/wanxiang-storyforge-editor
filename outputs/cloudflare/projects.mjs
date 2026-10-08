import { validate, references } from "../storyforge/studio/model.mjs";
const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const safeId = (x) => typeof x === "string" && /^[\w-]{1,160}$/.test(x);
export async function revision(value) {
  return (
    '"' +
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("") +
    '"'
  );
}
export class Projects {
  constructor(storage, mediaExists) {
    this.storage = storage;
    this.mediaExists = mediaExists;
  }
  async json(key) {
    const value = await this.storage.get(key);
    return value ? JSON.parse(value) : null;
  }
  async fetch(request, { token, gameOnly = false }) {
    const url = new URL(request.url),
      path = url.pathname.replace("/api/v2", "");
    const publicRead =
      request.method === "GET" &&
      (path === "/published" || /^\/release\/[\w-]+$/.test(path));
    if (
      !publicRead &&
      (gameOnly ||
        !token ||
        request.headers.get("Authorization") !== `Bearer ${token}`)
    )
      return reply(
        { error: "请连接创作者授权；公开作品链接不能访问草稿" },
        401,
      );
    try {
      const projectId = url.searchParams.get("id");
      if (projectId && !safeId(projectId))
        return reply({ error: "作品编号无效" }, 400);
      const latestKey = projectId ? `latest/${projectId}` : "latest";
      if (publicRead) {
        const key =
          path === "/published"
            ? latestKey
            : `release/${path.split("/").pop()}`;
        let release = await this.json(key);
        if (!release && projectId && path === "/published") {
          const old = await this.json("latest");
          if (old?.projectId === projectId) release = old;
        }
        return release ? reply(release) : reply({ error: "作品尚未发布" }, 404);
      }
      if (path === "/versions" && request.method === "GET")
        return reply(
          ((await this.json("versions")) || []).filter(
            (x) => !projectId || x.projectId === projectId,
          ),
        );
      if (path === "/projects" && request.method === "GET")
        return reply((await this.json("projects")) || []);
      if (path === "/draft" && request.method === "GET") {
        const id = url.searchParams.get("id");
        if (!safeId(id)) return reply({ error: "作品编号无效" }, 400);
        const draft = await this.json(`draft/${id}`);
        return draft ? reply(draft) : reply({ error: "尚无云端草稿" }, 404);
      }
      if (!["PUT", "POST"].includes(request.method))
        return reply({ error: "接口不存在" }, 404);
      const raw = await request.text();
      if (raw.length > 4 * 1024 * 1024)
        return reply({ error: "项目数据超过 4 MB" }, 413);
      const body = JSON.parse(raw);
      if (path === "/archive") {
        if (!safeId(body.id) || typeof body.deleted !== "boolean")
          return reply({ error: "请求无效" }, 400);
        const index = (await this.json("projects")) || [],
          item = index.find((x) => x.id === body.id);
        if (!item) return reply({ error: "作品不存在" }, 404);
        item.deleted = body.deleted;
        await this.storage.put("projects", JSON.stringify(index));
        return reply({ ok: true });
      }
      if (path === "/restore") {
        if (!safeId(body.version)) return reply({ error: "版本编号无效" }, 400);
        const current = await this.json(latestKey);
        if ((current?.version || "none") !== request.headers.get("If-Match"))
          return reply({ error: "发布版本已改变，请刷新版本列表" }, 409);
        const release = await this.json(`release/${body.version}`);
        if (!release || (projectId && release.projectId !== projectId))
          return reply({ error: "版本不存在" }, 404);
        const issues = await this.checkMedia(release.project);
        if (issues) return reply({ error: issues }, 400);
        await this.storage.put(latestKey, JSON.stringify(release));
        await this.storage.put(
          `latest/${release.projectId}`,
          JSON.stringify(release),
        );
        if (projectId && (await this.json("latest"))?.projectId === projectId)
          await this.storage.put("latest", JSON.stringify(release));
        return reply({ ok: true, version: release.version });
      }
      if (!["/draft", "/publish"].includes(path))
        return reply({ error: "接口不存在" }, 404);
      const project = body.project;
      if (projectId && project?.id !== projectId)
        return reply({ error: "作品编号不匹配" }, 400);
      let issues;
      try {
        issues = validate(project, { publish: path === "/publish" });
      } catch {
        return reply({ error: "项目结构无效" }, 400);
      }
      if (issues.some((x) => x.level === "error"))
        return reply(
          {
            error: issues
              .filter((x) => x.level === "error")
              .map((x) => x.message)
              .join("；"),
            issues,
          },
          400,
        );
      if (path === "/draft") {
        const previous = await this.json(`draft/${project.id}`);
        if ((previous?.revision || "none") !== request.headers.get("If-Match"))
          return reply(
            {
              error:
                "另一设备已修改草稿。本机内容已保留，请先导出或打开云端副本",
            },
            409,
          );
        const encoded = JSON.stringify(project),
          rev = await revision(encoded),
          draft = {
            project,
            revision: rev,
            updatedAt: new Date().toISOString(),
          };
        const index = ((await this.json("projects")) || []).filter(
          (x) => x.id !== project.id,
        );
        index.unshift({
          id: project.id,
          name: project.name,
          updatedAt: draft.updatedAt,
        });
        await this.storage.put(`draft/${project.id}`, JSON.stringify(draft));
        await this.storage.put("projects", JSON.stringify(index));
        return reply({ revision: rev, updatedAt: draft.updatedAt });
      }
      let latest = await this.json(latestKey);
      if (!latest && projectId) {
        const old = await this.json("latest");
        if (old?.projectId === projectId) latest = old;
      }
      if ((latest?.version || "none") !== request.headers.get("If-Match"))
        return reply(
          { error: "另一窗口已发布新版，请检查版本列表后重试" },
          409,
        );
      const mediaError = await this.checkMedia(project);
      if (mediaError) return reply({ error: mediaError }, 400);
      const snapshot = structuredClone(project);
      snapshot.editor = { positions: {} };
      snapshot.assets = Object.fromEntries(
        references(snapshot).map((id) => [id, snapshot.assets[id]]),
      );
      const release = {
        version: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
        name: project.name,
        projectId: project.id,
        project: snapshot,
      };
      const list = (await this.json("versions")) || [];
      list.unshift({
        version: release.version,
        updatedAt: release.updatedAt,
        name: release.name,
        projectId: project.id,
      });
      await this.storage.put(
        `release/${release.version}`,
        JSON.stringify(release),
      );
      await this.storage.put("versions", JSON.stringify(list));
      // The pointer is changed only after all immutable data is durable.
      await this.storage.put(latestKey, JSON.stringify(release));
      await this.storage.put(`latest/${project.id}`, JSON.stringify(release));
      if (
        projectId &&
        ((await this.json("latest"))?.projectId === project.id ||
          project.id === "legacy-wanxiang")
      )
        await this.storage.put("latest", JSON.stringify(release));
      return reply({
        version: release.version,
        updatedAt: release.updatedAt,
        issues,
      });
    } catch (error) {
      return reply(
        {
          error:
            error instanceof SyntaxError
              ? "请求格式无效"
              : "保存未完成，请重试",
        },
        error instanceof SyntaxError ? 400 : 500,
      );
    }
  }
  async checkMedia(p) {
    for (const id of references(p)) {
      const a = p.assets[id],
        match = /^\/api\/media\/([a-f0-9]{64})$/.exec(a.source);
      if (!match || !(await this.mediaExists(match[1])))
        return `素材「${a.name}」尚未完整上传`;
    }
    return null;
  }
}

export class ProjectCoordinator {
  constructor(ctx, env) {
    this.queue = Promise.resolve();
    this.service = new Projects(ctx.storage, async (hash) => {
      const meta = await env.PROJECT_STORE?.get(`media/${hash}/meta`, "json");
      if (!meta) return false;
      for (let i = 0; i < meta.parts; i++) {
        const stream = await env.PROJECT_STORE.get(
          `media/${hash}/part/${i}`,
          "stream",
        );
        if (!stream) return false;
        await stream.cancel();
      }
      return true;
    });
    this.env = env;
  }
  fetch(request) {
    const task = this.queue.then(() =>
      this.service.fetch(request, {
        token: this.env.PUBLISH_TOKEN,
        gameOnly: request.headers.get("X-Storyforge-Game") === "true",
      }),
    );
    this.queue = task.catch(() => {});
    return task;
  }
}
