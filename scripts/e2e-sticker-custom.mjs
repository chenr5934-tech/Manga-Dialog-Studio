import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const ROOT = process.env.PROJECT_ROOT ?? "D:/dsh工作区/MangaDialogStudio";
const STICKER_DIR = join(ROOT, "stickers");

mkdirSync(STICKER_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});

// 先落两张真实图片文件：DataTransfer 的手工注入在跨 evaluate 时会被清空，
// uploadFile 是 puppeteer 对 file input 的标准做法，稳定得多
// 素材写到项目目录之外，避免污染版本库
const assetDir = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";
mkdirSync(assetDir, { recursive: true });
const widePng = join(assetDir, "sticker-wide.png");
const tallPng = join(assetDir, "sticker-tall.png");
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 400, height: 200 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#22c55e"></body>');
await assetPage.screenshot({ path: widePng });
await assetPage.setViewport({ width: 150, height: 450 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#a855f7"></body>');
await assetPage.screenshot({ path: tallPng });
await assetPage.close();

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let promptAnswer = "e2e-我的贴纸";
page.on("dialog", (dialog) => void dialog.accept(promptAnswer));

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(900);

const readOverlayFields = () =>
  page.evaluate(() => {
    const values = {};
    for (const label of document.querySelectorAll("aside label")) {
      const name = label.querySelector("span")?.innerText?.trim();
      const input = label.querySelector("input");
      if (name && input && typeof input.value === "string" && input.value !== "") {
        const numeric = Number(input.value);
        if (Number.isFinite(numeric)) {
          values[name] = numeric;
        }
      }
    }
    return values;
  });

async function openPicker() {
  await page.click("[data-hero-sticker]");
  await sleep(700);
}

// 1) 自定义分组
await openPicker();
const hasCustomGroup = await page.evaluate(() =>
  Boolean(document.querySelector('[data-sticker-group="自定义"]'))
);
record("贴纸面板提供自定义分组", hasCustomGroup);

await page.click('[data-sticker-group="自定义"]');
await sleep(500);
const importEntry = await page.evaluate(() => Boolean(document.querySelector("[data-sticker-import]")));
record("自定义分组提供导入入口", importEntry);

// 2) 导入两张不同长宽比的图片
const fileInput = await page.$("[data-sticker-file-input]");
if (!fileInput) {
  record("找到贴纸导入用的文件输入", false, "未渲染");
} else {
  await fileInput.uploadFile(widePng, tallPng);
}
await sleep(2200);

const customCount = await page.evaluate(() => document.querySelectorAll("[data-sticker-remove]").length);
record("导入的图片成为自定义贴纸", customCount === 2, "自定义贴纸数=" + customCount);

// 3) 加到画布，验证按原图比例而不是被拉成正方形
const firstId = await page.evaluate(
  () => document.querySelector("[data-sticker-remove]")?.getAttribute("data-sticker-remove") ?? null
);
await page.click('[data-sticker-id="' + firstId + '"]');
await sleep(800);
await page.click("[data-sticker-close]");
await sleep(800);

const fields = await readOverlayFields();
const ratio = fields["宽度"] && fields["高度"] ? fields["宽度"] / fields["高度"] : 0;
record(
  "自定义贴纸按原图比例摆放（400x200 应为 2:1）",
  Math.abs(ratio - 2) < 0.08,
  "宽度=" + fields["宽度"] + " 高度=" + fields["高度"] + " 比例=" + ratio.toFixed(3)
);

// 画布像素上也要是扁的
const boxProbe = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = canvases[0].width;
  off.height = canvases[0].height;
  const ctx = off.getContext("2d");
  for (const item of canvases) {
    ctx.drawImage(item, 0, 0, off.width, off.height);
  }
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  let minX = off.width;
  let minY = off.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 40) {
      continue;
    }
    if (
      Math.abs(data[index] - 34) < 30 &&
      Math.abs(data[index + 1] - 197) < 30 &&
      Math.abs(data[index + 2] - 94) < 30
    ) {
      const pixel = index / 4;
      const x = pixel % off.width;
      const y = (pixel - x) / off.width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      count += 1;
    }
  }
  return maxX < 0 ? null : { width: maxX - minX + 1, height: maxY - minY + 1, count };
});
record(
  "自定义贴纸在画布上确实是扁的",
  Boolean(boxProbe) && boxProbe.width > boxProbe.height * 1.8,
  boxProbe ? "像素 " + boxProbe.width + "x" + boxProbe.height + " 命中=" + boxProbe.count : "未找到绿色像素"
);

// 4) 存进 stickers/ 文件夹
await openPicker();
await page.click('[data-sticker-group="自定义"]');
await sleep(500);
await page.click("[data-sticker-save-library]");
await sleep(2200);
const savedFile = join(STICKER_DIR, "e2e-我的贴纸.json");
record(
  "保存到贴纸库真的写进 stickers/ 文件夹",
  existsSync(savedFile),
  existsSync(savedFile) ? "文件=" + readdirSync(STICKER_DIR).filter((n) => n.startsWith("e2e-")).join(",") : "未生成"
);

// 5) 从贴纸库读取
await page.click("[data-sticker-load-library]");
await sleep(1500);
const listed = await page.evaluate(() => document.querySelectorAll("[data-sticker-library-load]").length);
record("从贴纸库列出已保存的文件", listed >= 1, "列出 " + listed + " 个");

// 6) 删除单张自定义贴纸
await page.evaluate(() => {
  document.querySelector("[data-sticker-remove]")?.click();
});
await sleep(700);
const afterRemove = await page.evaluate(() => document.querySelectorAll("[data-sticker-remove]").length);
record("自定义贴纸可以单张删除", afterRemove === 1, "剩余=" + afterRemove);

// 7) 自定义贴纸存在浏览器本地，刷新后仍在
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1000);
await openPicker();
await page.click('[data-sticker-group="自定义"]');
await sleep(600);
const persisted = await page.evaluate(() => document.querySelectorAll("[data-sticker-remove]").length);
record("刷新页面后自定义贴纸仍在", persisted === 1, "剩余=" + persisted);

// 8) 项目文件里自定义贴纸能存活（sticker.image 分支）
// 用一张已知颜色的真实图片，便于用像素确认它确实被渲染出来
const wideDataUrl = "data:image/png;base64," + readFileSync(widePng).toString("base64");
const project = {
  id: "custom-sticker-roundtrip",
  name: "自定义贴纸往返",
  activePageId: "c1",
  pages: [
    {
      id: "c1",
      name: "第 1 页",
      canvas: { width: 800, height: 600, preset: "custom", dpi: 300 },
      backdropColor: "#ffffff",
      panels: [],
      bubbles: [],
      overlays: [
        {
          id: "cs-1",
          x: 80,
          y: 80,
          width: 300,
          height: 300,
          rotation: 0,
          image: "",
          sticker: {
            id: "custom-roundtrip",
            image: wideDataUrl,
            naturalWidth: 400,
            naturalHeight: 200
          }
        },
        {
          // 只有 id、没有图片的伪造贴纸，应当被安全丢弃
          id: "cs-bogus",
          x: 460,
          y: 80,
          width: 160,
          height: 160,
          rotation: 0,
          image: "",
          sticker: { id: "custom-bogus", naturalWidth: 1, naturalHeight: 1 }
        }
      ]
    }
  ]
};

await page.evaluate(() => {
  Object.defineProperty(window, "showDirectoryPicker", {
    value: undefined,
    configurable: true,
    writable: true
  });
});
await page.click("[data-sticker-close]");
await sleep(400);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => (element.innerText ?? "").trim() === "更多"
  );
  button?.click();
});
await sleep(500);
await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (element) => (element.innerText ?? "").trim() === "加载项目"
  );
  button?.click();
});
await sleep(900);
await page.evaluate((jsonText) => {
  const candidates = Array.from(document.querySelectorAll('input[type="file"]')).filter(
    (element) => typeof element.accept === "string" && element.accept.includes("json")
  );
  const input = candidates[candidates.length - 1];
  if (!input) {
    return;
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([jsonText], "custom-sticker.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, JSON.stringify(project));
await sleep(2600);

const roundTripProbe = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = canvases[0].width;
  off.height = canvases[0].height;
  const ctx = off.getContext("2d");
  for (const item of canvases) {
    ctx.drawImage(item, 0, 0, off.width, off.height);
  }
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  let green = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 40) {
      continue;
    }
    if (
      Math.abs(data[index] - 34) < 30 &&
      Math.abs(data[index + 1] - 197) < 30 &&
      Math.abs(data[index + 2] - 94) < 30
    ) {
      green += 1;
    }
  }
  return green;
});
record(
  "项目文件里的自定义贴纸不会被归一化丢掉",
  roundTripProbe > 3000,
  "恢复出的贴纸像素=" + roundTripProbe
);

const roundTripName = await page.evaluate(
  () => document.querySelector('input[placeholder="项目名称"]')?.value ?? null
);
record(
  "含自定义贴纸的项目能正常加载，伪造项被安全跳过",
  roundTripName === "自定义贴纸往返",
  "项目名=" + roundTripName
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

// 清理测试产生的贴纸库文件
for (const name of readdirSync(STICKER_DIR)) {
  if (name.startsWith("e2e-")) {
    unlinkSync(join(STICKER_DIR, name));
  }
}

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
