import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

// 边界与压力扫描：往各个入口塞极端值，看哪里会塌。
// 不预设"一定有 bug"，只记录真实发生的异常和耗时。
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/PROJECTS-项目/MangaDialogStudio/_shots";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 900 }
});
const page = await browser.newPage();
let errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 160));
});
page.on("dialog", (d) => void d.accept());

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const findings = [];
const flush = (label, startedAt) => {
  const list = errors.slice();
  errors = [];
  findings.push({ label, ms: Date.now() - startedAt, errors: list });
  console.log("  " + (list.length ? "!! " : "ok ") + label.padEnd(38) + " " + (Date.now() - startedAt) + "ms" + (list.length ? "  " + list[0] : ""));
};

const setNumber = async (selector, value) => {
  await page.evaluate((sel, val) => {
    const input = document.querySelector(sel);
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, String(val));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, selector, value);
};

const clickText = async (label) => page.evaluate((text) => {
  const button = Array.from(document.querySelectorAll("button")).find((el) => (el.innerText ?? "").trim() === text);
  if (!button) return false;
  button.click();
  return true;
}, label);

const stats = () => page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  return {
    canvas: canvas ? canvas.width + "x" + canvas.height : "无",
    nodes: document.querySelectorAll("canvas").length,
    footer: (document.body.innerText.match(/Canvas\s+([\d x]+)/) ?? [])[1] ?? "?"
  };
});

console.log("边界与压力扫描：");

// ---- 1) 画布尺寸塞极端值 ----
await page.click('[data-drawer="layout"]');
await sleep(600);
let t = Date.now();
await setNumber("[data-canvas-width]", 0);
await setNumber("[data-canvas-height]", 0);
await clickText("应用画布");
await sleep(900);
flush("画布设为 0×0", t);
console.log("     状态：" + JSON.stringify(await stats()));

t = Date.now();
await setNumber("[data-canvas-width]", 99999);
await setNumber("[data-canvas-height]", 99999);
await clickText("应用画布");
await sleep(1200);
flush("画布设为 99999×99999", t);
console.log("     状态：" + JSON.stringify(await stats()));

t = Date.now();
await setNumber("[data-canvas-width]", -500);
await setNumber("[data-canvas-height]", -500);
await clickText("应用画布");
await sleep(900);
flush("画布设为负数", t);
console.log("     状态：" + JSON.stringify(await stats()));

// 回到正常尺寸
t = Date.now();
await setNumber("[data-canvas-width]", 1200);
await setNumber("[data-canvas-height]", 1600);
await clickText("应用画布");
await sleep(800);
flush("恢复 1200×1600", t);

await page.keyboard.press("Escape");
await sleep(400);

// ---- 2) 一口气加 30 个气泡 ----
t = Date.now();
await page.click('[data-tool="presets"]');
await sleep(600);
for (let i = 0; i < 30; i += 1) {
  await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
  await sleep(60);
}
await sleep(1500);
flush("连加 30 个气泡", t);
const bubbleCount = await page.evaluate(() => (document.body.innerText.match(/文字\s*(\d+)/) ?? [])[1] ?? "?");
console.log("     状态：文字数=" + bubbleCount);

// ---- 3) 页面缩略图栏在大量对象下的响应 ----
t = Date.now();
await page.click('[data-tool="images"]');
await sleep(400);
await page.click('[data-tool="presets"]');
await sleep(600);
flush("30 个气泡下切换面板", t);

// ---- 4) 连续撤销 40 次 ----
t = Date.now();
for (let i = 0; i < 40; i += 1) {
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await sleep(35);
}
await sleep(1200);
flush("连按 40 次撤销", t);
const afterUndo = await page.evaluate(() => (document.body.innerText.match(/文字\s*(\d+)/) ?? [])[1] ?? "?");
console.log("     状态：撤销后文字数=" + afterUndo);

// ---- 5) 连续重做 40 次 ----
t = Date.now();
for (let i = 0; i < 40; i += 1) {
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyY");
  await page.keyboard.up("Control");
  await sleep(35);
}
await sleep(1200);
flush("连按 40 次重做", t);
const afterRedo = await page.evaluate(() => (document.body.innerText.match(/文字\s*(\d+)/) ?? [])[1] ?? "?");
console.log("     状态：重做后文字数=" + afterRedo);

// ---- 6) 超长名字 ----
t = Date.now();
const longName = "很长的名字".repeat(120);
const named = await page.evaluate((value) => {
  const projectInput = document.querySelector('input[placeholder="项目名称"]');
  if (!projectInput) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(projectInput, value);
  projectInput.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}, longName);
await sleep(900);
flush("项目名塞 600 个汉字", t);
const overflow = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth,
  wide: Array.from(document.querySelectorAll("*")).filter((el) => el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX === "visible").length
}));
console.log("     状态：" + JSON.stringify(overflow));

// ---- 7) 空项目 + 极端缩小 ----
t = Date.now();
await page.setViewport({ width: 600, height: 420 });
await sleep(900);
flush("窗口缩到 600×420", t);
const tiny = await page.evaluate(() => ({
  doc: document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth,
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth
}));
console.log("     状态：" + JSON.stringify(tiny));

await browser.close();

const withErrors = findings.filter((f) => f.errors.length > 0);
console.log("");
console.log("共 " + findings.length + " 次探测，" + withErrors.length + " 次出现异常");
if (withErrors.length) {
  console.log("出现异常的项：");
  for (const f of withErrors) {
    console.log("  - " + f.label);
    for (const line of f.errors.slice(0, 3)) console.log("      " + line);
  }
}
process.exitCode = 0;
