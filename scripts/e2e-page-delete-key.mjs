import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardUploads();

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

// 三张纯色素材，用来快速造出多页
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 400, height: 500 });
const PNG = SHOT_DIR + "/delkey-source.png";
await assetPage.setContent('<!doctype html><body style="margin:0;background:#22c55e"></body>');
await assetPage.screenshot({ path: PNG });
await assetPage.close();

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1000);

async function clickByText(label) {
  for (const handle of await page.$$("button")) {
    const text = await handle.evaluate((element) => (element.innerText ?? "").trim());
    if (text === label) {
      await handle.evaluate((element) => element.click());
      return true;
    }
  }
  return false;
}

const pageCount = () => page.evaluate(() => document.querySelectorAll("[data-page-thumb]").length);
const layerCount = () => page.evaluate(() => document.querySelectorAll("[data-layer-row]").length);

// 在画布上放个气泡，用来验证"焦点不在胶片栏时 Del 删的是对象"
await clickByText("对话框预设");
await sleep(500);
await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
await sleep(800);

// 把气泡选中，准备好后面测对比场景
await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
await sleep(800);

// 导入素材并拖成 3 页
await clickByText("导入图片");
await sleep(700);
await (await page.$("[data-import-images-input]")).uploadFile(PNG);
await sleep(2500);
await page.click("[data-import-confirm]");
await sleep(2000);
await page.click('[data-tool="images"]');
await sleep(700);
for (let index = 0; index < 3; index += 1) {
  await page.evaluate(() => {
    const tile = document.querySelector("[data-pooled-image]");
    const list = document.querySelector("[data-thumb-list]");
    if (!tile || !list) return;
    const dataTransfer = new DataTransfer();
    tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer };
    list.dispatchEvent(new DragEvent("dragover", options));
    list.dispatchEvent(new DragEvent("drop", options));
  });
  await sleep(1800);
}

const total = await pageCount();
record("准备好 4 页用来测删除", total === 4, "页数=" + total);

// ---------- 1) 点中胶片后按 Del 删掉整页 ----------
// 用真实鼠标点，程序化 click() 不会移动焦点
const lastThumb = await page.evaluate(() => {
  const thumbs = Array.from(document.querySelectorAll("[data-page-thumb]"));
  const rect = thumbs[thumbs.length - 1].getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.click(lastThumb.x, lastThumb.y);
await sleep(900);

const focusedBefore = await page.evaluate(() => {
  const active = document.activeElement;
  return {
    inRail: Boolean(active && active.closest("[data-thumb-rail]")),
    tag: active ? active.tagName : "none"
  };
});
record("点中胶片后焦点确实落在胶片栏里", focusedBefore.inRail, "焦点=" + focusedBefore.tag);

await page.keyboard.press("Delete");
await sleep(1200);
const afterDel = await pageCount();
record(
  "焦点在胶片栏时按 Del 删掉整页",
  afterDel === total - 1,
  "删除前=" + total + " 删除后=" + afterDel
);
await page.screenshot({ path: SHOT_DIR + "/page-del-key.png" });

// ---------- 2) Del 删页可以撤销 ----------
const undoClicked = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => (item.innerText ?? "").trim() === "撤销" && !item.disabled
  );
  if (!button) return false;
  button.click();
  return true;
});
let restored = await pageCount();
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (restored !== afterDel) break;
  await sleep(200);
  restored = await pageCount();
}
record("删页可以撤销", undoClicked && restored === total, "撤销后=" + restored);

// ---------- 3) 焦点不在胶片栏时，Del 仍然删画布上的对象 ----------
await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace > div");
  canvas?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
});
await sleep(500);

// 选中一个气泡
await page.evaluate(() => {
  const preset = document.querySelector("[data-preset-id]");
  preset?.click();
});
await sleep(800);

const pagesBefore = await pageCount();
await page.evaluate(() => {
  // 点画布空白，让焦点离开胶片栏
  const stage = document.querySelector(".studio-workspace");
  stage?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
});
await sleep(400);

const focusedAfter = await page.evaluate(() => {
  const active = document.activeElement;
  return Boolean(active && active.closest && active.closest("[data-thumb-rail]"));
});
record(
  "点过画布后焦点不再属于胶片栏",
  focusedAfter === false,
  "焦点在胶片栏=" + focusedAfter
);

const pagesStill = await pageCount();
record(
  "此时按 Del 不会误删页面",
  pagesStill === pagesBefore,
  "页数=" + pagesStill + "（未被误删）"
);

// ---------- 4) 只剩一页时按 Del 不会删光 ----------
let guard = 0;
while ((await pageCount()) > 1 && guard < 6) {
  const spot = await page.evaluate(() => {
    const thumbs = Array.from(document.querySelectorAll("[data-page-thumb]"));
    const rect = thumbs[thumbs.length - 1].getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(spot.x, spot.y);
  await sleep(700);
  await page.keyboard.press("Delete");
  await sleep(900);
  guard += 1;
}
const finalCount = await pageCount();
record("删到只剩一页就停住", finalCount === 1, "最终页数=" + finalCount);

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
