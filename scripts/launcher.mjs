import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { needsBuild } from "./needs-build.mjs";
import { startServer } from "./serve.mjs";

// Windows 控制台默认使用本地代码页，这里切到 UTF-8 以便中文提示正常显示
if (process.platform === "win32") {
  spawnSync("cmd", ["/c", "chcp", "65001"], { stdio: "ignore" });
}

process.title = "漫画对话工坊";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  return result.status === 0;
}

console.log("");
console.log("  ==========================================");
console.log("    漫画对话工坊   Manga Dialog Studio");
console.log("  ==========================================");
console.log("");

if (!existsSync("node_modules")) {
  console.log("  [1/3] 首次运行，正在安装依赖，请稍候...");
  if (!run("npm", ["install", "--no-audit", "--no-fund"])) {
    console.error("");
    console.error("  [错误] 依赖安装失败，请检查网络连接后重试");
    process.exit(1);
  }
} else {
  console.log("  [1/3] 依赖已就绪");
}

if (needsBuild()) {
  console.log("  [2/3] 检测到源码更新，正在构建界面...");
  if (!run("npm", ["run", "build"])) {
    console.error("");
    console.error("  [错误] 构建失败");
    process.exit(1);
  }
} else {
  console.log("  [2/3] 构建产物已是最新");
}

console.log("  [3/3] 正在启动本地服务...");
startServer({ root: "dist", port: 8737, open: true });
