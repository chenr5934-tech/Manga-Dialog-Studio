import puppeteer from "puppeteer-core";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const PRESET_DIR = "D:/dsh工作区/MangaDialogStudio/presets";
const API = "http://127.0.0.1:8737/api/presets";
const TEST_FILE = "e2e-测试预设库";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

async function apiJson(path, init) {
  const response = await fetch(API + path, init);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

// 准备一个待载入的预设文件
const samplePreset = {
  id: "user:e2e-library-1",
  name: "库测试气泡",
  builtin: false,
  type: "rounded",
  width: 320,
  height: 200,
  textBox: { x: 0.15, y: 0.15, width: 0.7, height: 0.7 },
  background: "#ffffff",
  borderColor: "#141a22",
  borderWidth: 4,
  borderRadius: 24,
  direction: "horizontal",
  fontSize: 30,
  fontFamily: "Noto Sans SC",
  textColor: "#141a22"
};

const cleanup = () => {
  for (const name of readdirSync(PRESET_DIR)) {
    if (name.startsWith(TEST_FILE)) {
      unlinkSync(join(PRESET_DIR, name));
    }
  }
};
cleanup();

const writeResult = await apiJson("/file", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: TEST_FILE,
    content: JSON.stringify({ version: 1, presets: [samplePreset] })
  })
});
record(
  "接口可写入预设文件",
  writeResult.status === 200 && existsSync(join(PRESET_DIR, TEST_FILE + ".json")),
  "status=" + writeResult.status
);

const listResult = await apiJson("");
record(
  "接口可列出文件夹内容",
  listResult.status === 200 && (listResult.body.files ?? []).some((file) => file.name === TEST_FILE + ".json"),
  "文件数=" + ((listResult.body.files ?? []).length)
);

// 非法文件名必须被拒
const badName = await apiJson("/file", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "../escape", content: "{}" })
});
record("拒绝路径穿越的文件名", badName.status === 400, "status=" + badName.status);

// ---------- UI ----------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let promptAnswer = null;
page.on("dialog", (dialog) => {
  if (dialog.type() === "prompt") {
    void dialog.accept(promptAnswer ?? "e2e-prompt-默认名");
    return;
  }
  void dialog.accept();
});

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(600);

await page.click("[data-open-preset-library]");
await sleep(1200);

const libraryOpen = await page.evaluate(() => {
  const el = document.querySelector('[data-preset-library="1"]');
  return el ? el.innerText.replace(/\s+/g, " ") : null;
});
const statesPresetScope = Boolean(libraryOpen && libraryOpen.includes("气泡"));
record(
  "预设库小窗可打开并显示目录",
  Boolean(libraryOpen && libraryOpen.includes("presets")),
  statesPresetScope ? "已标注为气泡预设" : "缺少范围说明"
);

const listedInUi = await page.evaluate(
  (name) => Boolean(document.querySelector('[data-preset-file="' + name + '"]')),
  TEST_FILE + ".json"
);
record("小窗列出文件夹里的预设文件", listedInUi);

// 载入
const presetsBefore = await page.evaluate(() => document.querySelectorAll('[data-preset-id^="user:"]').length);
await page.click('[data-preset-load="' + TEST_FILE + '.json"]');
await sleep(1200);
await page.click("[data-preset-library] .studio-btn:not(.studio-btn-primary)"); // 关闭（头部第一个普通按钮是打开文件夹，这里用 Esc 更稳）
await page.keyboard.press("Escape");
await sleep(600);

const presetsAfter = await page.evaluate(() => document.querySelectorAll('[data-preset-id^="user:"]').length);
record("载入后预设进入列表", presetsAfter > presetsBefore, "自定义预设 " + presetsBefore + " → " + presetsAfter);

// 保存：把当前预设写回文件夹
await page.click("[data-open-preset-library]");
await sleep(1000);
await page.evaluate(() => {
  const input = document.querySelector("[data-preset-save-input]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "e2e-保存测试");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
const saveDisabled = await page.evaluate(() => document.querySelector("[data-preset-save-button]")?.disabled);
record("有自定义预设时保存按钮可用", saveDisabled === false, "disabled=" + saveDisabled);

await page.click("[data-preset-save-button]");
await sleep(1500);
record(
  "保存后磁盘上出现新文件",
  existsSync(join(PRESET_DIR, "e2e-保存测试.json")),
  readdirSync(PRESET_DIR).filter((n) => n.startsWith("e2e-")).join(", ")
);

await page.screenshot({ path: "D:/dsh工作区/_shots/preset-library.png" });

const savedContent = existsSync(join(PRESET_DIR, "e2e-保存测试.json"))
  ? JSON.parse(readFileSync(join(PRESET_DIR, "e2e-保存测试.json"), "utf8"))
  : null;
record(
  "保存的文件包含完整预设",
  Array.isArray(savedContent?.presets) && savedContent.presets.length > 0,
  "预设数=" + (savedContent?.presets?.length ?? 0)
);

// 删除
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll('[data-preset-file] button')).find(
    (el) => el.textContent.trim() === "删除"
  );
  button?.click();
});
await sleep(1500);
const remaining = readdirSync(PRESET_DIR).filter((n) => n.startsWith("e2e-保存测试"));
record("删除后磁盘文件消失", remaining.length === 0, "残留=" + remaining.length);

// 左侧「保存预设」一键入口
await page.keyboard.press("Escape");
await sleep(500);
const quickSaveExists = await page.evaluate(() => Boolean(document.querySelector("[data-save-preset]")));
record("左侧提供一键保存预设入口", quickSaveExists);

promptAnswer = "e2e-一键保存";
await page.click("[data-save-preset]");
await sleep(1800);
record(
  "一键保存写入磁盘",
  existsSync(join(PRESET_DIR, "e2e-一键保存.json")),
  readdirSync(PRESET_DIR).filter((n) => n.startsWith("e2e-")).join(", ")
);

// 预设编辑器里的「保存并存入预设库」
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((el) => el.innerText.trim() === "对话编辑");
  button?.click();
});
await sleep(600);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((el) => el.innerText.trim() === "新建预设");
  button?.click();
});
await sleep(1000);

const editorOpen = await page.evaluate(() => Boolean(document.querySelector("[data-save-to-library]")));
record("预设编辑器提供存入预设库按钮", editorOpen);

promptAnswer = "e2e-编辑器存入";
await page.click("[data-save-to-library]");
await sleep(1800);
record(
  "编辑器一键存入预设库",
  existsSync(join(PRESET_DIR, "e2e-编辑器存入.json")),
  existsSync(join(PRESET_DIR, "e2e-编辑器存入.json"))
    ? "预设数=" + JSON.parse(readFileSync(join(PRESET_DIR, "e2e-编辑器存入.json"), "utf8")).presets.length
    : "未生成"
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
cleanup();

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
