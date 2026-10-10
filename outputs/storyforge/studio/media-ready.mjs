import { visualClips, clipLength } from "./timeline.mjs";

export function nativeOpeningLoop(scene, clip, videoDuration) {
  return (
    ["loading", "splash"].includes(scene.role) &&
    scene.opening?.loop &&
    visualClips(scene).length === 1 &&
    clip?.kind === "video" &&
    clip.startMs === 0 &&
    clip.inMs === 0 &&
    Math.abs(clip.outMs - videoDuration * 1000) <= 1 &&
    clipLength(clip) >= 100
  );
}

export function firstVideoFrame(video, signal) {
  signal?.throwIfAborted();
  if (video.readyState >= 2 && !video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      for (const name of ["loadeddata", "canplay", "seeked"])
        video.removeEventListener(name, ready);
      video.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
    };
    const ready = () => {
      if (video.readyState < 2 || video.seeking) return;
      clean();
      resolve();
    };
    const fail = () => {
      clean();
      reject(Error("视频首帧无法读取，请重试"));
    };
    const abort = () => {
      clean();
      reject(signal.reason);
    };
    const timer = setTimeout(fail, 30000);
    for (const name of ["loadeddata", "canplay", "seeked"])
      video.addEventListener(name, ready);
    video.addEventListener("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    ready();
  });
}
