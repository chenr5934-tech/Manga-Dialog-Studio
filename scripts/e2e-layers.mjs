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
await assetPage.setContent('<!doctype html><body style="margin:0;background:#dc2626"></body>');
const RED_PNG = SHOT_DIR + "/layers-red.png";
await assetPage.screenshot({ path: RED_PNG });
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

const openLayers = async () => {
  if (!(await page.$("[data-layer-panel]"))) {
    const opened = await page.evaluate(() => {
      const button = document.querySelector("[data-open-layers]");
      if (!button) return false;
      button.click();
      return true;
    });
    if (!opened) {
      await clickByText("画布内容");
    }
    await sleep(600);
  }
};

const layerRows = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-layer-row]")).map((row) => ({
      id: row.getAttribute("data-layer-row"),
      kind: row.getAttribute("data-layer-kind"),
      selected: row.getAttribute("data-layer-selected") === "1",
      text: (row.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 40)
    }))
  );

// 取画布上某个颜色的像素数
const colorRatio = (rgb) =>
  page.evaluate((target) => {
    const list = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    const off = document.createElement("canvas");
    off.width = list[0].width;
    off.height = list[0].height;
    const ctx = off.getContext("2d");
    for (const c of list) ctx.drawImage(c, 0, 0, off.width, off.height);
    const d = ctx.getImageData(0, 0, off.width, off.height).data;
    let hit = 0;
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      total += 1;
      if (Math.abs(d[i] - target[0]) < 24 && Math.abs(d[i + 1] - target[1]) < 24 && Math.abs(d[i + 2] - target[2]) < 24) {
        hit += 1;
      }
    }
    return total > 0 ? hit / total : 0;
  }, rgb);

// ---------- 准备：分镜 + 气泡 ----------
await clickByText("布局");
await sleep(500);
await clickByText("新建分镜");
await sleep(700);
await clickByText("关闭");
await sleep(400);
await clickByText("对话框预设");
await sleep(500);
await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
await sleep(700);

// ---------- 1) 面板列出画布内容 ----------
await openLayers();
const base = await layerRows();
record("图层入口能打开画布内容面板", base.length > 0, "列出 " + base.length + " 项");
record(
  "分镜与气泡都在列表里",
  base.some((r) => r.kind === "panel") && base.some((r) => r.kind === "bubble"),
  base.map((r) => r.kind).join(",")
);
record("列表第一行是最顶层", base.length > 1, base.map((r) => r.text.slice(0, 8)).join(" | "));
await page.screenshot({ path: SHOT_DIR + "/layers-panel.png" });

// ---------- 2) 点列表能选中 ----------
await page.evaluate(() => {
  const row = document.querySelector('[data-layer-row][data-layer-kind="panel"] [data-layer-pick]');
  row?.click();
});
await sleep(700);
const picked = await layerRows();
const panelSelected = picked.find((r) => r.kind === "panel")?.selected;
record("点列表里的一项就把画布上那个选中了", panelSelected === true, "分镜选中=" + panelSelected);

// ---------- 3) 层序按钮真的改顺序 ----------
const bubbleId = (await layerRows()).find((r) => r.kind === "bubble")?.id;
// 先把气泡压到底，再置顶，这样才看得出真的动了
await page.evaluate((id) => {
  document.querySelector('[data-layer-move-id="' + id + '"][data-layer-move="bottom"]')?.click();
}, bubbleId);
await sleep(800);
const orderBottom = (await layerRows()).map((r) => r.id);
record(
  "「置于底层」把气泡挪到最后一行",
  orderBottom[orderBottom.length - 1] === bubbleId,
  "底层=" + orderBottom[orderBottom.length - 1]?.slice(0, 10)
);

await page.evaluate((id) => {
  document.querySelector('[data-layer-move-id="' + id + '"][data-layer-move="top"]')?.click();
}, bubbleId);
await sleep(800);
const orderAfterTop = (await layerRows()).map((r) => r.id);
record(
  "「置于顶层」把气泡挪回第一行",
  orderAfterTop[0] === bubbleId && orderBottom.join() !== orderAfterTop.join(),
  "顶层=" + orderAfterTop[0]?.slice(0, 10)
);

// ---------- 4) 被盖住的东西仍然能选中（核心痛点） ----------
// 导入一张图并铺满画布，把下面所有东西盖住
await clickByText("导入图片");
await sleep(700);
await (await page.$("[data-import-images-input]")).uploadFile(RED_PNG);
await sleep(2400);
await page.click("[data-import-confirm]");
await sleep(2600);
await page.click('[data-tool="images"]');
await sleep(800);

// 导入原稿会新增页面，而图层面板看的是当前页。
// 切回有分镜和气泡的那一页，才能验证「被盖住的东西还能不能选中」。
const firstPageId = await page.evaluate(() =>
  document.querySelector("[data-page-thumb]")?.getAttribute("data-page-thumb")
);
await page.evaluate((id) => {
  document.querySelector('[data-page-thumb="' + id + '"]')?.click();
}, firstPageId);
await sleep(900);

await page.click('[data-tool="images"]');
await sleep(700);
const tileId = await page.evaluate(() => document.querySelector("[data-pooled-image]")?.getAttribute("data-pooled-image"));
await page.evaluate((id) => document.querySelector('[data-pooled-image-tile="' + id + '"]')?.click(), tileId);
await sleep(1200);
await page.evaluate(() => document.querySelector('[data-fill-apply="1"]')?.click());
await sleep(2600);

const redCover = await colorRatio([220, 38, 38]);
record("铺满后画面被这张图盖住", redCover > 0.5, "红色占 " + (redCover * 100).toFixed(1) + "%");

await openLayers();
const covered = await layerRows();
record("盖住之后下层内容仍然列在面板里", covered.length >= 3, "列出 " + covered.length + " 项");

await page.evaluate(() => {
  const row = document.querySelector('[data-layer-row][data-layer-kind="panel"] [data-layer-pick]');
  row?.click();
});
await sleep(700);
const stillPickable = (await layerRows()).find((r) => r.kind === "panel")?.selected;
record(
  "被盖住的分镜照样能选中（画布上点不到，列表里点得到）",
  stillPickable === true,
  "选中=" + stillPickable
);
await page.screenshot({ path: SHOT_DIR + "/layers-covered.png" });

// ---------- 5) 把盖住的那层沉到底，下层重新露出 ----------
const coverId = (await layerRows()).find((r) => r.kind === "overlay")?.id;
await page.evaluate((id) => {
  document.querySelector('[data-layer-move-id="' + id + '"][data-layer-move="bottom"]')?.click();
}, coverId);
await sleep(1000);

const afterSink = await layerRows();
record(
  "把铺满层置底后它排到最后一行",
  afterSink[afterSink.length - 1]?.id === coverId,
  "底层=" + afterSink[afterSink.length - 1]?.kind
);

// ---------- 6) 属性面板也有一排层序按钮 ----------
await page.evaluate(() => document.querySelector('[data-layer-back="1"]')?.click());
await sleep(600);
const hasActions = await page.evaluate(() => document.querySelectorAll("[data-layer-action]").length);
record("属性面板底部也提供置顶/上移/下移/置底", hasActions === 4, "按钮数=" + hasActions);

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
