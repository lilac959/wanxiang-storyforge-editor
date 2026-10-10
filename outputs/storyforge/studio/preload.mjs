import { references, openingCard, resolveOpeningDuration } from "./model.mjs";
import { inspect } from "./assets.mjs";
export const UI_IMAGES = [
  {
    id: "builtin-qte-frame",
    variable: "--qte-frame",
    file: "qte-original-frame.png",
    kind: "qte",
  },
  {
    id: "builtin-choice-triangle",
    variable: "--choice-triangle",
    file: "option-triangle.png",
    kind: "choice",
  },
  {
    id: "builtin-choice-circle",
    variable: "--choice-circle",
    file: "option-circle.png",
    kind: "choice",
  },
].map((a) => ({
  ...a,
  eventKind: a.kind,
  kind: "image",
  source: `assets/ui/${a.file}`,
  name: a.file,
  mime: "image/png",
  size: 0,
}));

export function resourceList(project) {
  const loading = openingCard(project, "loading");
  const priority = [
    loading?.opening?.image,
    ...(loading?.clips || []).map((c) => c.assetId),
  ];
  const seen = new Set();
  const assets = [...priority, ...references(project)]
    .filter(Boolean)
    .map((id) => {
      const asset = project.assets[id];
      if (!asset) throw Error("作品引用的素材缺失");
      return asset;
    });
  const kinds = new Set(
    project.scenes.flatMap((s) => (s.events || []).map((e) => e.kind)),
  );
  return [...assets, ...UI_IMAGES.filter((a) => kinds.has(a.eventKind))].filter(
    (asset) => {
      if (seen.has(asset.source)) return false;
      seen.add(asset.source);
      return true;
    },
  );
}

async function pool(items, operation, signal, concurrency = 3) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        signal.throwIfAborted();
        await operation(items[index++]);
      }
    }),
  );
}

// Completion means every referenced file is present locally, not loadedmetadata.
export async function preloadProject(
  project,
  store,
  {
    signal = new AbortController().signal,
    onProgress = () => {},
    onReady = async () => {},
    fetcher = fetch,
    inspectAsset = inspect,
  } = {},
) {
  const entries = resourceList(project).map((asset) => ({
    asset,
    bytes: 0,
    size: 0,
    ready: false,
  }));
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const report = () => {
    const total = entries.reduce((n, e) => n + e.size, 0);
    const loaded = entries.reduce((n, e) => n + e.bytes, 0);
    const ready = entries.filter((e) => e.ready).length;
    onProgress({
      loaded,
      total,
      ready,
      count: entries.length,
      percent:
        ready === entries.length
          ? 100
          : total
            ? Math.min(99, Math.floor((loaded / total) * 100))
            : 0,
    });
  };
  try {
    await pool(
      entries,
      async (e) => {
        e.blob = await store.cached(e.asset);
        if (e.blob) {
          e.size = e.blob.size;
          e.bytes = e.size;
        } else if (e.asset.size > 0) e.size = e.asset.size;
        else {
          const r = await fetcher(await store.url(e.asset), {
            method: "HEAD",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(20000),
            ]),
          });
          if (!r.ok) throw Error(`无法读取素材「${e.asset.name}」`);
          e.size = Number(r.headers.get("Content-Length")) || 0;
        }
      },
      controller.signal,
    );
    report();
    await pool(
      entries,
      async (e) => {
        try {
          if (!e.blob) {
            const r = await fetcher(await store.url(e.asset), {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(300000),
              ]),
            });
            if (!r.ok || !r.body) throw Error("下载失败");
            const expected = Number(r.headers.get("Content-Length")) || e.size;
            e.size = expected;
            const reader = r.body.getReader(),
              chunks = [];
            try {
              while (true) {
                controller.signal.throwIfAborted();
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                e.bytes += value.byteLength;
                report();
              }
            } finally {
              reader.releaseLock();
            }
            if (expected && e.bytes !== expected) throw Error("文件下载不完整");
            e.blob = new Blob(chunks, {
              type: e.asset.mime || r.headers.get("Content-Type"),
            });
            e.size = e.blob.size;
            await store.prepare(e.asset, e.blob);
          } else {
            // Register cached files without downloading them again.
            store.prepared.set(
              e.asset.source,
              e.asset.source.startsWith("asset-")
                ? e.asset.source
                : store.cacheKey(e.asset),
            );
          }
          const meta = await inspectAsset(
            await store.url(e.asset),
            e.asset.kind,
          );
          controller.signal.throwIfAborted();
          for (const asset of Object.values(project.assets).filter(
            (a) => a.source === e.asset.source,
          )) {
            if (meta.durationMs)
              resolveOpeningDuration(project, asset.id, meta.durationMs);
            Object.assign(asset, meta);
          }
          e.bytes = e.size;
          e.blob = null;
          await onReady(e.asset);
          e.ready = true;
          report();
        } catch (error) {
          if (controller.signal.aborted) throw error;
          throw Error(`素材「${e.asset.name}」加载失败：${error.message}`, {
            cause: error,
          });
        }
      },
      controller.signal,
    );
    report();
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
