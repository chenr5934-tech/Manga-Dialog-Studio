import { createServer } from "node:http";
import {
  copyFileSync,
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
// 素材库是整份 JSON 全量回写的：用户多导入几张漫画原稿就会到十几兆，
// 上限留低了会出现"保存静默失败"，所以放宽到 64MB
const MAX_BODY_BYTES = 64 * 1024 * 1024;

// 资料库：气泡预设（单个对话框模板）、项目模板（整册版式）、
// 自定义贴纸，以及已导入图片（原稿的常驻副本，删掉页面也不会丢）
const LIBRARIES = {
  presets: join(PROJECT_ROOT, "presets"),
  templates: join(PROJECT_ROOT, "templates"),
  stickers: join(PROJECT_ROOT, "stickers"),
  uploads: join(PROJECT_ROOT, "uploads")
};

const AGENT_CONFIG_DIR = join(PROJECT_ROOT, "config");
const AGENT_CONFIG_PATH = join(AGENT_CONFIG_DIR, "agent.json");

// 端点均已实测可达（无 key 时返回 401 而非 404）。
// 模型列表与思考档位取自各家官方文档；模型名会随时间变化，界面允许直接手填覆盖。
const AGENT_PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    // vision-exp 是实验版视觉模型，支持读图复刻排版；名称可能随官方调整
    models: ["deepseek-v4-flash-vision-exp", "deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash-vision-exp",
    // 官方文档：reasoning_effort 取值 none / low / high / max
    effortParam: "reasoning_effort",
    effortMap: { off: "none", low: "low", high: "high", max: "max" }
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"],
    defaultModel: "gpt-4o-mini",
    effortParam: "reasoning_effort",
    effortMap: { off: "low", low: "low", high: "high", max: "high" }
  },
  moonshot: {
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k3", "kimi-k2.6", "kimi-k2.7-code"],
    defaultModel: "kimi-k3",
    effortParam: "reasoning_effort",
    effortMap: { off: "none", low: "low", high: "high", max: "max" }
  },
  dashscope: {
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-flash", "qwen-turbo", "qwen3-235b-a22b"],
    defaultModel: "qwen-plus",
    // 官方文档：开关式 enable_thinking
    effortParam: "enable_thinking",
    effortMap: { off: false, low: true, high: true, max: true }
  },
  zhipu: {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.3", "glm-5", "glm-4.7", "glm-4.6"],
    defaultModel: "glm-4.7",
    effortParam: "reasoning_effort",
    effortMap: { off: "none", low: "low", high: "high", max: "high" }
  },
  ollama: {
    label: "本地 Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5", "llama3.1"],
    defaultModel: "qwen2.5",
    effortParam: null,
    effortMap: {}
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    models: [],
    defaultModel: "",
    effortParam: "reasoning_effort",
    effortMap: { off: "none", low: "low", high: "high", max: "max" }
  }
};

const DEFAULT_AGENT_CONFIG = {
  provider: "deepseek",
  baseUrl: AGENT_PROVIDERS.deepseek.baseUrl,
  model: AGENT_PROVIDERS.deepseek.defaultModel,
  apiKey: "",
  temperature: 0.3,
  effort: "auto",
  // 用户在界面上写的附加指令，会追加到内置提示词之后
  systemPromptExtra: ""
};

// 把统一的档位翻译成各家自己的参数；不支持的厂商直接不发该参数
function buildEffortParams(config) {
  const preset = AGENT_PROVIDERS[config.provider];
  if (!preset?.effortParam || !preset.effortMap) {
    return {};
  }
  const effort = String(config.effort ?? "auto");
  if (effort === "auto") {
    return {};
  }
  const value = preset.effortMap[effort];
  if (value === undefined) {
    return {};
  }
  return { [preset.effortParam]: value };
}

function readAgentConfig() {
  try {
    const parsed = JSON.parse(readFileSync(AGENT_CONFIG_PATH, "utf8"));
    return {
      ...DEFAULT_AGENT_CONFIG,
      ...parsed,
      temperature: Number.isFinite(Number(parsed?.temperature)) ? Number(parsed.temperature) : 0.3,
      effort: String(parsed?.effort ?? "auto")
    };
  } catch {
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

function writeAgentConfig(next) {
  if (!existsSync(AGENT_CONFIG_DIR)) {
    mkdirSync(AGENT_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
}

// 界面外观配置（自定义背景壁纸）。和 agent.json 一样属于个人数据，
// 不进版本库。壁纸存 dataURL，所以单独放一个文件。
const UI_CONFIG_PATH = join(AGENT_CONFIG_DIR, "ui.json");

const DEFAULT_UI_CONFIG = {
  wallpaper: "",
  wallpaperOpacity: 100,
  wallpaperBlur: 0,
  wallpaperDim: 45,
  panelOpacity: 92
};

function readUiConfig() {
  try {
    const parsed = JSON.parse(readFileSync(UI_CONFIG_PATH, "utf8"));
    const clamp = (value, min, max, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
    };
    return {
      wallpaper: typeof parsed?.wallpaper === "string" ? parsed.wallpaper : "",
      wallpaperOpacity: clamp(parsed?.wallpaperOpacity, 0, 100, DEFAULT_UI_CONFIG.wallpaperOpacity),
      wallpaperBlur: clamp(parsed?.wallpaperBlur, 0, 40, DEFAULT_UI_CONFIG.wallpaperBlur),
      wallpaperDim: clamp(parsed?.wallpaperDim, 0, 90, DEFAULT_UI_CONFIG.wallpaperDim),
      panelOpacity: clamp(parsed?.panelOpacity, 60, 100, DEFAULT_UI_CONFIG.panelOpacity)
    };
  } catch {
    return { ...DEFAULT_UI_CONFIG };
  }
}

function writeUiConfig(next) {
  if (!existsSync(AGENT_CONFIG_DIR)) {
    mkdirSync(AGENT_CONFIG_DIR, { recursive: true });
  }
  writeFileSync(UI_CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
}

// 只回传密钥是否已配置与末位提示，避免明文到处出现
function maskApiKey(key) {
  const raw = String(key ?? "");
  if (!raw) {
    return "";
  }
  return raw.length <= 6 ? "****" : "****" + raw.slice(-4);
}

function joinApiUrl(baseUrl, path) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return "";
  }
  return base + path;
}

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

// 覆盖或删除之前先把上一版存成 <文件>.bak。
// 素材库、预设、贴纸、模板全是用户自己攒的东西，一次误覆盖就没了退路。
function keepLibraryBackup(fullPath) {
  if (!existsSync(fullPath)) {
    return;
  }
  try {
    copyFileSync(fullPath, fullPath + ".bak");
  } catch {
    // 备份失败不该挡住正常保存
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

class BodyTooLargeError extends Error {
  constructor(limit) {
    super("请求体超过上限（" + Math.round(limit / 1024 / 1024) + "MB）");
    this.statusCode = 413;
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    request.on("data", (chunk) => {
      if (overflow) {
        // 已经超了：继续把数据收完丢掉，但不再占内存。
        // 原来这里直接 request.destroy()，浏览器只会收到一个连接重置，
        // 前端 catch 到的是 "fetch failed"，用户完全不知道发生了什么。
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (overflow) {
        reject(new BodyTooLargeError(MAX_BODY_BYTES));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
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

  if (kind === "stickers") {
    const list = Array.isArray(parsed) ? parsed : parsed?.stickers;
    const count = Array.isArray(list) ? list.length : 0;
    return { count, detail: count + " 张自定义贴纸" };
  }

  if (kind === "uploads") {
    const list = Array.isArray(parsed) ? parsed : parsed?.images;
    const count = Array.isArray(list) ? list.length : 0;
    return { count, detail: count + " 张已导入图片" };
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
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
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
    keepLibraryBackup(target.path);
    writeFileSync(target.path, payload.content, "utf8");
    sendJson(response, 200, { ok: true, name: target.name, dir });
    return true;
  }

  // 增量追加：只上传这批新增的条目，服务端读回旧文件合并。
  // 导入原来走的是「读回整个库 → 前端合并 → 全量写回」，请求体随库一起长大，
  // 装满十几张原稿就能把上限撑爆；这个接口让单次请求只跟"这批新增"有关。
  if (pathname === base + "/append" && request.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
      return true;
    }

    const target = resolveLibraryPath(dir, payload?.name);
    if (!target) {
      sendJson(response, 400, { error: "文件名不合法（不可包含路径分隔符或特殊字符）" });
      return true;
    }

    const incoming = Array.isArray(payload?.items) ? payload.items : [];
    // hidden 单独可写：隐藏/恢复一张图只是改这个数组，
    // 没必要把整库几十兆再传一遍
    const nextHidden = Array.isArray(payload?.hidden) ? payload.hidden.map((entry) => String(entry)) : null;
    if (incoming.length === 0 && !nextHidden) {
      sendJson(response, 200, { ok: true, name: target.name, added: 0, total: 0 });
      return true;
    }

    let current = { images: [], hidden: [] };
    if (existsSync(target.path)) {
      try {
        const parsed = JSON.parse(readFileSync(target.path, "utf8"));
        current = {
          images: Array.isArray(parsed?.images) ? parsed.images : Array.isArray(parsed) ? parsed : [],
          hidden: Array.isArray(parsed?.hidden) ? parsed.hidden : []
        };
      } catch {
        // 旧文件坏了就当空库重建，别让一次追加彻底卡死
        current = { images: [], hidden: [] };
      }
    }

    const seen = new Set(current.images.map((item) => String(item?.image ?? "")));
    const fresh = incoming.filter((item) => {
      const image = String(item?.image ?? "");
      if (!image || seen.has(image)) {
        return false;
      }
      seen.add(image);
      return true;
    });

    const revive = new Set((Array.isArray(payload?.revive) ? payload.revive : []).map((entry) => String(entry)));
    const hidden = nextHidden
      ? nextHidden
      : revive.size
        ? current.hidden.filter((entry) => !revive.has(String(entry)))
        : current.hidden;

    const next = {
      name: target.name.replace(/\.json$/i, ""),
      images: [...current.images, ...fresh],
      hidden
    };

    try {
      ensureLibraryDir(dir);
      keepLibraryBackup(target.path);
      writeFileSync(target.path, JSON.stringify(next, null, 2), "utf8");
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "写入失败" });
      return true;
    }

    sendJson(response, 200, { ok: true, name: target.name, added: fresh.length, total: next.images.length });
    return true;
  }

  // 按 id 删除若干条目。删除原来走的是「整库全量回写」，
  // 库一大同样会撞上体积上限 —— 只是把导入的问题留在了删除这一步。
  if (pathname === base + "/drop" && request.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
      return true;
    }

    const target = resolveLibraryPath(dir, payload?.name);
    if (!target) {
      sendJson(response, 400, { error: "文件名不合法（不可包含路径分隔符或特殊字符）" });
      return true;
    }
    if (!existsSync(target.path)) {
      sendJson(response, 200, { ok: true, removed: 0, total: 0 });
      return true;
    }

    const ids = new Set((Array.isArray(payload?.ids) ? payload.ids : []).map((entry) => String(entry)));
    if (ids.size === 0) {
      sendJson(response, 200, { ok: true, removed: 0, total: 0 });
      return true;
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(target.path, "utf8"));
    } catch {
      sendJson(response, 500, { error: "库文件读不出来，无法删除" });
      return true;
    }

    const before = Array.isArray(parsed?.images) ? parsed.images : [];
    const keep = before.filter((item) => !ids.has(String(item?.id ?? "")));
    const next = {
      name: target.name.replace(/\.json$/i, ""),
      images: keep,
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden : []
    };

    try {
      keepLibraryBackup(target.path);
      writeFileSync(target.path, JSON.stringify(next, null, 2), "utf8");
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "写入失败" });
      return true;
    }

    sendJson(response, 200, { ok: true, removed: before.length - keep.length, total: keep.length });
    return true;
  }

  if (pathname === base + "/file" && request.method === "DELETE") {
    const target = resolveLibraryPath(dir, url.searchParams.get("name"));
    if (!target || !existsSync(target.path)) {
      sendJson(response, 404, { error: "文件不存在" });
      return true;
    }
    keepLibraryBackup(target.path);
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
const handleStickerApi = createLibraryHandler("stickers");
const handleUploadApi = createLibraryHandler("uploads");

// Agent 模式：配置读写 + 对话转发，顺带管界面外观配置。
// 密钥只在本地服务里使用，浏览器始终拿不到明文。
async function handleAgentApi(request, response, pathname) {
  // 界面外观（/api/ui/*）和 agent 都在这个函数里处理，别把它挡在门外
  if (!pathname.startsWith("/api/agent") && !pathname.startsWith("/api/ui")) {
    return false;
  }

  if (pathname === "/api/agent/config" && request.method === "GET") {
    const config = readAgentConfig();
    sendJson(response, 200, {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: config.temperature,
      effort: config.effort,
      systemPromptExtra: config.systemPromptExtra,
      // 本地工具：服务只监听 127.0.0.1，密钥本来就明文存在 config/agent.json。
      // 这里把密钥一并返回供前端回填，省得每次启动都要重输一遍。
      apiKey: config.apiKey ?? "",
      hasApiKey: Boolean(config.apiKey),
      apiKeyHint: maskApiKey(config.apiKey),
      providers: Object.entries(AGENT_PROVIDERS).map(([id, preset]) => ({ id, ...preset }))
    });
    return true;
  }

  if (pathname === "/api/ui/config" && request.method === "GET") {
    sendJson(response, 200, readUiConfig());
    return true;
  }

  if (pathname === "/api/ui/config" && request.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
      return true;
    }

    const current = readUiConfig();
    const clamp = (value, min, max, fallback) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
    };

    const next = {
      // 传空字符串表示清掉壁纸，回到默认背景
      wallpaper: typeof payload?.wallpaper === "string" ? payload.wallpaper : current.wallpaper,
      wallpaperOpacity: clamp(payload?.wallpaperOpacity, 0, 100, current.wallpaperOpacity),
      wallpaperBlur: clamp(payload?.wallpaperBlur, 0, 40, current.wallpaperBlur),
      wallpaperDim: clamp(payload?.wallpaperDim, 0, 90, current.wallpaperDim),
      panelOpacity: clamp(payload?.panelOpacity, 60, 100, current.panelOpacity)
    };

    try {
      writeUiConfig(next);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "界面配置写入失败" });
      return true;
    }

    sendJson(response, 200, { ok: true, ...next });
    return true;
  }

  if (pathname === "/api/agent/config" && request.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
      return true;
    }

    const current = readAgentConfig();
    const providerId = AGENT_PROVIDERS[payload?.provider] ? payload.provider : current.provider;
    const preset = AGENT_PROVIDERS[providerId];
    const baseUrl = String(payload?.baseUrl ?? "").trim() || preset.baseUrl || current.baseUrl;
    // 模型允许手填覆盖预设，方便新模型发布后立即使用
    const model = String(payload?.model ?? "").trim() || preset.defaultModel || current.model;

    // 传了空字符串表示沿用已保存的密钥，避免前端回写打码值
    const apiKey =
      typeof payload?.apiKey === "string" && payload.apiKey.trim() && !payload.apiKey.includes("****")
        ? payload.apiKey.trim()
        : current.apiKey;

    const allowedEfforts = ["auto", "off", "low", "high", "max"];
    const effort = allowedEfforts.includes(String(payload?.effort))
      ? String(payload.effort)
      : current.effort;

    const next = {
      provider: providerId,
      baseUrl,
      model,
      apiKey,
      temperature: Number.isFinite(Number(payload?.temperature)) ? Number(payload.temperature) : current.temperature,
      effort,
      systemPromptExtra:
        typeof payload?.systemPromptExtra === "string"
          ? payload.systemPromptExtra.slice(0, 8000)
          : current.systemPromptExtra
    };

    try {
      writeAgentConfig(next);
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "配置写入失败" });
      return true;
    }

    sendJson(response, 200, {
      ok: true,
      provider: next.provider,
      baseUrl: next.baseUrl,
      model: next.model,
      effort: next.effort,
      systemPromptExtra: next.systemPromptExtra,
      hasApiKey: Boolean(next.apiKey),
      apiKeyHint: maskApiKey(next.apiKey)
    });
    return true;
  }

  if (pathname === "/api/agent/chat" && request.method === "POST") {
    const config = readAgentConfig();
    if (!config.apiKey && config.provider !== "ollama") {
      sendJson(response, 400, { error: "还没有配置 API Key，请先在 Agent 面板里填写并保存" });
      return true;
    }
    if (!config.baseUrl) {
      sendJson(response, 400, { error: "还没有配置接口地址" });
      return true;
    }

    let payload;
    try {
      payload = JSON.parse(await readRequestBody(request));
    } catch (error) {
      const status = Number(error?.statusCode) || 400;
      sendJson(response, status, {
        error: status === 413 ? String(error?.message ?? "请求体过大") : "请求内容无法解析"
      });
      return true;
    }

    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    if (messages.length === 0) {
      sendJson(response, 400, { error: "没有可发送的消息" });
      return true;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);

    try {
      const upstream = await fetch(joinApiUrl(config.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.apiKey
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: config.temperature,
          stream: false,
          ...buildEffortParams(config)
        }),
        signal: controller.signal
      });

      const text = await upstream.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!upstream.ok) {
        const detail =
          parsed?.error?.message ?? parsed?.message ?? text.slice(0, 300) ?? "上游接口返回错误";
        sendJson(response, 200, {
          ok: false,
          status: upstream.status,
          error: String(detail)
        });
        return true;
      }

      const content = parsed?.choices?.[0]?.message?.content ?? "";
      sendJson(response, 200, {
        ok: true,
        content: String(content),
        model: parsed?.model ?? config.model,
        usage: parsed?.usage ?? null
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      sendJson(response, 200, {
        ok: false,
        error: aborted ? "请求超时（120 秒）" : error instanceof Error ? error.message : "请求失败"
      });
    } finally {
      clearTimeout(timer);
    }
    return true;
  }

  sendJson(response, 404, { error: "未知接口" });
  return true;
}

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

    if (pathname.startsWith("/api/agent") || pathname.startsWith("/api/ui")) {
      void handleAgentApi(request, response, pathname).catch((error) => {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "服务器内部错误" });
      });
      return;
    }

    // 资料库接口优先于静态资源
    const libraryRoute = [
      { prefix: "/api/templates", handler: handleTemplateApi },
      { prefix: "/api/presets", handler: handlePresetApi },
      { prefix: "/api/stickers", handler: handleStickerApi },
      { prefix: "/api/uploads", handler: handleUploadApi }
    ].find((entry) => pathname.startsWith(entry.prefix));

    if (libraryRoute) {
      void libraryRoute.handler(request, response, pathname, url).catch((error) => {
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
