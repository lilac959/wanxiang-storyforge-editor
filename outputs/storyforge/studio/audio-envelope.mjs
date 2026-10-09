export function audioVolume(clip, timeMs) {
  const length = Math.max(0, clip.endMs - clip.startMs);
  const elapsed = Math.max(0, timeMs - clip.startMs);
  const remaining = Math.max(0, clip.endMs - timeMs);
  const fadeIn = Math.min(length, Math.max(0, Number(clip.fadeInMs) || 0));
  const fadeOut = Math.min(length, Math.max(0, Number(clip.fadeOutMs) || 0));
  return (
    Math.max(0, Math.min(1, Number(clip.volume ?? 1))) *
    Math.min(
      1,
      fadeIn ? elapsed / fadeIn : 1,
      fadeOut ? remaining / fadeOut : 1,
    )
  );
}
