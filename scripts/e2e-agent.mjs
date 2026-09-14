import puppeteer from "puppeteer-core";
import { existsSync, readFileSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const CONFIG_PATH = "D:/dsh工作区/MangaDialogStudio/config/agent.json";

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

// 拦截对话接口，用可控内容验证前端解析与执行链路（真实调用需要密钥）
let mockContent = "";
await page.setRequestInterception(true);
page.on("request", (request) => {
  if (request.url().includes("/api/agent/chat")) {
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
  const panels = Array.from(document.querySelectorAll("aside"));
  const agent = panels.find((el) => el.innerText.includes("自动排版"));
  return agent ? agent.innerText.replace(/\s+/g, " ") : null;
});
record("Agent 面板可打开", Boolean(panelText && panelText.includes("自动排版")), String(panelText).slice(0, 60));

// 模型设置
await page.click("[data-agent-config-toggle]");
await sleep(700);
const providerOptions = await page.evaluate(() => {
  const select = document.querySelector('[data-agent-provider]');
  return select ? Array.from(select.options).map((o) => o.textContent) : [];
});
record(
  "提供多家接口可选",
  providerOptions.length >= 6 && providerOptions.some((t) => t.includes("DeepSeek")),
  providerOptions.join("、")
);

// 切换接口后保存
await page.select("[data-agent-provider]", "openai");
await sleep(400);
await page.click("[data-agent-save]");
await sleep(1400);
const savedConfig = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : null;
record(
  "配置写入本机 agent.json",
  savedConfig?.provider === "openai" && savedConfig?.baseUrl.includes("openai.com"),
  savedConfig ? savedConfig.provider + " | " + savedConfig.model : "未生成"
);

await page.click("[data-agent-config-toggle]");
await sleep(500);

// 执行：切分镜
const before = await readStats();
mockContent = JSON.stringify({
  summary: "把这页切成 2×2 四格",
  actions: [{ type: "clearPanels" }, { type: "splitGrid", rows: 2, cols: 2 }]
});
await send("把这页切成四格");
const afterSplit = await readStats();
record("执行切分镜计划", afterSplit.panels === 4, "分镜 " + before.panels + " → " + afterSplit.panels);

const appliedLogged = await page.evaluate(() =>
  document.body.innerText.includes("切分为 2 行 × 2 列")
);
record("面板显示执行明细", appliedLogged);

// 执行：加气泡并写入文字
mockContent = JSON.stringify({
  summary: "加一个旁白框",
  actions: [{ type: "addBubble", x: 1240, y: 800, width: 900, height: 300, text: "三年后的夏天" }]
});
await send("加一个旁白框写「三年后的夏天」");
const afterBubble = await readStats();
record("执行加气泡计划", afterBubble.bubbles === afterSplit.bubbles + 1, "文字 " + afterSplit.bubbles + " → " + afterBubble.bubbles);

const bubbleText = await page.evaluate(() => {
  const textarea = document.querySelector("textarea[rows]");
  return document.body.innerText.includes("三年后的夏天") || Boolean(textarea);
});
record("气泡文字已写入", bubbleText);

// 容错：模型返回代码围栏包裹的 JSON
mockContent = '好的，方案如下：\n\`\`\`json\n{"summary":"切成三行","actions":[{"type":"splitGrid","rows":3,"cols":1}]}\n\`\`\`';
await send("改成三行");
const afterFence = await readStats();
record("可解析代码围栏包裹的 JSON", afterFence.panels === 3, "分镜=" + afterFence.panels);

// 容错：完全无法解析
mockContent = "我不确定你在说什么";
await send("随便说点什么");
const errorShown = await page.evaluate(
  () => document.body.innerText.includes("无法解析为操作计划")
);
record("无法解析时给出提示", errorShown);

// 撤销应能回退 agent 的改动
const beforeUndo = await readStats();
await page.keyboard.down("Control");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Control");
await sleep(900);
const afterUndo = await readStats();
record(
  "Agent 的改动可撤销",
  afterUndo.panels !== beforeUndo.panels || afterUndo.bubbles !== beforeUndo.bubbles,
  "分镜 " + beforeUndo.panels + " → " + afterUndo.panels
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
if (existsSync(CONFIG_PATH)) {
  rmSync(CONFIG_PATH);
}

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
