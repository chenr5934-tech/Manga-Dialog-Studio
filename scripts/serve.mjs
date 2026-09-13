import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const MIME_TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".map": "application/json; charset=utf-8"
  })
);

export function startServer({ root = "dist", port = 8737, open = true } = {}) {
  const rootDir = resolve(root);
  const host = "127.0.0.1";

  if (!existsSync(join(rootDir, "index.html"))) {
    console.error("[serve] 未找到构建产物: " + join(rootDir, "index.html"));
    console.error("[serve] 请先运行 npm run build");
    process.exit(1);
  }

  const server = createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://" + host).pathname);
    } catch {
      response.writeHead(400).end("Bad Request");
      return;
    }

    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    }

    const filePath = normalize(join(rootDir, pathname));
    // 阻断目录穿越，只允许访问构建目录内的文件
    if (filePath !== rootDir && !filePath.startsWith(rootDir + sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
      return;
    }

    const type = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    createReadStream(filePath).pipe(response);
  });

  let currentPort = port;
  let opened = false;

  const announce = () => {
    const url = "http://" + host + ":" + currentPort + "/";
    console.log("");
    console.log("  漫画对话工坊已启动");
    console.log("  地址: " + url);
    console.log("  按 Ctrl+C 停止服务");
    console.log("");

    if (!open || opened) {
      return;
    }
    opened = true;

    const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
      spawn(command, args, { stdio: "ignore", detached: true }).unref();
    } catch {
      console.log("  (未能自动打开浏览器，请手动访问上面的地址)");
    }
  };

  // 端口被占用时自动向后探测，避免与已运行的服务冲突
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && currentPort < port + 30) {
      currentPort += 1;
      server.listen(currentPort, host);
      return;
    }
    console.error("[serve] 启动失败: " + error.message);
    process.exit(1);
  });

  server.listen(currentPort, host, announce);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({
    root: process.argv[2] ?? "dist",
    port: Number(process.argv[3] ?? 8737),
    open: !process.argv.includes("--no-open")
  });
}
