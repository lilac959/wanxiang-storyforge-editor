// Locally synthesized cues: no remote downloads or copyrighted samples.
export function createQteAudio({ listen = true } = {}) {
  let context = null,
    bus = null,
    heartbeat = null,
    current = null,
    voices = new Set(),
    lastProgress = 0;
  function unlock() {
    try {
      if (!context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
        bus = context.createGain();
        bus.connect(context.destination);
      }
      if (context.state !== "running") return context.resume().catch(() => {});
      return Promise.resolve();
    } catch {}
  }
  function tone(
    frequency,
    end,
    duration,
    volume = 0.2,
    delay = 0,
    type = "sine",
  ) {
    if (!context || context.state !== "running" || !current) return;
    const osc = context.createOscillator(),
      gain = context.createGain(),
      at = context.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, end),
      at + duration,
    );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume),
      at + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(bus);
    voices.add(osc);
    osc.onended = () => {
      voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }
  function stop() {
    clearTimeout(heartbeat);
    heartbeat = null;
    for (const osc of voices) {
      try {
        osc.stop();
      } catch {}
    }
    voices.clear();
    current = null;
  }
  function start(n) {
    stop();
    if (n.qteSound === "off") return;
    const ready = unlock();
    current = { began: performance.now(), limit: Number(n.limit) || 4 };
    lastProgress = 0;
    if (bus)
      bus.gain.value = Math.max(0, Math.min(1, Number(n.qteVolume ?? 0.35)));
    function beat() {
      if (!current) return;
      const urgency = Math.min(
        1,
        (performance.now() - current.began) / (current.limit * 1000),
      );
      tone(110, 55, 0.2, 0.6);
      tone(180, 85, 0.14, 0.22, 0, "triangle");
      tone(90, 48, 0.16, 0.42, 0.2);
      tone(150, 75, 0.12, 0.15, 0.2, "triangle");
      heartbeat = setTimeout(beat, 900 - urgency * 440);
    }
    const started = current;
    Promise.resolve(ready).then(() => {
      if (current === started) beat();
    });
  }
  function input(kind) {
    if (kind === "hold") tone(150, 260, 0.18, 0.09);
    else tone(600, 180, 0.06, 0.11, 0, "triangle");
  }
  function progress(value) {
    if (value >= lastProgress + 0.25) {
      lastProgress = value;
      tone(260 + value * 120, 300 + value * 120, 0.07, 0.055);
    }
    if (value === 0) lastProgress = 0;
  }
  function result(ok) {
    clearTimeout(heartbeat);
    heartbeat = null;
    if (ok) {
      tone(420, 620, 0.13, 0.14, 0, "triangle");
      tone(720, 900, 0.17, 0.1, 0.08);
    } else tone(150, 36, 0.24, 0.2);
  }
  if (listen && typeof document !== "undefined") {
    for (const event of ["pointerdown", "pointerup", "click", "keydown"])
      document.addEventListener(event, unlock, { capture: true });
  }
  function dispose() {
    stop();
    if (listen && typeof document !== "undefined")
      for (const event of ["pointerdown", "pointerup", "click", "keydown"])
        document.removeEventListener(event, unlock, { capture: true });
    context?.close?.().catch(() => {});
  }
  return { start, stop, input, progress, result, unlock, dispose };
}
export const qteAudio = createQteAudio();
