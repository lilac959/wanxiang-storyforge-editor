const HASH = /^[a-f0-9]{64}$/;
const MIME =
  /^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime|ogg)|audio\/(mpeg|wav|ogg))$/;
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const sources = (p) =>
  [
    p.loading?.image,
    p.loading?.video,
    p.splash?.video,
    ...p.nodes.flatMap((n) => [
      n.video,
      ...(n.frames || []).map((f) => f.image),
    ]),
  ].filter(Boolean);
const mediaKey = (hash) => `media/${hash}`;
async function metadata(store, hash) {
  const data = await store.get(mediaKey(hash) + "/meta", "json");
  return data && data.hash === hash ? data : null;
}
function authorized(request, env) {
  return (
    env.GAME_ONLY !== "true" &&
    env.PUBLISH_TOKEN &&
    request.headers.get("Authorization") === `Bearer ${env.PUBLISH_TOKEN}`
  );
}
export async function publishing(request, env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  const store = env.PROJECT_STORE;
  if (!store) return json({ error: "云端存储尚未连接" }, 503);
  const writing = !["GET", "HEAD"].includes(request.method);
  if (writing && !authorized(request, env))
    return json({ error: "请先连接发布授权" }, 401);
  if (path === "/api/project" && request.method === "GET") {
    const value = await store.get("published/project.json");
    if (!value) return json({ error: "作品尚未发布" }, 404);
    const etag = await textEtag(value);
    return new Response(value, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ETag: etag,
      },
    });
  }
  const base = /^\/api\/media\/([a-f0-9]{64})$/.exec(path);
  if (base && request.method === "HEAD")
    return (await metadata(store, base[1]))
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 404 });
  if (base && request.method === "GET")
    return serveMedia(request, store, base[1]);
  const part = /^\/api\/media\/([a-f0-9]{64})\/part\/(\d+)$/.exec(path);
  if (part && request.method === "PUT") {
    const hash = part[1],
      index = Number(part[2]),
      total = Number(request.headers.get("X-Total-Parts")),
      size = Number(request.headers.get("Content-Length"));
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= total ||
      !Number.isInteger(total) ||
      total < 1 ||
      total > 100 ||
      !Number.isFinite(size) ||
      size < 1 ||
      size > 20 * 1024 * 1024
    )
      return json({ error: "素材分块无效" }, 400);
    await store.put(`${mediaKey(hash)}/part/${index}`, request.body, {
      expirationTtl: 86400,
    });
    return json({ ok: true });
  }
  if (base && request.method === "POST") {
    const hash = base[1],
      body = await request.json().catch(() => null),
      type = body?.type,
      total = body?.parts,
      size = body?.size,
      partSizes = body?.partSizes;
    if (
      !MIME.test(type || "") ||
      !Number.isInteger(total) ||
      total < 1 ||
      total > 100 ||
      !Number.isFinite(size) ||
      size < 1 ||
      size > 1024 * 1024 * 1024 ||
      !Array.isArray(partSizes) ||
      partSizes.length !== total ||
      partSizes.reduce((a, b) => a + b, 0) !== size
    )
      return json({ error: "素材信息无效" }, 400);
    for (let i = 0; i < total; i++)
      if (!(await store.get(`${mediaKey(hash)}/part/${i}`, { type: "stream" })))
        return json({ error: `素材第 ${i + 1} 块尚未上传` }, 400);
    await store.put(
      mediaKey(hash) + "/meta",
      JSON.stringify({ hash, type, size, parts: total, partSizes }),
    );
    return json({ ok: true });
  }
  if (path === "/api/publish" && request.method === "POST") {
    const text = await request.text();
    if (text.length > 2 * 1024 * 1024) return json({ error: "配置过大" }, 413);
    let p;
    try {
      p = JSON.parse(text);
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
        !(await metadata(store, hash))
      )
        return json({ error: "有素材尚未上传完成" }, 400);
    }
    const match = request.headers.get("If-Match");
    if (!match) return json({ error: "缺少版本条件，请重新保存" }, 428);
    const previous = await store.get("published/project.json");
    if (match === "none") {
      if (previous)
        return json({ error: "其他窗口已更新作品，请重新检查后保存" }, 409);
    } else if (!previous || (await textEtag(previous)) !== match)
      return json({ error: "其他窗口已更新作品，请重新检查后保存" }, 409);
    const envelope = {
      version: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      project: p,
    };
    await store.put("published/project.json", JSON.stringify(envelope));
    return json({
      ok: true,
      version: envelope.version,
      updatedAt: envelope.updatedAt,
    });
  }
  return json({ error: "接口不存在" }, 404);
}
async function textEtag(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return (
    '"' +
    Array.from(new Uint8Array(digest), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("") +
    '"'
  );
}
async function serveMedia(request, store, hash) {
  const meta = await metadata(store, hash);
  if (!meta) return json({ error: "素材不存在" }, 404);
  let start = 0,
    end = meta.size - 1,
    status = 200;
  const range = request.headers.get("Range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${meta.size}` },
      });
    if (!m[1]) start = Math.max(0, meta.size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= meta.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${meta.size}` },
      });
    status = 206;
  }
  const headers = new Headers({
    "Content-Type": meta.type,
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: `"${hash}"`,
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 206)
    headers.set("Content-Range", `bytes ${start}-${end}/${meta.size}`);
  let offset = 0,
    index = 0;
  const pieces = [];
  for (const size of meta.partSizes) {
    if (offset <= end && offset + size > start)
      pieces.push({
        index,
        from: Math.max(0, start - offset),
        to: Math.min(size - 1, end - offset),
      });
    offset += size;
    index++;
  }
  const body = new ReadableStream({
    async start(controller) {
      try {
        for (const p of pieces) {
          const value = await store.get(
            `${mediaKey(hash)}/part/${p.index}`,
            "arrayBuffer",
          );
          if (!value) throw Error("missing part");
          controller.enqueue(new Uint8Array(value, p.from, p.to - p.from + 1));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, { status, headers });
}
