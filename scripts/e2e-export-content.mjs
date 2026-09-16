import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "_shots";
const DL_DIR = process.env.TEMP ? process.env.TEMP + "\\mdl-downloads" : SHOT_DIR + "\\downloads";

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(DL_DIR.replace(/\\/g, "/"), { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

const COLORS = [
  { name: "红", hex: "#c0392b", probe: [192, 57, 43] },
  { name: "绿", hex: "#27ae60", probe: [39, 174, 96] },
  { name: "蓝", hex: "#2980b9", probe: [41, 128, 185] }
];

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

// 造三张大尺寸纯色素材。尺寸要和真实原稿同级——解码耗时取决于像素数量，
// 用几百像素的小图跑不出切页竞态，测了也发现不了问题。
const assetPage = await browser.newPage();
await assetPage.setContent('<!doctype html><body style="margin:0"><canvas id="probe"></canvas></body>');
const sources = [];
for (let index = 0; index < COLORS.length; index += 1) {
  const dataUrl = await assetPage.evaluate((hex) => {
    const canvas = document.getElementById("probe");
    canvas.width = 2400;
    canvas.height = 3200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }, COLORS[index].hex);
  const target = join(SHOT_DIR, "zip-content-" + (index + 1) + ".png");
  writeFileSync(target, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  sources.push(target);
}
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

// 导入三张原稿
await clickByText("导入图片");
await sleep(800);
const importInput = await page.$("[data-import-images-input]");
await importInput.uploadFile(...sources);
await sleep(3000);
await page.click("[data-import-confirm]");
await sleep(3000);

async function materialsToPages(count) {
  await page.click('[data-tool="images"]');
  await sleep(700);
  for (let index = 0; index < count; index += 1) {
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
    await sleep(1800);
  }
  // 用完把左栏切回预设，后面的用例还要点预设卡片
  await page.click('[data-tool="presets"]');
  await sleep(600);
}

await materialsToPages(3);

const pageCount = await page.evaluate(() => document.querySelectorAll("[data-thumb-index]").length);
record("导入后共 " + pageCount + " 页", pageCount >= 4, "页数=" + pageCount);

// 给后三页各建一个分镜，并放进对应的纯色图
for (let index = 0; index < COLORS.length; index += 1) {
  const thumbIndex = index + 1;
  await page.evaluate((target) => {
    document.querySelector('[data-thumb-index="' + target + '"]')?.click();
  }, thumbIndex);
  await sleep(900);

  await clickByText("布局");
  await sleep(500);
  await clickByText("新建分镜");
  await sleep(700);
  await clickByText("关闭");
  await sleep(500);

  const panelInput = await page.$("[data-panel-image-input]");
  if (!panelInput) {
    record("第 " + (thumbIndex + 1) + " 页拿到分镜图片输入", false, "未渲染");
    continue;
  }
  await panelInput.uploadFile(sources[index]);
  await sleep(2200);
}

await page.screenshot({ path: SHOT_DIR + "/zip-content-ready.png" });

// 导出 ZIP 并捕获 blob
await page.evaluate(() => {
  window.__zipBlob = null;
  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function (target) {
    if (target instanceof Blob && String(target.type).indexOf("zip") >= 0) {
      window.__zipBlob = target;
    }
    return originalCreate.call(this, target);
  };
});
await page.click('[data-tool="export"]');
await sleep(600);
await page.click("[data-export-zip]");
await sleep(1200);

let dataUrl = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(1000);
  dataUrl = await page.evaluate(async () => {
    const blob = window.__zipBlob;
    if (!blob) {
      return null;
    }
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  });
  if (dataUrl) {
    break;
  }
}

record("ZIP 导出完成", Boolean(dataUrl), dataUrl ? "已捕获" : "超时");

if (dataUrl) {
  const zipPath = join(DL_DIR, "content-check.zip");
  writeFileSync(zipPath, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const names = Object.keys(zip.files).filter((name) => name.endsWith(".png")).sort();
  record("ZIP 里页数与项目一致", names.length === pageCount, "包内 " + names.length + " 张，项目 " + pageCount + " 页");

  // 逐张解码，统计每种颜色各占多少像素
  const entries = [];
  for (const name of names) {
    const base64 = await zip.files[name].async("base64");
    entries.push({ name, base64 });
  }

  const analysed = await page.evaluate(async (list) => {
    const output = [];
    for (const entry of list) {
      const image = new Image();
      const loaded = await new Promise((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = "data:image/png;base64," + entry.base64;
      });
      if (!loaded) {
        output.push({ name: entry.name, ok: false });
        continue;
      }
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        if (r > 150 && g < 95 && b < 95) red += 1;
        else if (g > 130 && r < 95 && b < 120) green += 1;
        else if (b > 150 && r < 95 && g < 130) blue += 1;
      }
      output.push({ name: entry.name, ok: true, red, green, blue });
    }
    return output;
  }, entries);

  const withPicture = analysed.filter((item) => item.red + item.green + item.blue > 20000);
  console.log("  逐页颜色统计:");
  for (const item of analysed) {
    console.log("    " + item.name + " → 红=" + item.red + " 绿=" + item.green + " 蓝=" + item.blue);
  }

  record(
    "三张有色页面都带上了画面（隔一张缺图的问题已修）",
    withPicture.length >= 3,
    "含画面的页面数=" + withPicture.length + " / " + analysed.length
  );
}

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
