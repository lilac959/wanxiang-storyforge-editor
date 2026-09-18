const HASH = /^[a-f0-9]{64}$/;
const MIME =
  /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|wav|ogg))$/;
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
function sources(p) {
  return [
    p.loading?.image,
    p.loading?.video,
    p.splash?.video,
    ...p.nodes.flatMap((n) => [
      n.video,
      ...(n.frames || []).map((f) => f.image),
    ]),
  ].filter(Boolean);
}
export async function publishing(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  if (!env.PROJECT_STORE) return json({ error: "云端存储尚未连接" }, 503);
  const bucket = env.PROJECT_STORE;
  const asset = /^\/api\/media\/([a-f0-9]{64})$/.exec(path);
  const writing = !["GET", "HEAD"].includes(request.method);
  if (
    writing &&
    (env.GAME_ONLY === "true" ||
      !env.PUBLISH_TOKEN ||
      request.headers.get("Authorization") !== `Bearer ${env.PUBLISH_TOKEN}`)
  )
    return json({ error: "请先连接发布授权" }, 401);
  if (path === "/api/project" && request.method === "GET") {
    const object = await bucket.get("published/project.json");
    if (!object) return json({ error: "作品尚未发布" }, 404);
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ETag: object.httpEtag,
      },
    });
  }
  if (asset && ["GET", "HEAD"].includes(request.method)) {
    const key = "media/" + asset[1],
      head = await bucket.head(key);
    if (!head) return json({ error: "素材不存在" }, 404);
    const headers = new Headers({
      "Content-Type":
        head.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: head.httpEtag,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    });
    let start = 0,
      end = head.size - 1,
      status = 200;
    const range = request.headers.get("Range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${head.size}` },
        });
      if (!m[1]) start = Math.max(0, head.size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2]) end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= head.size)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${head.size}` },
        });
      status = 206;
      headers.set("Content-Range", `bytes ${start}-${end}/${head.size}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    if (request.method === "HEAD")
      return new Response(null, { status, headers });
    const object = await bucket.get(key, {
      range: { offset: start, length: end - start + 1 },
    });
    return new Response(object.body, { status, headers });
  }
  if (asset && request.method === "PUT") {
    const type = request.headers.get("Content-Type")?.split(";")[0],
      size = Number(request.headers.get("Content-Length"));
    if (
      !MIME.test(type || "") ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > 95 * 1024 * 1024
    )
      return json({ error: "素材类型不支持或超过 95 MB" }, 400);
    if (await bucket.head("media/" + asset[1])) return json({ ok: true });
    // Stream videos to storage; R2 verifies the checksum without buffering a video in Worker memory.
    try {
      await bucket.put("media/" + asset[1], request.body, {
        sha256: Uint8Array.from(asset[1].match(/../g), (x) => parseInt(x, 16))
          .buffer,
        httpMetadata: { contentType: type },
      });
    } catch {
      return json({ error: "素材上传或校验失败，请重试" }, 400);
    }
    return json({ ok: true });
  }
  if (path === "/api/publish" && request.method === "POST") {
    const body = await request.text();
    if (body.length > 2 * 1024 * 1024) return json({ error: "配置过大" }, 413);
    let p;
    try {
      p = JSON.parse(body);
    } catch {
      return json({ error: "配置格式错误" }, 400);
    }
    if (
      p?.version !== 1 ||
      !Array.isArray(p.nodes) ||
      !p.nodes.length ||
      p.nodes.length > 100 ||
      !p.loading ||
      !p.splash
    )
      return json({ error: "无效项目" }, 400);
    let ids;
    try {
      ids = [...new Set(sources(p))];
    } catch {
      return json({ error: "无效素材列表" }, 400);
    }
    for (const id of ids) {
      const hash = typeof id === "string" && id.replace(/^asset-cloud-/, "");
      if (
        typeof id !== "string" ||
        !id.startsWith("asset-cloud-") ||
        !HASH.test(hash) ||
        !(await bucket.head("media/" + hash))
      )
        return json({ error: "有素材尚未上传完成" }, 400);
    }
    const match = request.headers.get("If-Match");
    if (!match) return json({ error: "缺少版本条件，请重新保存" }, 428);
    const envelope = {
      version: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      project: p,
    };
    const result = await bucket.put(
      "published/project.json",
      JSON.stringify(envelope),
      {
        httpMetadata: { contentType: "application/json" },
        onlyIf:
          match === "none"
            ? { etagDoesNotMatch: "*" }
            : { etagMatches: match.replaceAll('"', "") },
      },
    );
    if (!result)
      return json({ error: "其他窗口已更新作品，请重新检查后保存" }, 409);
    return json({
      ok: true,
      version: envelope.version,
      updatedAt: envelope.updatedAt,
    });
  }
  return json({ error: "接口不存在" }, 404);
}
