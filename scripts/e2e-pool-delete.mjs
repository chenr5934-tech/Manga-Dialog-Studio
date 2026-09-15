import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";
const LIBRARY = "D:/dsh工作区/MangaDialogStudio/uploads/已导入图片.json";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

const readLibrary = () => {
  if (!existsSync(LIBRARY)) return { images: [], hidden: [] };
  const parsed = JSON.parse(readFileSync(LIBRARY, "utf8"));
  return {
    images: Array.isArray(parsed?.images) ? parsed.images : [],
    hidden: Array.isArray(parsed?.hidden) ? parsed.hidden : []
  };
};

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
await assetPage.setContent('<!doctype html><body style="margin:0;background:#14b8a6"></body>');
const A_PNG = SHOT_DIR + "/pool-del-a.png";
await assetPage.screenshot({ path: A_PNG });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#f59e0b"></body>');
const B_PNG = SHOT_DIR + "/pool-del-b.png";
await assetPage.screenshot({ path: B_PNG });
await assetPage.close();

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(900);

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

const poolInfo = () =>
  page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll("[data-pooled-image]"));
    return {
      count: tiles.length,
      kinds: tiles.map((t) => t.getAttribute("data-pooled-image-kind")),
      ids: tiles.map((t) => t.getAttribute("data-pooled-image")),
      hasRemove: tiles.every((t) => Boolean(t.querySelector("[data-pooled-image-remove]"))),
      picked: tiles.filter((t) => t.getAttribute("data-pooled-image-picked") === "1").length
    };
  });

// ---------- 准备：导入两张原稿 ----------
await clickByText("导入图片");
await sleep(700);
await (await page.$("[data-import-images-input]")).uploadFile(A_PNG, B_PNG);
await sleep(2600);
await page.click("[data-import-confirm]");
await sleep(2800);

// 导入只进素材库，要变成胶片页得把它拖到胶片栏上
async function materialToPage(index = 0) {
  await page.click('[data-tool="images"]');
  await sleep(700);
  await page.evaluate((i) => {
    const tile = Array.from(document.querySelectorAll("[data-pooled-image]"))[i];
    const list = document.querySelector("[data-thumb-list]");
    if (!tile || !list) return;
    const dataTransfer = new DataTransfer();
    tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer };
    list.dispatchEvent(new DragEvent("dragover", options));
    list.dispatchEvent(new DragEvent("drop", options));
  }, index);
  await sleep(2000);
}

await materialToPage();
await page.click('[data-tool="images"]');
await sleep(800);

const base = await poolInfo();
record("两张原稿进入图片池", base.count === 2, "图片数=" + base.count);
record("每张缩略图都有「移除」按钮", base.hasRemove, base.hasRemove ? "都有" : "有缺失");
record("常驻副本被标记为可删除（kind=stored）", base.kinds.every((k) => k === "stored"), base.kinds.join(","));

const libBefore = readLibrary();
record("uploads/ 里确实存了两张", libBefore.images.length === 2, "库内=" + libBefore.images.length);
await page.screenshot({ path: SHOT_DIR + "/pool-delete-before.png" });

// ---------- 1) 单张移除 ----------
const removed = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  const id = tile.getAttribute("data-pooled-image");
  tile.querySelector("[data-pooled-image-remove]").click();
  return id;
});
await sleep(1200);

const afterOne = await poolInfo();
record("点「移除」后这张从列表消失", afterOne.count === 1, "移除前=" + base.count + " 移除后=" + afterOne.count);
record("被移除的不是列表里剩的那张", !afterOne.ids.includes(removed), "移除的 id=" + removed + " 剩下=" + afterOne.ids.join(","));

const libAfterOne = readLibrary();
record(
  "单张「移除」只记移除记录，不删 uploads/ 里的副本",
  libAfterOne.images.length === 2 && libAfterOne.hidden.length >= 1,
  "库内=" + libAfterOne.images.length + " 移除记录=" + libAfterOne.hidden.length
);

// ---------- 2) 刷新后仍然不显示 ----------
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1400);
await page.click('[data-tool="images"]');
await sleep(1000);
const afterReload = await poolInfo();
record("刷新后被删的图没有回来", afterReload.count === 1, "刷新后图片数=" + afterReload.count);

// ---------- 3) 恢复已移除 ----------
const restored = await page.evaluate(() => {
  const button = document.querySelector("[data-pool-restore]");
  if (!button) return false;
  button.click();
  return true;
});
await sleep(1000);
const afterRestore = await poolInfo();
record(
  "「恢复已移除」把图找回来",
  restored && afterRestore.count > afterReload.count,
  "恢复前=" + afterReload.count + " 恢复后=" + afterRestore.count
);

const libRestored = readLibrary();
record("恢复后移除记录清空", libRestored.hidden.length === 0, "移除记录=" + libRestored.hidden.length);

// ---------- 4) 多选批量删除 ----------
const selectToggle = await page.$("[data-pool-select-toggle]");
record("有「多选」入口", Boolean(selectToggle));
await page.evaluate(() => document.querySelector("[data-pool-select-toggle]")?.click());
await sleep(500);

const toolbar = await page.evaluate(() => ({
  hasSelectAll: Boolean(document.querySelector("[data-pool-select-all]")),
  hasDelete: Boolean(document.querySelector("[data-pool-delete-selected]")),
  deleteDisabled: document.querySelector("[data-pool-delete-selected]")?.disabled ?? null
}));
record(
  "进入多选后出现全选与删除选中",
  toolbar.hasSelectAll && toolbar.hasDelete,
  "全选=" + toolbar.hasSelectAll + " 删除=" + toolbar.hasDelete
);
record("没勾选时删除按钮是灰的", toolbar.deleteDisabled === true, "禁用=" + toolbar.deleteDisabled);

await page.evaluate(() => document.querySelector("[data-pool-select-all]")?.click());
await sleep(400);
const allPicked = await poolInfo();
record("全选会勾上所有缩略图", allPicked.picked === allPicked.count && allPicked.count > 0, "勾选=" + allPicked.picked + "/" + allPicked.count);
await page.screenshot({ path: SHOT_DIR + "/pool-delete-multi.png" });

const libBeforeBulk = readLibrary();
await page.evaluate(() => document.querySelector("[data-pool-delete-selected]")?.click());
await sleep(1600);
const afterBulk = await poolInfo();
const libAfterBulk = readLibrary();
record("批量删除后列表清空", afterBulk.count === 0, "剩余=" + afterBulk.count);
record(
  "「删除选中」把 uploads/ 里的副本真正删掉了",
  libAfterBulk.images.length === 0 && libBeforeBulk.images.length > 0,
  "删除前库内=" + libBeforeBulk.images.length + " 删除后=" + libAfterBulk.images.length
);

// ---------- 5) 项目里正在用的图：移除不破坏画面 ----------
await page.evaluate(() => document.querySelector("[data-pool-select-toggle]")?.click());
await sleep(400);

// 导入一张新图，拖成胶片页，让它同时成为底图（项目引用）
await clickByText("导入图片");
await sleep(700);
await (await page.$("[data-import-images-input]")).uploadFile(A_PNG);
await sleep(2400);
await page.click("[data-import-confirm]");
await sleep(2600);
await materialToPage();
await page.click('[data-tool="images"]');
await sleep(900);

const mixed = await poolInfo();
// 同一张图既在 uploads/ 又当底图时，池子按 stored 展示（副本优先），这是预期行为。
// 这里要验的是：移除掉它之后画面不受影响。
const liveTile = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  return tile ? tile.getAttribute("data-pooled-image") : null;
});
record("重新导入的图回到池子里", mixed.count >= 1, "图片数=" + mixed.count + " 类型=" + mixed.kinds.join(","));

const colorBefore = await page.evaluate(() => {
  const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = list[0].width;
  off.height = list[0].height;
  const ctx = off.getContext("2d");
  for (const c of list) ctx.drawImage(c, 0, 0, off.width, off.height);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  let hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 20) < 26 && Math.abs(d[i + 1] - 184) < 26 && Math.abs(d[i + 2] - 166) < 26) hit += 1;
  }
  return hit;
});
record("画面上的底图颜色可见", colorBefore > 0, "青色像素=" + colorBefore);

if (liveTile) {
  await page.evaluate((id) => {
    document.querySelector('[data-pooled-image-remove="' + id + '"]')?.click();
  }, liveTile);
  await sleep(1200);
}

const colorAfter = await page.evaluate(() => {
  const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = list[0].width;
  off.height = list[0].height;
  const ctx = off.getContext("2d");
  for (const c of list) ctx.drawImage(c, 0, 0, off.width, off.height);
  const d = ctx.getImageData(0, 0, off.width, off.height).data;
  let hit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - 20) < 26 && Math.abs(d[i + 1] - 184) < 26 && Math.abs(d[i + 2] - 166) < 26) hit += 1;
  }
  return hit;
});
record(
  "移除项目在用的图，画面完全不受影响",
  colorAfter === colorBefore,
  "移除前=" + colorBefore + " 移除后=" + colorAfter
);
await page.screenshot({ path: SHOT_DIR + "/pool-delete-after.png" });

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
