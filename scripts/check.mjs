import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const files = [];
function walk(dir) {
  for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, x.name);
    if (x.isDirectory()) walk(file);
    else if (/\.(mjs|js|cjs)$/.test(file)) files.push(file);
  }
}
walk("outputs/storyforge/studio");
walk("tests");
files.push(
  "work/server.cjs",
  "outputs/cloudflare/projects.mjs",
  "outputs/cloudflare/publishing.mjs",
  "outputs/cloudflare/worker.mjs",
);
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stderr);
    process.exit(1);
  }
}
console.log(`Syntax checked ${files.length} maintained files`);
