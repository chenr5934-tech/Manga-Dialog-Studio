import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "_shots";

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

const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 600, height: 400 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#0ea5e9"></body>');
const SKY_PNG = SHOT_DIR + "/import-flow-sky.png";
await assetPage.screenshot({ path: SKY_PNG });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#f97316"></body>');
const ORANGE_PNG = SHOT_DIR + "/import-flow-orange.png";
await assetPage.screenshot({ path: ORANGE_PNG });
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
const poolCount = () => page.evaluate(() => document.querySelectorAll("[data-pooled-image]").length);
const footer = () =>
  page.evaluate(() => (document.querySelector("footer")?.innerText ?? "").replace(/\s+/g, " "));

const before = await pageCount();
record("起始只有 1 页", before === 1, "页数=" + before);

// ---------- 1) 导入两张原稿：只进素材库，不生成页面 ----------
await clickByText("导入图片");
await sleep(700);
await (await page.$("[data-import-images-input]")).uploadFile(SKY_PNG, ORANGE_PNG);
await sleep(3000);
await page.click("[data-import-confirm]");
await sleep(2500);

const afterImportPages = await pageCount();
record(
  "导入图片后不再自动生成胶片页",
  afterImportPages === before,
  "导入前=" + before + " 导入后=" + afterImportPages
);

const afterImportFooter = await footer();
record(
  "提示指向素材库而不是页数",
  afterImportFooter.includes("素材库") || afterImportFooter.includes("加入素材库"),
  afterImportFooter.slice(0, 60)
);

await page.click('[data-tool="images"]');
await sleep(800);
const pool = await poolCount();
record("两张图都进了「已导入图片」素材库", pool === 2, "素材数=" + pool);
await page.screenshot({ path: SHOT_DIR + "/import-flow-pool.png" });

// ---------- 2) 拖到胶片栏 → 生成页面 ----------
const targetPageId = await page.evaluate(() =>
  document.querySelector("[data-page-thumb]")?.getAttribute("data-page-thumb")
);

const dropped = await page.evaluate((pageId) => {
  const tile = document.querySelector("[data-pooled-image]");
  const target = document.querySelector('[data-page-thumb="' + pageId + '"]');
  if (!tile || !target) return null;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const rect = target.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  target.dispatchEvent(new DragEvent("dragover", options));
  target.dispatchEvent(new DragEvent("drop", options));
  return tile.getAttribute("data-pooled-image");
}, targetPageId);
await sleep(2000);

const afterDropPages = await pageCount();
record(
  "把素材拖到胶片栏就生成了一页",
  dropped !== null && afterDropPages === before + 1,
  "拖前=" + before + " 拖后=" + afterDropPages
);

const afterDropFooter = await footer();
record(
  "新页成为当前页，且画布尺寸跟着素材走",
  afterDropFooter.includes("600 x 400"),
  afterDropFooter.slice(0, 60)
);

// 新页插在目标页后面，而不是总追加到末尾
const order = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-page-thumb]")).map((t) => t.getAttribute("data-page-thumb"))
);
record(
  "新页插在被拖到的那个胶片后面",
  order.length === before + 1 && order[0] === targetPageId,
  "顺序=" + order.map((id) => id.slice(0, 6)).join(",")
);
await page.screenshot({ path: SHOT_DIR + "/import-flow-newpage.png" });

// 新页是一张真页面，能正常渲染
const rendered = await page.evaluate(() => {
  const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  if (list.length === 0) return 0;
  const off = document.createElement("canvas");
  off.width = list[0].width;
  off.height = list[0].height;
  const ctx = off.getContext("2d");
  for (const c of list) ctx.drawImage(c, 0, 0, off.width, off.height);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  let hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 14) < 26 && Math.abs(d[i + 1] - 165) < 26 && Math.abs(d[i + 2] - 233) < 26) hit += 1;
  }
  return hit;
});
record("新页上真的画出了这张素材", rendered > 0, "青色像素=" + rendered);

// ---------- 3) 拖到列表空白 → 追加到末尾 ----------
await page.click('[data-tool="images"]');
await sleep(700);
const second = await page.evaluate(() => {
  const tiles = Array.from(document.querySelectorAll("[data-pooled-image]"));
  const tile = tiles[1] ?? tiles[0];
  const list = document.querySelector("[data-thumb-list]");
  if (!tile || !list) return null;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = { bubbles: true, cancelable: true, dataTransfer };
  list.dispatchEvent(new DragEvent("dragover", options));
  list.dispatchEvent(new DragEvent("drop", options));
  return true;
});
await sleep(2000);

const afterBlank = await pageCount();
record(
  "拖到胶片列表空白处会追加到末尾",
  second === true && afterBlank === before + 2,
  "页数=" + afterBlank
);

// ---------- 4) 撤销能退回 ----------
const undoClicked = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => (item.innerText ?? "").trim() === "撤销" && !item.disabled
  );
  if (!button) return false;
  button.click();
  return true;
});
let afterUndo = await pageCount();
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (afterUndo !== afterBlank) break;
  await sleep(200);
  afterUndo = await pageCount();
}
record("从素材新建的页可以撤销", undoClicked && afterUndo === afterBlank - 1, "撤销后=" + afterUndo);

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
