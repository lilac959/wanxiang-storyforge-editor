const thumbnails = new Map(),
  waveforms = new Map();

export function timelineThumbnail(url, kind) {
  if (kind === "image") return Promise.resolve(url);
  if (!thumbnails.has(url))
    thumbnails.set(
      url,
      new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.preload = "metadata";
        const timer = setTimeout(
          () => finish(new Error("Thumbnail unavailable")),
          10000,
        );
        function finish(error, result) {
          clearTimeout(timer);
          video.onloadeddata = video.onseeked = video.onerror = null;
          video.removeAttribute("src");
          video.load();
          error ? reject(error) : resolve(result);
        }
        const capture = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 160;
            canvas.height = Math.round(
              (160 * video.videoHeight) / video.videoWidth,
            );
            canvas
              .getContext("2d")
              .drawImage(video, 0, 0, canvas.width, canvas.height);
            finish(null, canvas.toDataURL("image/jpeg", 0.65));
          } catch (error) {
            finish(error);
          }
        };
        video.onloadeddata = () => {
          video.onloadeddata = null;
          if (Number.isFinite(video.duration) && video.duration > 0.2) {
            video.onseeked = capture;
            video.currentTime = Math.min(0.2, video.duration / 2);
          } else capture();
        };
        video.onerror = () => finish(new Error("Thumbnail unavailable"));
        video.src = url;
      }),
    );
  return thumbnails.get(url);
}

export async function audioWaveform(url, inMs, lengthMs) {
  if (!waveforms.has(url))
    waveforms.set(
      url,
      (async () => {
        const context = new AudioContext();
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok) throw Error("Audio unavailable");
          return await context.decodeAudioData(await response.arrayBuffer());
        } finally {
          await context.close();
        }
      })(),
    );
  const buffer = await waveforms.get(url),
    data = buffer.getChannelData(0);
  const start = Math.max(0, Math.floor((inMs * buffer.sampleRate) / 1000));
  const end = Math.min(
    data.length,
    start + Math.floor((lengthMs * buffer.sampleRate) / 1000),
  );
  if (end <= start) return null;
  const width = 200,
    bars = [];
  for (let i = 0; i < width; i++) {
    const a = Math.floor(start + ((end - start) * i) / width),
      b = Math.floor(start + ((end - start) * (i + 1)) / width);
    let peak = 0;
    for (let j = a; j < b; j += Math.max(1, Math.floor((b - a) / 40)))
      peak = Math.max(peak, Math.abs(data[j]));
    const height = Math.max(1, peak * 24);
    bars.push(`<path d="M${i} ${15 - height / 2}v${height}"/>`);
  }
  return (
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="30" viewBox="0 0 200 30"><g stroke="#5994c9" stroke-width=".8">${bars.join("")}</g></svg>`,
    )
  );
}
