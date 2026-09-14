import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = "D:/dsh工作区/_shots";

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

function readPanelField(labelText) {
  return page.evaluate((wanted) => {
    for (const label of Array.from(document.querySelectorAll("label"))) {
      const span = label.querySelector("span");
      if (span && span.textContent.trim() === wanted) {
        const input = label.querySelector('input[type="number"]');
        if (input) {
          return Number(input.value);
        }
      }
    }
    return null;
  }, labelText);
}

// 准备一张测试图
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 1000, height: 700 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:linear-gradient(45deg,#0e7490,#7c3aed)"></body>');
const imgPath = SHOT_DIR + "/edit-controls-src.png";
await assetPage.screenshot({ path: imgPath });
await assetPage.close();

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(600);

// 新页面默认不含分镜（底层只有铺满的纯色底），需要时用「布局」抽屉里的「新建分镜」加一个
async function addPanel() {
  await clickByText("布局");
  await sleep(500);
  await clickByText("新建分镜");
  await sleep(700);
  await clickByText("关闭");
  await sleep(400);
}
await addPanel();

// ---------- 1) 裁剪框角手柄 ----------
const canvasBox = await (await page.$(".studio-workspace > div")).boundingBox();
await page.mouse.click(canvasBox.x + 120, canvasBox.y + 120);
await sleep(700);

const fileInput = await page.$("[data-panel-image-input]");
await fileInput.uploadFile(imgPath);
await sleep(3000);

const cropButton = await clickByText("打开手动裁剪");
await sleep(1200);

const cornersBefore = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-crop-corner]")).map((el) => ({
    corner: el.getAttribute("data-crop-corner"),
    left: el.style.left,
    top: el.style.top
  }))
);
record("裁剪框提供 4 个角手柄", cornersBefore.length === 4, "角数=" + cornersBefore.length);

const frameBefore = await page.evaluate(() => {
  const frame = document.querySelector("[data-crop-frame]");
  return frame ? { w: frame.style.width, h: frame.style.height } : null;
});

// 诊断：角手柄位置实际命中的元素
const cornerHit = await page.evaluate(() => {
  const el = document.querySelector('[data-crop-corner="bottomRight"]');
  if (!el) return "手柄不存在";
  const rect = el.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!hit) return "命中空";
  return (
    hit.tagName +
    " | corner=" + (hit.getAttribute("data-crop-corner") ?? "-") +
    " | edgeHandle=" + (hit.getAttribute("data-crop-edge-handle") ?? "-") +
    " | cls=" + String(hit.className).slice(0, 40)
  );
});
console.log("  [诊断] 右下角命中: " + cornerHit);

// 先做对照：边手柄是否可用
const edgeBefore = await page.evaluate(() => {
  const frame = document.querySelector("[data-crop-frame]");
  return frame ? { w: frame.style.width, h: frame.style.height } : null;
});
const edgeHandle = process.env.SKIP_EDGE ? null : await page.$('[data-crop-edge-handle="right"]');
if (edgeHandle) {
  const eb = await edgeHandle.boundingBox();
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.move(eb.x - 70, eb.y, { steps: 8 });
  await sleep(150);
  await page.mouse.up();
  await sleep(700);
}
const edgeAfter = await page.evaluate(() => {
  const frame = document.querySelector("[data-crop-frame]");
  return frame ? { w: frame.style.width, h: frame.style.height } : null;
});
console.log(
  "  [对照] 边手柄: " + (edgeBefore ? edgeBefore.w : "?") + " → " + (edgeAfter ? edgeAfter.w : "?")
);

// 拖动右下角
const target = await page.$('[data-crop-corner="bottomRight"]');
if (target) {
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(120);
  await page.mouse.move(box.x - 90, box.y - 70, { steps: 8 });
  await sleep(150);
  await page.mouse.up();
  await sleep(700);
}

const frameAfter = await page.evaluate(() => {
  const frame = document.querySelector("[data-crop-frame]");
  return frame ? { w: frame.style.width, h: frame.style.height } : null;
});
record(
  "拖动角手柄可缩放裁剪框",
  Boolean(frameBefore && frameAfter) && (frameBefore.w !== frameAfter.w || frameBefore.h !== frameAfter.h),
  (frameBefore ? frameBefore.w + "×" + frameBefore.h : "?") + " → " + (frameAfter ? frameAfter.w + "×" + frameAfter.h : "?")
);
await page.screenshot({ path: SHOT_DIR + "/crop-corner-handles.png" });

await clickByText("关闭");
await sleep(600);

// ---------- 2) 多边形顶点拖拽 ----------
await clickByText("分镜模式");
await sleep(400);
await clickByText("多边形");
await sleep(500);

const polyBox = await (await page.$(".studio-workspace > div")).boundingBox();
const polyPoints = [
  [polyBox.x + 150, polyBox.y + 120],
  [polyBox.x + 420, polyBox.y + 180],
  [polyBox.x + 380, polyBox.y + 430]
];
for (const [x, y] of polyPoints) {
  await page.mouse.click(x, y);
  await sleep(180);
}
await page.keyboard.press("Enter");
await sleep(900);

// 取景状态下顶点手柄是被隐藏的（避免误拖已有分镜），编辑前先退出扣选
await clickByText("退出扣选");
await sleep(700);

const sizeBefore = { w: await readPanelField("Width"), h: await readPanelField("Height") };
record("多边形分镜已创建并可读取尺寸", sizeBefore.w !== null, "W=" + sizeBefore.w + " H=" + sizeBefore.h);

// 退出取景后提示条消失、画布会上移，必须重新测量位置
const afterExitBox = await (await page.$(".studio-workspace > div")).boundingBox();
const vertexHit = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  return canvas ? canvas.getBoundingClientRect().width : 0;
});
record("画布可交互", vertexHit > 0, "画布宽=" + Math.round(vertexHit));

// 顶点手柄绘制在 Konva 画布上，按顶点坐标直接拖动
await page.mouse.move(afterExitBox.x + 420, afterExitBox.y + 180);
await page.mouse.down();
await sleep(150);
await page.mouse.move(afterExitBox.x + 520, afterExitBox.y + 300, { steps: 10 });
await sleep(200);
await page.mouse.up();
await sleep(900);

const sizeAfter = { w: await readPanelField("Width"), h: await readPanelField("Height") };
record(
  "拖动多边形顶点会改变分镜形状",
  sizeAfter.w !== sizeBefore.w || sizeAfter.h !== sizeBefore.h,
  "W " + sizeBefore.w + "→" + sizeAfter.w + " / H " + sizeBefore.h + "→" + sizeAfter.h
);
await page.screenshot({ path: SHOT_DIR + "/polygon-vertex-drag.png" });

// ---------- 3) 闭合提示 ----------
// 上一步为编辑顶点已退出取景，这里重新开启多边形工具
await clickByText("多边形");
await sleep(700);
const polyBox3 = await (await page.$(".studio-workspace > div")).boundingBox();
const hintBefore = await page.evaluate(() => document.body.innerText.includes("依次单击取点"));
record("未满 3 点显示取点提示", hintBefore);

await page.mouse.click(polyBox3.x + 180, polyBox3.y + 200);
await sleep(200);
await page.mouse.click(polyBox3.x + 420, polyBox3.y + 330);
await sleep(200);
await page.mouse.click(polyBox3.x + 300, polyBox3.y + 470);
await sleep(400);

const hintState = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    enter: text.includes("Enter"),
    closeButton: text.includes("完成闭合"),
    retry: text.includes("重来")
  };
});
console.log("  提示条: " + JSON.stringify(await page.evaluate(() => {
  const bar = document.querySelector('[data-polygon-hint]');
  return bar ? bar.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : "(未找到)";
})));

record(
  "满 3 点后显示 Enter 与完成闭合按钮",
  hintState.enter && hintState.closeButton && hintState.retry,
  JSON.stringify(hintState)
);
await page.screenshot({ path: SHOT_DIR + "/polygon-close-hint.png" });

const panelsBefore = await page.evaluate(() => Number((document.body.innerText.match(/分镜\s*(\d+)/) ?? [0, -1])[1]));
await clickByText("完成闭合");
await sleep(900);
const panelsAfter = await page.evaluate(() => Number((document.body.innerText.match(/分镜\s*(\d+)/) ?? [0, -1])[1]));
record("点击完成闭合可生成分镜", panelsAfter === panelsBefore + 1, "分镜 " + panelsBefore + " → " + panelsAfter);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
