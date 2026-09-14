import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

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

const readFields = () =>
  page.evaluate(() => {
    const values = {};
    for (const label of document.querySelectorAll("aside label")) {
      const name = (label.querySelector("span")?.innerText ?? "").trim().toLowerCase();
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

// 坐标换算：把画布坐标换成屏幕坐标
const toScreen = (worldX, worldY) =>
  page.evaluate(
    (x, y) => {
      const canvasEl = document.querySelector(".studio-workspace canvas");
      const rect = canvasEl.getBoundingClientRect();
      const match = document.body.innerText.match(/Canvas\s+(\d+)\s*x\s*(\d+)/);
      const zoom = canvasEl.width / Number(match[1]);
      return { x: rect.left + x * zoom, y: rect.top + y * zoom };
    },
    worldX,
    worldY
  );

// 建一个椭圆分镜
await clickByText("布局");
await sleep(500);
await clickByText("椭圆分镜");
await sleep(900);
await clickByText("关闭");
await sleep(500);

const before = await readFields();
record(
  "椭圆分镜已创建并选中",
  Number.isFinite(before["width"]) && Number.isFinite(before["height"]),
  "W=" + before["width"] + " H=" + before["height"]
);

// 椭圆应当拿到 Transformer 的四角缩放手柄
const handleCount = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = canvases[0].width;
  off.height = canvases[0].height;
  const ctx = off.getContext("2d");
  for (const item of canvases) {
    ctx.drawImage(item, 0, 0, off.width, off.height);
  }
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  const clusters = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const isAnchor =
      (Math.abs(r - 191) < 14 && Math.abs(g - 219) < 14 && Math.abs(b - 254) < 14) ||
      (Math.abs(r - 37) < 26 && Math.abs(g - 99) < 26 && Math.abs(b - 235) < 26);
    if (isAnchor) {
      const pixel = index / 4;
      const x = pixel % off.width;
      const y = (pixel - x) / off.width;
      const key = Math.round(x / 14) + ":" + Math.round(y / 14);
      const found = clusters.get(key) || { n: 0 };
      found.n += 1;
      clusters.set(key, found);
    }
  }
  return Array.from(clusters.values()).filter((entry) => entry.n >= 20).length;
});
record("椭圆分镜显示出四角缩放手柄", handleCount >= 4, "识别到 " + handleCount + " 个手柄簇");

// 拖右下角的缩放手柄
const corner = await toScreen(before["x"] + before["width"], before["y"] + before["height"]);
await page.mouse.move(corner.x, corner.y);
await sleep(200);
await page.mouse.down();
await page.mouse.move(corner.x + 90, corner.y + 90, { steps: 14 });
await page.mouse.up();
await sleep(900);

const after = await readFields();
const grew = after["width"] > before["width"] + 20 || after["height"] > before["height"] + 20;
record(
  "椭圆分镜可以拖角缩放",
  grew,
  "W " + before["width"] + " → " + after["width"] + "   H " + before["height"] + " → " + after["height"]
);

const ratioBefore = before["width"] / before["height"];
const ratioAfter = after["width"] / after["height"];
record(
  "缩放按比例进行，椭圆不会被拉扁",
  Math.abs(ratioAfter - ratioBefore) < 0.02,
  "宽高比 " + ratioBefore.toFixed(3) + " → " + ratioAfter.toFixed(3)
);

// 再拖一次，确认可反复缩放且依然等比
const corner2 = await toScreen(after["x"] + after["width"], after["y"] + after["height"]);
await page.mouse.move(corner2.x, corner2.y);
await sleep(200);
await page.mouse.down();
await page.mouse.move(corner2.x - 60, corner2.y - 60, { steps: 12 });
await page.mouse.up();
await sleep(900);
const after2 = await readFields();
record(
  "可以反复缩放，比例始终不变",
  after2["width"] < after["width"] &&
    Math.abs(after2["width"] / after2["height"] - ratioBefore) < 0.02,
  "W " + after["width"] + " → " + after2["width"] + "，比例 " + (after2["width"] / after2["height"]).toFixed(3)
);

// 画面确实变大了：椭圆面积应当增加
await page.screenshot({ path: SHOT_DIR + "/ellipse-scale.png" });

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
