// Local adapter: persistent files, range requests and production publish rules.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "../outputs/storyforge"),
  data = path.resolve(
    process.env.STORYFORGE_DATA || path.join(__dirname, "local-data"),
  );
fs.mkdirSync(data, { recursive: true });
const token = process.env.PUBLISH_TOKEN || "local-development-only";
class Files {
  constructor(folder) {
    this.folder = path.join(data, folder);
    fs.mkdirSync(this.folder, { recursive: true });
  }
  file(key) {
    return path.join(this.folder, Buffer.from(key).toString("hex"));
  }
  async get(key, type) {
    let b;
    try {
      b = await fs.promises.readFile(this.file(key));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    if (type === "json") return JSON.parse(b);
    if (type === "arrayBuffer")
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    if (type === "stream") return new Response(b).body;
    return b.toString();
  }
  async put(key, value) {
    const b =
      value instanceof ReadableStream
        ? Buffer.from(await new Response(value).arrayBuffer())
        : Buffer.from(value);
    const dest = this.file(key),
      tmp = dest + "." + crypto.randomUUID() + ".tmp";
    await fs.promises.writeFile(tmp, b);
    await fs.promises.rename(tmp, dest);
  }
}
(async () => {
  const { publishing } = await import("../outputs/cloudflare/publishing.mjs");
  const { Projects } = await import("../outputs/cloudflare/projects.mjs");
  const media = new Files("media"),
    metadata = new Files("projects");
  const service = new Projects(metadata, async (hash) => {
    const m = await media.get(`media/${hash}/meta`, "json");
    if (!m) return false;
    for (let i = 0; i < m.parts; i++)
      if (!fs.existsSync(media.file(`media/${hash}/part/${i}`))) return false;
    return true;
  });
  let queue = Promise.resolve();
  http
    .createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
          const body = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 21 * 1024 * 1024) {
              res.writeHead(413);
              res.end();
              return;
            }
            body.push(chunk);
          }
          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            ...(!["GET", "HEAD"].includes(req.method)
              ? { body: Buffer.concat(body) }
              : {}),
          });
          let result;
          if (url.pathname.startsWith("/api/v2/")) {
            const task = queue.then(() => service.fetch(request, { token }));
            queue = task.catch(() => {});
            result = await task;
          } else
            result = await publishing(request, {
              PROJECT_STORE: media,
              PUBLISH_TOKEN: token,
            });
          if (!result) result = new Response("Not found", { status: 404 });
          res.writeHead(result.status, Object.fromEntries(result.headers));
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          if (result.body) {
            for await (const chunk of result.body) res.write(chunk);
          }
          res.end();
          return;
        }
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === "/") pathname = "/index.html";
        if (pathname === "/game" || pathname === "/game/")
          pathname = "/game.html";
        const file = path.resolve(root, "." + pathname);
        if (!file.startsWith(root + path.sep)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) {
          res.writeHead(404);
          res.end();
          return;
        }
        const types = {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".webp": "image/webp",
          ".mp4": "video/mp4",
          ".wav": "audio/wav",
          ".svg": "image/svg+xml",
        };
        let start = 0,
          end = stat.size - 1,
          status = 200;
        if (req.headers.range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!m || (!m[1] && !m[2])) {
            res.writeHead(416);
            res.end();
            return;
          }
          if (m[1]) {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          } else start = Math.max(0, stat.size - Number(m[2]));
          if (start > end || start >= stat.size) {
            res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
            res.end();
            return;
          }
          status = 206;
        }
        const headers = {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-cache",
        };
        if (status === 206)
          headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        res.writeHead(status, headers);
        if (req.method === "HEAD") res.end();
        else fs.createReadStream(file, { start, end }).pipe(res);
      } catch (error) {
        if (!res.headersSent)
          res.writeHead(error.code === "ENOENT" ? 404 : 500);
        res.end("Request failed");
      }
    })
    .listen(Number(process.env.PORT) || 4173, "127.0.0.1", () =>
      console.log(
        "StoryForge: http://127.0.0.1:" +
          (process.env.PORT || 4173) +
          " | Local authorization: " +
          (process.env.PUBLISH_TOKEN
            ? "configured via environment"
            : "local-development-only"),
      ),
    );
})();
