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
let dialogQueue = [];
page.on("dialog", (dialog) => {
  const answer = dialogQueue.shift() ?? true;
  void (answer ? dialog.accept() : dialog.dismiss());
});

// 造一张纯色原稿，颜色唯一，便于像素验证
const assetDir = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 500, height: 400 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#d946ef"></body>');
const sourcePng = assetDir + "/pool-source.png";
await assetPage.screenshot({ path: sourcePng });
await assetPage.close();

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(800);

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

// 只读底部状态栏：胶片栏的缩略图标签里也有「分镜 N」，全局匹配会抓到别的页
const readStats = () =>
  page.evaluate(() => {
    const footer = document.querySelector("footer");
    const text = footer ? footer.innerText : "";
    return {
      panels: Number((text.match(/分镜\s*(\d+)/) ?? [0, -1])[1]),
      raw: text.replace(/\s+/g, " ").slice(0, 60)
    };
  });

const colorHits = (target) =>
  page.evaluate((rgb) => {
    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs(data[index] - rgb[0]) < 26 &&
        Math.abs(data[index + 1] - rgb[1]) < 26 &&
        Math.abs(data[index + 2] - rgb[2]) < 26
      ) {
        count += 1;
      }
    }
    return count;
  }, target);

// ---------- 准备：导入原稿，让它进入图片池 ----------
await clickByText("导入图片");
await sleep(700);
const importInput = await page.$("[data-import-images-input]");
await importInput.uploadFile(sourcePng);
await sleep(2500);
await page.click("[data-import-confirm]");
await sleep(2500);

// ---------- 1) 图片池入口 ----------
await page.click('[data-tool="images"]');
await sleep(600);
const poolEntry = await page.evaluate(() => {
  const button = document.querySelector('[data-tool="images"]');
  const tiles = document.querySelectorAll("[data-pooled-image]");
  return {
    label: button ? (button.innerText ?? "").trim() : "",
    tiles: tiles.length,
    hasPool: Boolean(document.querySelector('[data-image-pool="1"]'))
  };
});
record("左侧有「已导入图片」栏", poolEntry.hasPool && poolEntry.label.includes("已导入图片"), poolEntry.label);
record("导入的原稿出现在图片池里", poolEntry.tiles >= 1, "图片数=" + poolEntry.tiles);
await page.screenshot({ path: SHOT_DIR + "/image-pool.png" });

// ---------- 2) 拖到空白处 → 在上层新建图片 ----------
const PINK = [217, 70, 239];

// 先清掉原稿底图：它本身就是粉色，会干扰像素判定
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => (element.innerText ?? "").trim() === "更多"
  );
  void button;
});
const dropBlank = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  const canvas = document.querySelector(".studio-workspace > div");
  if (!tile || !canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + rect.width * 0.3;
  const clientY = rect.top + rect.height * 0.3;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY };
  canvas.dispatchEvent(new DragEvent("dragover", options));
  canvas.dispatchEvent(new DragEvent("drop", options));
  return { offsetX: clientX - rect.left, offsetY: clientY - rect.top };
});
await sleep(1200);

const overlaySelected = await page.evaluate(() => document.body.innerText.includes("图片层"));
record(
  "拖到空白处会在上层新建图片层",
  Boolean(dropBlank) && overlaySelected,
  overlaySelected ? "属性面板已切到图片层" : "未生成图片层"
);

const overlayFields = await page.evaluate(() => {
  const values = {};
  for (const label of document.querySelectorAll("aside label")) {
    const name = label.querySelector("span")?.innerText?.trim();
    const input = label.querySelector("input");
    // 界面是中文，标签也是中文；映射回测试里用的英文键
    const alias = { "x 坐标": "X", "y 坐标": "Y" }[(name ?? "").toLowerCase()] ?? name;
    if (name && input && typeof input.value === "string" && input.value !== "") {
      const numeric = Number(input.value);
      if (Number.isFinite(numeric)) {
        values[alias] = numeric;
      }
    }
  }
  return values;
});
const overlayCenterX = Number.isFinite(overlayFields["X"])
  ? overlayFields["X"] + overlayFields["宽度"] / 2
  : null;
record(
  "新建的图片落在指针位置而不是居中",
  overlayCenterX !== null && Math.abs(overlayCenterX - (dropBlank?.offsetX ?? 0) * 2.18) < 60,
  "图片中心=" + Math.round(overlayCenterX ?? 0) + " 指针=" + Math.round((dropBlank?.offsetX ?? 0) * 2.18)
);
await page.screenshot({ path: SHOT_DIR + "/image-pool-overlay.png" });

// ---------- 3) 拖到分镜上 → 先问，再决定 ----------
await clickByText("布局");
await sleep(500);
await clickByText("新建分镜");
await sleep(700);
await clickByText("关闭");
await sleep(500);

const panelCountBefore = (await readStats()).panels;
const statusLine = await page.evaluate(() => (document.body.innerText.match(/分镜[^\n]{0,12}/g) ?? []).join(" | "));
console.log("  诊断：新建分镜后页面上出现的分镜字样 = " + statusLine);
const dropOnPanel = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  const canvas = document.querySelector(".studio-workspace > div");
  if (!tile || !canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  // 分镜是新建后铺在画面上的，取中间区域基本必然命中
  const clientX = rect.left + rect.width * 0.5;
  const clientY = rect.top + rect.height * 0.5;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY };
  canvas.dispatchEvent(new DragEvent("dragover", options));
  canvas.dispatchEvent(new DragEvent("drop", options));
  return true;
});

// 接受确认框：图片应当进分镜
dialogQueue = [true];
await sleep(1800);
const panelGotImage = await page.evaluate(() => document.body.innerText.includes("打开手动裁剪"));
record(
  "拖到分镜上并确认后，图片进入分镜",
  Boolean(dropOnPanel) && panelGotImage,
  panelGotImage ? "属性面板出现裁剪入口" : "分镜没有拿到图片"
);
const statsAfterDrop = await readStats();
record(
  "拖到分镜上不会新增分镜",
  statsAfterDrop.panels === panelCountBefore,
  "分镜 " + panelCountBefore + " → " + statsAfterDrop.panels + "（状态栏：" + statsAfterDrop.raw + "）"
);

// 再拖一次并取消：应当改为在上层新建图片
dialogQueue = [false];
await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  const canvas = document.querySelector(".studio-workspace > div");
  if (!tile || !canvas) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + rect.width * 0.62;
  const clientY = rect.top + rect.height * 0.55;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY };
  canvas.dispatchEvent(new DragEvent("dragover", options));
  canvas.dispatchEvent(new DragEvent("drop", options));
});
await sleep(1800);
const overlayAfterCancel = await page.evaluate(() => document.body.innerText.includes("图片层"));
record(
  "在确认框里选取消，会改为在上层新建图片",
  overlayAfterCancel,
  overlayAfterCancel ? "属性面板切到图片层" : "没有生成图片层"
);

// ---------- 4) 导出未完成作品 ----------
await page.evaluate(() => {
  window.__jsonBlob = null;
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function (target) {
    if (target instanceof Blob && String(target.type).indexOf("json") >= 0) {
      window.__jsonBlob = target;
    }
    return originalCreate.call(this, target);
  };
});

await page.click('[data-tool="export"]');
await sleep(600);
const hasExportProject = await page.evaluate(() => Boolean(document.querySelector("[data-export-project]")));
record("导出面板里有「导出未完成作品」按钮", hasExportProject);

await page.click("[data-export-project]");
await sleep(2500);

const exported = await page.evaluate(async () => {
  const blob = window.__jsonBlob;
  if (!blob) {
    return null;
  }
  const text = await blob.text();
  // history 在文件后部，只截头部会漏判，这里直接解析顶层键
  let keys = null;
  let embeddedImages = 0;
  try {
    const parsed = JSON.parse(text);
    keys = Object.keys(parsed);
    // 图片嵌在 layout.pages 里，位置靠后，只截头部会漏判
    for (const pageItem of parsed?.layout?.pages ?? []) {
      const candidates = [
        pageItem?.background?.original,
        ...(pageItem?.panels ?? []).map((panel) => panel?.image?.original),
        ...(pageItem?.overlays ?? []).map((overlay) => overlay?.image),
        ...(pageItem?.bubbles ?? []).map((bubble) => bubble?.image)
      ];
      for (const value of candidates) {
        if (typeof value === "string" && value.startsWith("data:")) {
          embeddedImages += 1;
        }
      }
    }
  } catch {
    keys = null;
  }
  return { size: blob.size, full: text.length, keys, embeddedImages };
});
record(
  "点它会下载一个作品文件",
  Boolean(exported) && exported.size > 1000,
  exported ? exported.size + " bytes" : "没有捕获到文件"
);
record(
  "文件内容是完整的项目数据",
  Boolean(exported && exported.keys) && exported.keys.includes("layout"),
  exported ? "顶层字段 " + (exported.keys ?? []).join(",") + " · 总长 " + exported.full + " 字符" : "无内容"
);
record(
  "文件里内嵌了图片数据",
  Boolean(exported) && exported.embeddedImages > 0,
  "内嵌图片=" + (exported?.embeddedImages ?? 0) + " 张"
);
record(
  "文件里带上了编辑历史，便于接续编辑",
  Boolean(exported && exported.keys) && exported.keys.includes("history"),
  exported && exported.keys ? exported.keys.join(",") : ""
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
