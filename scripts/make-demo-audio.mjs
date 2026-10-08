// Original two-second synthesized cue; no third-party media dependency.
import fs from "node:fs";
const rate = 22050,
  samples = rate * 2,
  b = Buffer.alloc(44 + samples * 2);
b.write("RIFF");
b.writeUInt32LE(b.length - 8, 4);
b.write("WAVEfmt ", 8);
b.writeUInt32LE(16, 16);
b.writeUInt16LE(1, 20);
b.writeUInt16LE(1, 22);
b.writeUInt32LE(rate, 24);
b.writeUInt32LE(rate * 2, 28);
b.writeUInt16LE(2, 32);
b.writeUInt16LE(16, 34);
b.write("data", 36);
b.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate,
    envelope = Math.min(t * 10, 1) * Math.max(0, 1 - t / 2);
  b.writeInt16LE(
    Math.round(Math.sin(2 * Math.PI * 220 * t) * envelope * 2500),
    44 + i * 2,
  );
}
fs.writeFileSync("outputs/storyforge/assets/demo-tone.wav", b);
