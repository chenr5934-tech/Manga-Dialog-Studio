import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// 预设库固定在项目目录下的 presets/，不随构建产物一起被清空
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const MAX_BODY_BYTES = 16 * 1024 * 1024;

// 两个资料库：气泡预设（单个对话框模板）与项目模板（整册版式）
const LIBRARIES = {
  presets: join(PROJECT_ROOT, "presets"),
  templates: join(PROJECT_ROOT, "templates")
};

function ensureLibraryDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// 只接受安全的文件名，杜绝路径穿越与非法字符
function resolveLibraryPath(dir, rawName) {
  const raw = String(rawName ?? "").trim();
  if (!raw || raw.length > 80) {
    return null;
  }
  if (/[\\/]/.test(raw) || raw.includes("..")) {
    return null;
  }
  if (!/^[\w\u4e00-\u9fa5 .()（）-]+$/.test(raw)) {
    return null;
  }
  const name = raw.toLowerCase().endsWith(".json") ? raw : raw + ".json";
  return { name, path: join(dir, name) };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

// 预设看数量，模板看整册规模，列表里直观展示
function describeLibraryFile(kind, parsed) {
  if (kind === "presets") {
    const list = Array.isArray(parsed) ? parsed : parsed?.presets;
    const count = Array.isArray(list) ? list.length : 0;
    return { count, detail: count + " 个气泡预设" };
  }

  const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
  const panels = pages.reduce((sum, page) => sum + (Array.isArray(page?.panels) ? page.panels.length : 0), 0);
  const bubbles = pages.reduce((sum, page) => sum + (Array.isArray(page?.bubbles) ? page.bubbles.length : 0), 0);
  return {
    count: pages.length,
    detail: pages.length + " 页 · " + panels + " 分镜 · " + bubbles + " 气泡"
  };
}

function listLibraryFiles(kind, dir) {
  ensureLibraryDir(dir);
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => {
      const full = join(dir, name);
      const stat = statSync(full);
      let count = 0;
      let detail = "";
      let readable = true;
      try {
        const described = describeLibraryFile(kind, JSON.parse(readFileSync(full, "utf8")));
        count = described.count;
        detail = described.detail;
      } catch {
        readable = false;
      }
      return { name, size: stat.size, modified: stat.mtimeMs, count, detail, readable };
    })
    .sort((left, right) => right.modified - left.modified);
}

// 资料库接口：气泡预设与项目模板共用同一套实现
function createLibraryHandler(kind) {
  const base = "/api/" + kind;
  const dir = LIBRARIES[kind];

  return async function handleLibraryApi(request, response, pathname, url) {
  if (!pathname.startsWith(base)) {
    return false;
  }

  if (pathname === base && request.method === "GET") {
    sendJson(response, 200, { dir, files: listLibraryFiles(kind, dir) });
    return true;
  }

  if (pathname === base + "/file" && request.method === "GET") {
    const target = resolveLibraryPath(dir, url.searchParams.get("name"));
    if (!target || !existsSync(target.path)) {
      sendJson(response, 404, { error: "文件不存在" });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(readFileSync(target.path, "utf8"));
    return true;
  }

  if (pathname === base + "/file" && request.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch {
      sendJson(response, 400, { error: "请求内容无法解析" });
      return true;
    }

    const target = resolveLibraryPath(dir, payload?.name);
    if (!target) {
      sendJson(response, 400, { error: "文件名不合法（不可包含路径分隔符或特殊字符）" });
      return true;
    }

    if (typeof payload?.content !== "string" || !payload.content.trim()) {
      sendJson(response, 400, { error: "内容为空" });
      return true;
    }

    try {
      JSON.parse(payload.content);
    } catch {
      sendJson(response, 400, { error: "内容不是合法 JSON" });
      return true;
    }

    ensureLibraryDir(dir);
    writeFileSync(target.path, payload.content, "utf8");
    sendJson(response, 200, { ok: true, name: target.name, dir });
    return true;
  }

  if (pathname === base + "/file" && request.method === "DELETE") {
    const target = resolveLibraryPath(dir, url.searchParams.get("name"));
    if (!target || !existsSync(target.path)) {
      sendJson(response, 404, { error: "文件不存在" });
      return true;
    }
    unlinkSync(target.path);
    sendJson(response, 200, { ok: true });
    return true;
  }

  // 在系统文件管理器里打开该资料库目录
  if (pathname === base + "/reveal" && request.method === "POST") {
    ensureLibraryDir(dir);
    const command =
      process.platform === "win32" ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
    try {
      spawn(command, [dir], { stdio: "ignore", detached: true }).unref();
      sendJson(response, 200, { ok: true, dir });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "无法打开目录" });
    }
    return true;
  }

  sendJson(response, 404, { error: "未知接口" });
  return true;
  };
}

const handlePresetApi = createLibraryHandler("presets");
const handleTemplateApi = createLibraryHandler("templates");

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
    let url;
    try {
      url = new URL(request.url ?? "/", "http://" + host);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      response.writeHead(400).end("Bad Request");
      return;
    }

    // 资料库接口优先于静态资源
    if (pathname.startsWith("/api/presets") || pathname.startsWith("/api/templates")) {
      const handler = pathname.startsWith("/api/templates") ? handleTemplateApi : handlePresetApi;
      void handler(request, response, pathname, url).catch((error) => {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "服务器内部错误" });
      });
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
