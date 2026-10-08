import { uid } from "./model.mjs";
const maxSize = 1024 * 1024 * 1024;
export class AssetStore {
  constructor() {
    this.urls = new Map();
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open("storyforge-local", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("assets");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(Error("无法打开本机素材存储"));
    });
  }
  async blob(id) {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const r = db.transaction("assets").objectStore("assets").get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async put(id, blob) {
    const db = await this.db;
    await new Promise((resolve, reject) => {
      const tx = db.transaction("assets", "readwrite");
      tx.objectStore("assets").put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(Error("本机空间不足，素材未保存"));
      tx.onabort = () => reject(Error("素材保存中断"));
    });
    if (this.urls.has(id)) URL.revokeObjectURL(this.urls.get(id));
    this.urls.delete(id);
  }
  async url(asset) {
    if (!asset) throw Error("素材引用缺失");
    const key = asset.source;
    if (this.urls.has(key)) return this.urls.get(key);
    const blob = key.startsWith("asset-") ? await this.blob(key) : null;
    if (blob) {
      const url = URL.createObjectURL(blob);
      this.urls.set(key, url);
      return url;
    }
    if (/^(https?:\/\/|\/api\/media\/|assets\/)/.test(asset.source))
      return new URL(asset.source, location.href).href;
    throw Error(`找不到素材「${asset.name}」，请重新导入或替换`);
  }
  async file(asset) {
    const existing = asset.source.startsWith("asset-")
      ? await this.blob(asset.source)
      : null;
    if (existing) return existing;
    const r = await fetch(await this.url(asset), {
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw Error(`无法读取素材「${asset.name}」`);
    return r.blob();
  }
  async import(file) {
    if (!file.size || file.size > maxSize)
      throw Error("素材大小必须在 1 GB 以内");
    const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer()),
      ascii = String.fromCharCode(...bytes);
    let kind, mime;
    if (bytes[0] === 137 && ascii.slice(1, 4) === "PNG") {
      kind = "image";
      mime = "image/png";
    } else if (bytes[0] === 255 && bytes[1] === 216) {
      kind = "image";
      mime = "image/jpeg";
    } else if (ascii.startsWith("GIF8")) {
      kind = "image";
      mime = "image/gif";
    } else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
      kind = "image";
      mime = "image/webp";
    } else if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") {
      kind = "audio";
      mime = "audio/wav";
    } else if (ascii.slice(4, 8) === "ftyp") {
      kind = file.type.startsWith("audio/") ? "audio" : "video";
      mime = kind === "audio" ? "audio/mp4" : "video/mp4";
    } else if (
      bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3
    ) {
      kind = file.type.startsWith("audio/") ? "audio" : "video";
      mime = kind === "audio" ? "audio/webm" : "video/webm";
    } else if (ascii.startsWith("OggS")) {
      kind = file.type.startsWith("video/") ? "video" : "audio";
      mime = kind + "/ogg";
    } else if (
      ascii.startsWith("ID3") ||
      (bytes[0] === 255 && (bytes[1] & 224) === 224)
    ) {
      kind = "audio";
      mime = "audio/mpeg";
    } else throw Error(`「${file.name}」不是支持的图片、视频或音频文件`);
    const blob = new Blob([file], { type: mime }),
      url = URL.createObjectURL(blob);
    let meta;
    try {
      meta = await inspect(url, kind);
    } finally {
      URL.revokeObjectURL(url);
    }
    const id = uid("asset");
    await this.put(id, blob);
    return {
      id,
      name: file.name,
      source: id,
      kind,
      mime,
      size: file.size,
      ...meta,
    };
  }
  dispose() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}
export async function inspect(url, kind) {
  return new Promise((resolve, reject) => {
    const el = kind === "image" ? new Image() : document.createElement(kind);
    let timeout;
    const cleanup = () => {
      clearTimeout(timeout);
      el.onload = null;
      el.onloadedmetadata = null;
      el.onerror = null;
      if (kind !== "image") {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
    };
    const fail = () => {
      cleanup();
      reject(
        Error(
          "浏览器无法解码这个素材，请使用支持的 PNG/JPEG/WebP/GIF、MP4(H.264/AAC)、WebM 或音频格式",
        ),
      );
    };
    const ok = () => {
      const meta =
        kind === "image"
          ? { width: el.naturalWidth, height: el.naturalHeight }
          : {
              durationMs: Math.round(el.duration * 1000),
              width: el.videoWidth || 0,
              height: el.videoHeight || 0,
            };
      if (
        kind !== "image" &&
        (!Number.isFinite(meta.durationMs) || meta.durationMs < 1)
      ) {
        fail();
        return;
      }
      cleanup();
      resolve(meta);
    };
    timeout = setTimeout(fail, 30000);
    el.onerror = fail;
    if (kind === "image") el.onload = ok;
    else {
      el.preload = "metadata";
      el.onloadedmetadata = ok;
    }
    el.src = url;
  });
}
