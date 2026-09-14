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
page.on("dialog", (dialog) => void dialog.accept());

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

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(700);

// ---------- 1) 去同色背景 ----------
// 造一张纯白底 + 黑框的素材，注入到分镜的文件输入
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

await page.click(".studio-workspace > div");
await sleep(400);
await page.mouse.click(
  (await (await page.$(".studio-workspace > div")).boundingBox()).x + 120,
  (await (await page.$(".studio-workspace > div")).boundingBox()).y + 120
);
await sleep(600);

const madeImage = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = "#111111";
  ctx.fillRect(140, 100, 120, 100);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "solid-bg.png", { type: "image/png" });
  const input = document.querySelector('input[type="file"][accept="image/*"]');
  if (!input) return "无文件输入";
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
});
void madeImage;
await sleep(2500);

const hasImage = await page.evaluate(() => document.body.innerText.includes("打开手动裁剪"));
record("分镜已导入素材", hasImage);

const removerOpened = await page.$("[data-open-bg-remover]");
record("属性面板提供去背景入口", Boolean(removerOpened));
await removerOpened.click();
await sleep(2200);

const modalShown = await page.evaluate(() => Boolean(document.querySelector('[data-bg-remover="1"]')));
record("去背景窗口可打开", modalShown);

const previewInfo = await page.evaluate(async () => {
  const modal = document.querySelector('[data-bg-remover="1"]');
  if (!modal) return null;
  const images = Array.from(modal.querySelectorAll("img"));
  const result = images[images.length - 1];
  if (!result || !result.src.startsWith("data:image")) {
    return { ready: false };
  }
  const element = new Image();
  await new Promise((resolve) => {
    element.onload = resolve;
    element.src = result.src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = element.naturalWidth;
  canvas.height = element.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(element, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) transparent += 1;
    else if (data[i] > 200) opaque += 1;
  }
  const total = data.length / 4;
  return { ready: true, transparentRatio: transparent / total, opaqueRatio: opaque / total };
});

record(
  "去背景后背景变为透明",
  Boolean(previewInfo?.ready) && previewInfo.transparentRatio > 0.5 && previewInfo.opaqueRatio > 0.01,
  previewInfo?.ready
    ? "透明占比=" + Math.round(previewInfo.transparentRatio * 100) + "% 保留占比=" + Math.round(previewInfo.opaqueRatio * 100) + "%"
    : "未生成预览"
);
await page.screenshot({ path: SHOT_DIR + "/bg-remover.png" });

await page.click("[data-bg-apply]");
await sleep(1200);
const modalClosed = await page.evaluate(() => !document.querySelector('[data-bg-remover="1"]'));
record("应用后窗口关闭", modalClosed);

// ---------- 2) 图片层 ----------
await clickByText("布局");
await sleep(500);
const overlayButton = await page.$("[data-add-overlay]");
record("提供添加图片层入口", Boolean(overlayButton));

const layerAdded = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 300;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(220,38,38,1)";
  ctx.beginPath();
  ctx.arc(150, 150, 140, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "foreground.png", { type: "image/png" });
  const input = document.querySelector("[data-add-overlay]")
    ?.parentElement?.querySelector('input[type="file"]');
  if (!input) return "未找到输入";
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
});
void layerAdded;
await sleep(2000);

const overlaySelected = await page.evaluate(() =>
  document.body.innerText.includes("图片层")
);
record("添加后选中图片层并显示属性", overlaySelected);

const overlayOpacity = await page.evaluate(() => Boolean(document.querySelector("[data-overlay-opacity]")));
record("图层提供不透明度控制", overlayOpacity);

// 画布上应出现该图层节点
const overlayOnCanvas = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  if (!canvas) return false;
  const ctx = canvas.getContext("2d");
  // 画布中心附近应出现图层的红色像素
  const data = ctx.getImageData(Math.round(canvas.width / 2) - 20, Math.round(canvas.height / 2) - 20, 40, 40).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 180 && data[i + 1] < 110 && data[i + 2] < 110) {
      return true;
    }
  }
  return false;
});
record("图层已渲染到画布上", overlayOnCanvas);
await page.screenshot({ path: SHOT_DIR + "/overlay-layer.png" });

// 调不透明度
await page.evaluate(() => {
  const input = document.querySelector("[data-overlay-opacity]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "35");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(800);
const opacityApplied = await page.evaluate(() => document.body.innerText.includes("35%"));
record("图层不透明度可调", opacityApplied);

// 删除图层
await page.click("[data-overlay-delete]");
await sleep(900);
const overlayGone = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(Math.round(canvas.width / 2) - 20, Math.round(canvas.height / 2) - 20, 40, 40).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 180 && data[i + 1] < 110 && data[i + 2] < 110) {
      return false;
    }
  }
  return true;
});
record("图层可删除", overlayGone);

// ---------- 3) 椭圆分镜的形状 ----------
// 用像素差异验证：新增的确实是椭圆（四角无变化），矩形分镜作为对照组（四角有变化）
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(900);

await page.evaluate(() => {
  window.__composite = () => {
    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    if (!canvases.length) {
      return null;
    }
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const shot = ctx.getImageData(0, 0, off.width, off.height);
    return { data: shot.data, width: off.width, height: off.height };
  };

  window.__shapeProbe = (base, after) => {
    if (!base || !after) {
      return null;
    }
    const b = base.data;
    const a = after.data;
    const width = base.width;
    const height = base.height;
    const delta = (index) =>
      Math.abs(b[index] - a[index]) +
      Math.abs(b[index + 1] - a[index + 1]) +
      Math.abs(b[index + 2] - a[index + 2]) +
      Math.abs(b[index + 3] - a[index + 3]);

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let changed = 0;
    for (let i = 0; i < b.length; i += 4) {
      if (delta(i) > 30) {
        const pixel = i / 4;
        const x = pixel % width;
        const y = (pixel - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        changed += 1;
      }
    }
    if (maxX < 0) {
      return null;
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    // 轮廓线只有 1-2px，密度统计会被抗锯齿稀释；改测"最外侧若干行/列上轮廓的横向跨度"
    const rowSpan = (fromY, rows) => {
      let lo = width;
      let hi = -1;
      for (let y = fromY; y < fromY + rows; y += 1) {
        if (y < 0 || y >= height) {
          continue;
        }
        for (let x = minX; x <= maxX; x += 1) {
          if (delta((y * width + x) * 4) > 30) {
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
        }
      }
      return hi < 0 ? 0 : (hi - lo + 1) / boxW;
    };
    const colSpan = (fromX, cols) => {
      let lo = height;
      let hi = -1;
      for (let x = fromX; x < fromX + cols; x += 1) {
        if (x < 0 || x >= width) {
          continue;
        }
        for (let y = minY; y <= maxY; y += 1) {
          if (delta((y * width + x) * 4) > 30) {
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
        }
      }
      return hi < 0 ? 0 : (hi - lo + 1) / boxH;
    };
    return {
      boxW,
      boxH,
      changed,
      top: rowSpan(minY, 4),
      left: colSpan(minX, 4)
    };
  };
});

async function deleteSelection() {
  const clicked = await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll("button")).find((item) =>
      (item.innerText ?? "").includes("删除选中")
    );
    if (!target) {
      return false;
    }
    target.click();
    return true;
  });
  if (!clicked) {
    await page.keyboard.press("Delete");
  }
  await sleep(900);
  return clicked;
}

// 椭圆分镜
await clickByText("布局");
await sleep(600);
await page.evaluate(() => {
  window.__baseEllipse = window.__composite();
});
await page.click('[data-add-ellipse-panel="1"]');
await sleep(1400);
const ellipseStat = await page.evaluate(() => window.__shapeProbe(window.__baseEllipse, window.__composite()));
record(
  "椭圆分镜已创建并渲染",
  Boolean(ellipseStat) && ellipseStat.changed > 1200,
  ellipseStat ? "变化像素=" + ellipseStat.changed + " 外框=" + ellipseStat.boxW + "x" + ellipseStat.boxH : "无变化"
);
record(
  "椭圆轮廓在顶边收窄（不是矩形）",
  Boolean(ellipseStat) && ellipseStat.top > 0.02 && ellipseStat.top < 0.5 && ellipseStat.left < 0.5,
  ellipseStat ? "顶边跨度=" + ellipseStat.top.toFixed(2) + " 左边跨度=" + ellipseStat.left.toFixed(2) : "无数据"
);
await page.screenshot({ path: SHOT_DIR + "/ellipse-panel.png" });

// 矩形分镜对照
await deleteSelection();
await sleep(600);
await page.evaluate(() => {
  window.__baseRect = window.__composite();
});
await clickByText("新建分镜");
await sleep(1400);
const rectStat = await page.evaluate(() => window.__shapeProbe(window.__baseRect, window.__composite()));
record(
  "矩形轮廓在顶边铺满（对照组有效）",
  Boolean(rectStat) && rectStat.top > 0.85 && rectStat.left > 0.85,
  rectStat ? "顶边跨度=" + rectStat.top.toFixed(2) + " 左边跨度=" + rectStat.left.toFixed(2) : "无数据"
);

// ---------- 4) 图片层是否真的进了导出图 ----------
// 导出 PNG 走 data URL 锚点：无头模式虽然不落盘，但 href 可捕获，据此直接分析导出图像的像素
await page.evaluate(() => {
  window.__exportAnchors = [];
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__exportAnchors.push({ href: String(this.href), download: this.download });
    return originalClick.call(this);
  };
});

// 「分镜布局」是开关，已展开时再点会收起；只在面板缺失时才去展开
if (!(await page.$("[data-add-overlay]"))) {
  await clickByText("布局");
  await sleep(600);
}
const redCircle = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 300;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e01b1b";
  ctx.beginPath();
  ctx.arc(150, 150, 145, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const input = document.querySelector("[data-add-overlay]")?.parentElement?.querySelector('input[type="file"]');
  if (!input) {
    return "未找到输入";
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], "layer.png", { type: "image/png" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
});
await sleep(1900);

const layerOnCanvas = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  if (!canvas) {
    return false;
  }
  const ctx = canvas.getContext("2d");
  const data = ctx.getImageData(
    Math.round(canvas.width / 2) - 20,
    Math.round(canvas.height / 2) - 20,
    40,
    40
  ).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 170 && data[i + 1] < 100 && data[i + 2] < 100) {
      return true;
    }
  }
  return false;
});
record("导出前图层已在画布上", layerOnCanvas && redCircle === "ok", "注入=" + redCircle);

await clickByText("导出");
await sleep(700);
await clickByText("导出 PNG（当前页）");
await sleep(3500);

const exportStat = await page.evaluate(async () => {
  const entry = (window.__exportAnchors || []).find((item) => item.href.indexOf("data:image/png") === 0);
  if (!entry) {
    return { ok: false, reason: "未捕获到 PNG 导出数据" };
  }
  const image = new Image();
  const loaded = await new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = entry.href;
  });
  if (!loaded) {
    return { ok: false, reason: "导出数据无法解码" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 170 && data[i + 1] < 100 && data[i + 2] < 100) {
      red += 1;
    }
  }
  return {
    ok: true,
    width: canvas.width,
    height: canvas.height,
    ratio: red / (data.length / 4),
    download: entry.download
  };
});

record(
  "图片层进入导出图",
  Boolean(exportStat.ok) && exportStat.ratio > 0.005,
  exportStat.ok
    ? "导出 " + exportStat.width + "x" + exportStat.height + " 图层像素占比=" + (exportStat.ratio * 100).toFixed(2) + "% 文件名=" + exportStat.download
    : String(exportStat.reason)
);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
