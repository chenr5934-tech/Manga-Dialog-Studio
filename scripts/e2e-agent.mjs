import puppeteer from "puppeteer-core";
import { existsSync, readFileSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const CONFIG_PATH = "D:/dsh工作区/MangaDialogStudio/config/agent.json";
const SHOT_DIR = "D:/dsh工作区/_shots";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

if (existsSync(CONFIG_PATH)) {
  rmSync(CONFIG_PATH);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());

let mockContent = "";
let lastUserMessage = null;
await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("/api/agent/chat")) {
    try {
      const body = JSON.parse(request.postData() ?? "{}");
      lastUserMessage = body.messages?.[body.messages.length - 1] ?? null;
    } catch {
      lastUserMessage = null;
    }
    void request.respond({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, content: mockContent, model: "mock" })
    });
    return;
  }
  void request.continue();
});

const readStats = () =>
  page.evaluate(() => ({
    panels: Number((document.body.innerText.match(/分镜\s*(\d+)/) ?? [0, -1])[1]),
    bubbles: Number((document.body.innerText.match(/文字\s*(\d+)/) ?? [0, -1])[1])
  }));

async function send(text) {
  await page.evaluate((value) => {
    const input = document.querySelector("[data-agent-input]");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await sleep(250);
  await page.click("[data-agent-send]");
  await sleep(1600);
}

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(700);

await page.click("[data-agent-toggle]");
await sleep(800);
const panelText = await page.evaluate(() => {
  const agent = Array.from(document.querySelectorAll("aside")).find((el) => el.innerText.includes("自动排版"));
  return agent ? agent.innerText.replace(/\s+/g, " ") : null;
});
record("Agent 面板可打开", Boolean(panelText && panelText.includes("自动排版")), String(panelText).slice(0, 50));

// ---------- 模型与档位 ----------
await page.click("[data-agent-config-toggle]");
await sleep(700);

const modelInfo = await page.evaluate(() => {
  const list = document.getElementById("agent-model-options");
  const input = document.querySelector("[data-agent-model]");
  return {
    options: Array.from(list?.options ?? []).map((option) => option.value),
    value: input?.value ?? "",
    hasDatalist: Boolean(input?.getAttribute("list"))
  };
});
record(
  "默认模型为视觉版且候选可选",
  modelInfo.options.includes("deepseek-v4-flash-vision-exp") &&
    modelInfo.value === "deepseek-v4-flash-vision-exp",
  "当前=" + modelInfo.value + " 候选=" + modelInfo.options.join("/")
);
record("模型既可下拉也可手填", modelInfo.hasDatalist);

const effortButtons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-agent-effort]")).map((el) => el.textContent.trim())
);
record(
  "提供默认/关闭/低/高/最高五档",
  effortButtons.length === 5,
  effortButtons.join(" / ")
);

await page.click('[data-agent-effort="max"]');
await sleep(300);
await page.click("[data-agent-save]");
await sleep(1400);
const savedForEffort = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : null;
record(
  "档位随配置落盘",
  savedForEffort?.effort === "max" && savedForEffort?.model === "deepseek-v4-flash-vision-exp",
  分档(savedForEffort)
);
function 分档(config) {
  return config ? "effort=" + config.effort + " model=" + config.model : "未生成";
}

// 换一家接口，模型候选应随之变化
await page.select("[data-agent-provider]", "zhipu");
await sleep(500);
const zhipuModels = await page.evaluate(() =>
  Array.from(document.getElementById("agent-model-options")?.options ?? []).map((option) => option.value)
);
record(
  "切换接口后模型候选跟随变化",
  zhipuModels.some((name) => name.startsWith("glm-")),
  zhipuModels.join("/")
);

// 手填一个不在列表里的模型，应被接受
await page.evaluate(() => {
  const input = document.querySelector("[data-agent-model]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "glm-5.3-preview");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(250);
await page.click("[data-agent-save]");
await sleep(1400);
const savedCustomModel = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : null;
record("允许手填列表外的模型名", savedCustomModel?.model === "glm-5.3-preview", savedCustomModel?.model ?? "未生成");

// 切回 deepseek 继续后面的执行测试
await page.select("[data-agent-provider]", "deepseek");
await sleep(400);
await page.click("[data-agent-save]");
await sleep(1200);
await page.click("[data-agent-config-toggle]");
await sleep(400);

// ---------- 执行能力 ----------
const before = await readStats();
mockContent = JSON.stringify({
  summary: "把这页切成 2×2 四格",
  actions: [{ type: "clearPanels" }, { type: "splitGrid", rows: 2, cols: 2 }]
});
await send("把这页切成四格");
const afterSplit = await readStats();
record("执行切分镜计划", afterSplit.panels === 4, "分镜 " + before.panels + " → " + afterSplit.panels);

// 多边形分镜
mockContent = JSON.stringify({
  summary: "加一个斜切分镜",
  actions: [
    {
      type: "addPolygonPanel",
      points: [
        { x: 200, y: 200 },
        { x: 1200, y: 320 },
        { x: 900, y: 1400 },
        { x: 260, y: 900 }
      ]
    }
  ]
});
await send("加一个不规则分镜");
const afterPolygon = await readStats();
record("支持创建多边形分镜", afterPolygon.panels === afterSplit.panels + 1, "分镜 " + afterSplit.panels + " → " + afterPolygon.panels);

// 对话气泡（预设名用简称，验证模糊匹配）
mockContent = JSON.stringify({
  summary: "加一句旁白",
  actions: [{ type: "addBubble", presetName: "旁白框", x: 1200, y: 2600, text: "三年后的夏天" }]
});
await send("加一句旁白");
const afterBubble = await readStats();
record(
  "对话气泡支持预设简称匹配",
  afterBubble.bubbles === afterPolygon.bubbles + 1,
  "文字 " + afterPolygon.bubbles + " → " + afterBubble.bubbles
);

// ---------- 作用范围 ----------
await page.click("[data-agent-scope]");
await sleep(700);
const pickingHint = await page.evaluate(() => document.body.innerText.includes("框定 Agent 范围"));
record("进入范围框定模式", pickingHint);

const canvasBox = await (await page.$(".studio-workspace > div")).boundingBox();
await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
await page.mouse.down();
await sleep(150);
await page.mouse.move(canvasBox.x + 260, canvasBox.y + 240, { steps: 6 });
await sleep(150);
await page.mouse.up();
await sleep(900);

const scopeInfo = await page.evaluate(() => {
  const el = document.querySelector("[data-agent-scope-info]");
  return el ? el.innerText.replace(/\s+/g, " ") : null;
});
record("框定后显示作用范围", Boolean(scopeInfo && scopeInfo.includes("作用范围")), String(scopeInfo).slice(0, 60));
await page.screenshot({ path: SHOT_DIR + "/agent-scope.png" });

// 范围内应正常执行
// 落在框定范围内（范围约为 x 293~960 / y 293~886）
mockContent = JSON.stringify({
  summary: "范围内加气泡",
  actions: [{ type: "addBubble", x: 620, y: 580, width: 300, height: 200, text: "框内" }]
});
const beforeInScope = await readStats();
await send("在范围内加一个气泡");
const afterInScope = await readStats();
record("范围内操作正常执行", afterInScope.bubbles === beforeInScope.bubbles + 1, "文字 " + beforeInScope.bubbles + " → " + afterInScope.bubbles);

// 越界应被拒绝
mockContent = JSON.stringify({
  summary: "越界加气泡",
  actions: [{ type: "addBubble", x: 2400, y: 3400, width: 300, height: 200, text: "框外" }]
});
const beforeOutScope = await readStats();
await send("在右下角加一个气泡");
const afterOutScope = await readStats();
const rejected = await page.evaluate(() => document.body.innerText.includes("超出限定范围"));
record(
  "越界操作被拒绝",
  afterOutScope.bubbles === beforeOutScope.bubbles && rejected,
  "文字 " + beforeOutScope.bubbles + " → " + afterOutScope.bubbles
);

// 取消范围后应恢复自由
await page.click("[data-agent-scope-clear]");
await sleep(600);
const scopeCleared = await page.evaluate(() => !document.body.innerText.includes("作用范围："));
record("可取消范围限制", scopeCleared);

// ---------- 参考图与视觉复刻 ----------
// 上一步已取消范围限制，这里直接继续
const hasDropHint = await page.evaluate(() =>
  document.body.innerText.includes("拖到这里") || document.body.innerText.includes("Ctrl+V")
);
record("面板提示可拖入参考图", hasDropHint);

// 在页面里画一张两格的示意漫画，模拟拖入
const dropped = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 600;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 600);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 10;
  ctx.strokeRect(30, 30, 340, 250);
  ctx.strokeRect(30, 310, 340, 250);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "reference.png", { type: "image/png" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const panel = document.querySelector("[data-agent-panel]");
  if (!panel) {
    return "面板未找到";
  }
  panel.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
  return "ok";
});
void dropped;
await sleep(1500);

const referenceShown = await page.evaluate(() => Boolean(document.querySelector("[data-agent-reference]")));
record("拖入图片后出现预览", referenceShown);
await page.screenshot({ path: SHOT_DIR + "/agent-reference.png" });

// 发送带图指令并检查多模态格式
mockContent = JSON.stringify({
  summary: "照参考图复刻为上下两格",
  actions: [
    { type: "setCanvasSize", width: 800, height: 1200 },
    { type: "clearPanels" },
    { type: "splitGrid", rows: 2, cols: 1 }
  ]
});
const beforeVision = await readStats();
await send("照着这张图复刻排版");
const afterVision = await readStats();

const contentIsMultimodal =
  Array.isArray(lastUserMessage?.content) &&
  lastUserMessage.content.some((part) => part?.type === "image_url" && String(part.image_url?.url).startsWith("data:image/"));
record(
  "带图请求使用多模态格式",
  contentIsMultimodal,
  Array.isArray(lastUserMessage?.content)
    ? lastUserMessage.content.map((part) => part.type).join("+")
    : typeof lastUserMessage?.content
);
record(
  "按参考图复刻排版",
  afterVision.panels === 2,
  "分镜 " + beforeVision.panels + " → " + afterVision.panels
);
record("参考图在发送后清空", !(await page.evaluate(() => Boolean(document.querySelector("[data-agent-reference]")))));

// ---------- 椭圆分镜 / 留白 / 自定义提示词 ----------
let lastSystemPrompt = null;
page.on("request", (request) => {
  if (request.url().includes("/api/agent/chat")) {
    try {
      const body = JSON.parse(request.postData() ?? "{}");
      lastSystemPrompt = body.messages?.[0]?.content ?? null;
    } catch {
      lastSystemPrompt = null;
    }
  }
});

mockContent = JSON.stringify({
  summary: "加一个圆形取景",
  actions: [{ type: "addEllipsePanel", x: 300, y: 300, width: 900, height: 700 }]
});
const beforeEllipse = await readStats();
await send("加一个圆形分镜");
const afterEllipse = await readStats();
record("Agent 可创建椭圆分镜", afterEllipse.panels === beforeEllipse.panels + 1, "分镜 " + beforeEllipse.panels + " → " + afterEllipse.panels);

// 网格留白
mockContent = JSON.stringify({
  summary: "切成四格并留出间隙",
  actions: [{ type: "splitGrid", rows: 2, cols: 2, gap: 60 }]
});
await send("切成四格，留白大一些");
const gapLogged = await page.evaluate(() => document.body.innerText.includes("留白 60"));
record("留白参数被执行", gapLogged);

// 留白是否真的分开了格子：把底色压暗后采样，格子内应是白的、格间应是暗的
mockContent = JSON.stringify({
  summary: "压暗底色并切四格",
  actions: [
    { type: "setBackdropColor", color: "#101010" },
    { type: "splitGrid", rows: 2, cols: 2, gap: 60 }
  ]
});
await send("底色改暗，再切成四格留白 60");
await sleep(800);

const gapProbe = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  const brightness = (x, y) => {
    const data = ctx.getImageData(Math.round(x), Math.round(y), 4, 4).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return Number((sum / (data.length / 4)).toFixed(1));
  };
  // 画布中心是四格交汇处，应落在间隙上；左上格内部应是分镜的白色填充
  return {
    center: brightness(canvas.width / 2, canvas.height / 2),
    insidePanel: brightness(canvas.width * 0.25, canvas.height * 0.25)
  };
});
record(
  "网格之间存在真实留白",
  Boolean(gapProbe) && gapProbe.center < 120 && gapProbe.insidePanel > 180,
  gapProbe ? "格间亮度=" + gapProbe.center + " 格内亮度=" + gapProbe.insidePanel : "取样失败"
);

// 自定义提示词注入
await page.click("[data-agent-config-toggle]");
await sleep(600);
await page.evaluate(() => {
  const input = document.querySelector("[data-agent-extra-prompt]");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, "分镜之间的留白统一按 80 处理，气泡文字一律留空。");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
await page.click("[data-agent-save]");
await sleep(1400);
const savedExtra = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")).systemPromptExtra : null;
record("自定义提示词可保存", String(savedExtra ?? "").includes("留白统一按 80"), String(savedExtra).slice(0, 30));

mockContent = JSON.stringify({ summary: "无操作", actions: [] });
await send("随便试一下");
record(
  "自定义提示词随请求下发",
  String(lastSystemPrompt ?? "").includes("留白统一按 80"),
  lastSystemPrompt ? "系统提示词长度=" + lastSystemPrompt.length : "未捕获"
);

// 内置提示词应禁止照抄参考图文字
record(
  "内置提示词禁止照抄图中文字",
  String(lastSystemPrompt ?? "").includes("不要照抄图里的文字"),
  ""
);

await page.click("[data-agent-config-toggle]");
await sleep(400);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
if (existsSync(CONFIG_PATH)) {
  rmSync(CONFIG_PATH);
}

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
