import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_TARGETS = [
  "src",
  "index.html",
  "package.json",
  "vite.config.ts",
  "tailwind.config.cjs",
  "postcss.config.cjs"
];

function newestMtime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    const time = entry.isDirectory() ? newestMtime(fullPath) : statSync(fullPath).mtimeMs;
    if (time > newest) {
      newest = time;
    }
  }
  return newest;
}

export function needsBuild() {
  let sourceTime = 0;
  for (const target of SOURCE_TARGETS) {
    if (!existsSync(target)) {
      continue;
    }
    const stat = statSync(target);
    const time = stat.isDirectory() ? newestMtime(target) : stat.mtimeMs;
    if (time > sourceTime) {
      sourceTime = time;
    }
  }

  const buildTime = existsSync("dist/index.html") ? statSync("dist/index.html").mtimeMs : 0;
  return sourceTime > buildTime;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(needsBuild() ? "yes" : "no");
}
