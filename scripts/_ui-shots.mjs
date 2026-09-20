import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const OUT = "D:/dsh工作区/PROJECTS-项目/MangaDialogStudio/_shots/ui-audit";

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const shot = async (name) => {
  await page.screenshot({ path: OUT + "/" + name + ".png" });
  console.log("shot", name);
};

// 造点真实内容，别对着空画布评设计
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[0]?.click());
await sleep(600);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[2]?.click());
await sleep(600);
await page.evaluate(() => {
  const layout = document.querySelector('[data-drawer="layout"]');
  layout?.click();
});
await sleep(500);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((el) => el.innerText.trim() === "新建分镜");
  button?.click();
});
await sleep(600);
await page.keyboard.press("Escape");
await sleep(400);

await shot("01-default-light");

// 各抽屉
for (const [cat, name] of [["layout", "02-layout"], ["style", "03-style"], ["project", "04-more"]]) {
  await page.click('[data-drawer="' + cat + '"]');
  await sleep(600);
  await shot(name);
  await page.keyboard.press("Escape");
  await sleep(400);
}

// 左侧栏各页
for (const [tool, name] of [["images", "05-pool"], ["stickers", "06-stickers"], ["template", "07-template"]]) {
  const ok = await page.evaluate((t) => {
    const el = document.querySelector('[data-tool="' + t + '"]');
    if (!el) return false;
    el.click();
    return true;
  }, tool);
  if (ok) {
    await sleep(700);
    await shot(name);
  }
}
await page.evaluate(() => document.querySelector('[data-tool="presets"]')?.click());
await sleep(500);

// 右侧栏各页
for (const [sel, name] of [["[data-open-layers]", "08-layers"], ['[data-tool="agent"]', "09-agent"]]) {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.click();
    return true;
  }, sel);
  if (ok) {
    await sleep(800);
    await shot(name);
  }
}

// 暗色
await page.evaluate(() => document.querySelector(".studio-switch")?.click());
await sleep(700);
await shot("10-dark");
await page.evaluate(() => document.querySelector(".studio-switch")?.click());
await sleep(500);

// 窄屏
await page.setViewport({ width: 1440, height: 900 });
await sleep(900);
await shot("11-narrow-1440");
await page.setViewport({ width: 1200, height: 800 });
await sleep(900);
await shot("12-narrow-1200");

// 焦点环检查
await page.setViewport({ width: 1720, height: 1000 });
await sleep(600);
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await sleep(300);
await shot("13-focus-ring");

await browser.close();
