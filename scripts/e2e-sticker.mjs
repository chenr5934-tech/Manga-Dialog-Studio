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

// 把画布上所有图层合成后，统计符合给定颜色的像素分布
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
    return { data: ctx.getImageData(0, 0, off.width, off.height).data, width: off.width, height: off.height };
  };

  window.__colorBox = (shot, target) => {
    if (!shot) {
      return null;
    }
    const data = shot.data;
    const width = shot.width;
    const height = shot.height;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a < 40) {
        continue;
      }
      if (Math.abs(r - target[0]) < 46 && Math.abs(g - target[1]) < 46 && Math.abs(b - target[2]) < 46) {
        const pixel = index / 4;
        const x = pixel % width;
        const y = (pixel - x) / width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count += 1;
      }
    }
    if (maxX < 0) {
      return null;
    }
    return { minX, minY, maxX, maxY, count, width, height };
  };

  // 在包围盒某一相对高度处，取中心线与两侧的命中情况
  window.__probeRow = (shot, target, box, ratio) => {
    const data = shot.data;
    const width = shot.width;
    const y = Math.round(box.minY + (box.maxY - box.minY) * ratio);
    const hitAt = (x) => {
      const index = (y * width + x) * 4;
      if (index < 0 || index + 3 >= data.length) {
        return false;
      }
      if (data[index + 3] < 40) {
        return false;
      }
      return (
        Math.abs(data[index] - target[0]) < 46 &&
        Math.abs(data[index + 1] - target[1]) < 46 &&
        Math.abs(data[index + 2] - target[2]) < 46
      );
    };
    const cx = Math.round((box.minX + box.maxX) / 2);
    const span = box.maxX - box.minX;
    const centerHit = hitAt(cx);
    const leftHit = hitAt(Math.round(cx - span * 0.32));
    const rightHit = hitAt(Math.round(cx + span * 0.32));
    return { y, centerHit, leftHit, rightHit };
  };
});

const RED = [239, 68, 68];

// 1) 入口
const entry = await page.evaluate(() => {
  const button = document.querySelector("[data-hero-sticker]");
  if (!button) {
    return null;
  }
  const box = button.getBoundingClientRect();
  return { text: (button.innerText ?? "").trim(), width: Math.round(box.width) };
});
record("顶部主操作区提供贴纸入口", Boolean(entry) && entry.text === "贴纸", entry ? entry.text + " " + entry.width + "px" : "未找到");

await page.click("[data-hero-sticker]");
await sleep(700);
const pickerOpen = await page.evaluate(() => Boolean(document.querySelector('[data-sticker-picker="1"]')));
record("贴纸面板可打开", pickerOpen);

const catalog = await page.evaluate(() => {
  const groups = Array.from(document.querySelectorAll("[data-sticker-group]")).map((element) =>
    (element.innerText ?? "").trim()
  );
  const total = document.querySelectorAll("[data-sticker-id]").length;
  return { groups, total };
});
record("贴纸按分组陈列", catalog.groups.length >= 3 && catalog.total >= 5, catalog.groups.join(" / ") + "，当前组 " + catalog.total + " 个");

const heartShown = await page.evaluate(() => Boolean(document.querySelector('[data-sticker-id="heart"]')));
record("内置爱心贴纸存在", heartShown);
await page.screenshot({ path: SHOT_DIR + "/sticker-picker.png" });

// 2) 添加爱心并验证形状
await page.click('[data-sticker-id="heart"]');
await sleep(900);
const addedCount = await page.evaluate(() => (document.querySelector("[data-sticker-count]")?.innerText ?? "").trim());
record("点击后计数反馈", addedCount.includes("1"), addedCount);

await page.click("[data-sticker-close]");
await sleep(800);

const heartShot = await page.evaluate(() => window.__composite());
const heartBox = await page.evaluate((target) => window.__colorBox(window.__composite(), target), RED);
record("爱心已落到画布上", Boolean(heartBox) && heartBox.count > 2000, heartBox ? "命中像素=" + heartBox.count : "未找到红色像素");

// 心形的判据：靠近顶部时中心是凹口，两侧才有填充
const heartTop = await page.evaluate((target) => {
  const shot = window.__composite();
  const box = window.__colorBox(shot, target);
  return box ? window.__probeRow(shot, target, box, 0.12) : null;
}, RED);
record(
  "爱心顶部中央确实凹下去（形状正确）",
  Boolean(heartTop) && !heartTop.centerHit && heartTop.leftHit && heartTop.rightHit,
  heartTop ? "中心=" + heartTop.centerHit + " 左=" + heartTop.leftHit + " 右=" + heartTop.rightHit : "无数据"
);

const heartBottom = await page.evaluate((target) => {
  const shot = window.__composite();
  const box = window.__colorBox(shot, target);
  return box ? window.__probeRow(shot, target, box, 0.72) : null;
}, RED);
record(
  "爱心底部中央是实心的（对照，排除探针恒空）",
  Boolean(heartBottom) && heartBottom.centerHit,
  heartBottom ? "中心=" + heartBottom.centerHit : "无数据"
);
await page.screenshot({ path: SHOT_DIR + "/sticker-heart.png" });

// 3) 属性面板
const inspector = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    isSticker: text.includes("贴纸"),
    swatches: document.querySelectorAll("[data-sticker-color]").length,
    hasOpacity: Boolean(document.querySelector("[data-overlay-opacity]"))
  };
});
record("选中贴纸后属性面板识别为贴纸", inspector.isSticker, "色板数=" + inspector.swatches);
record("贴纸沿用图片层的位置尺寸与不透明度控件", inspector.hasOpacity && inspector.swatches >= 8, "");

// 4) 换色：换成蓝色，红色应当消失、蓝色出现
await page.evaluate(() => {
  const swatch = document.querySelector('[data-sticker-color="#0ea5e9"]');
  swatch?.click();
});
await sleep(800);
const blueBox = await page.evaluate(() => window.__colorBox(window.__composite(), [14, 165, 233]));
const redLeft = await page.evaluate(() => window.__colorBox(window.__composite(), [239, 68, 68]));
record(
  "换色真的改变了渲染颜色",
  Boolean(blueBox) && blueBox.count > 2000 && (!redLeft || redLeft.count < 200),
  "蓝色=" + (blueBox ? blueBox.count : 0) + " 残留红色=" + (redLeft ? redLeft.count : 0)
);

// 4b) 画布上的交互：拖拽、缩放、旋转
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

const toScreen = (cx, cy) =>
  page.evaluate(
    (targetX, targetY) => {
      const el = document.querySelector(".studio-workspace canvas");
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + (targetX / el.width) * rect.width,
        y: rect.top + (targetY / el.height) * rect.height
      };
    },
    cx,
    cy
  );

const beforeDrag = await readOverlayFields();
const dragBox = await page.evaluate(() => window.__colorBox(window.__composite(), [14, 165, 233]));
const dragFrom = await toScreen((dragBox.minX + dragBox.maxX) / 2, (dragBox.minY + dragBox.maxY) / 2);
await page.mouse.move(dragFrom.x, dragFrom.y);
await page.mouse.down();
await page.mouse.move(dragFrom.x + 90, dragFrom.y + 70, { steps: 12 });
await page.mouse.up();
await sleep(700);
const afterDrag = await readOverlayFields();
record(
  "贴纸可以在画布上直接拖拽",
  Number.isFinite(afterDrag.X) &&
    Number.isFinite(beforeDrag.X) &&
    (Math.abs(afterDrag.X - beforeDrag.X) > 20 || Math.abs(afterDrag.Y - beforeDrag.Y) > 20),
  "X " + beforeDrag.X + "→" + afterDrag.X + "  Y " + beforeDrag.Y + "→" + afterDrag.Y
);

// 手柄位置直接从画面上探测：心形底部是尖的，用像素包围盒的角点去找手柄会偏出命中范围
const findHandles = () =>
  page.evaluate(() => {
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
      if (
        Math.abs(data[index] - 191) < 10 &&
        Math.abs(data[index + 1] - 219) < 10 &&
        Math.abs(data[index + 2] - 254) < 10
      ) {
        const pixel = index / 4;
        const x = pixel % off.width;
        const y = (pixel - x) / off.width;
        const key = Math.round(x / 12) + ":" + Math.round(y / 12);
        const found = clusters.get(key) || { sx: 0, sy: 0, n: 0 };
        found.sx += x;
        found.sy += y;
        found.n += 1;
        clusters.set(key, found);
      }
    }
    return Array.from(clusters.values())
      .filter((entry) => entry.n >= 8)
      .map((entry) => ({ x: entry.sx / entry.n, y: entry.sy / entry.n, n: entry.n }));
  });

const handles = await findHandles();
record("选中后出现变换手柄", handles.length >= 4, "识别到 " + handles.length + " 个手柄");
const bottomRight = handles.slice().sort((a, b) => a.y + a.x - (b.y + b.x)).pop();
const corner = await toScreen(bottomRight.x, bottomRight.y);
await page.mouse.move(corner.x, corner.y);
await page.mouse.down();
await page.mouse.move(corner.x + 80, corner.y + 80, { steps: 14 });
await page.mouse.up();
await sleep(700);
const afterScale = await readOverlayFields();
record(
  "贴纸可以拖角缩放",
  Number.isFinite(afterScale["宽度"]) &&
    Number.isFinite(afterDrag["宽度"]) &&
    afterScale["宽度"] > afterDrag["宽度"] + 10,
  "宽度 " + afterDrag["宽度"] + "→" + afterScale["宽度"] + "  高度 " + afterDrag["高度"] + "→" + afterScale["高度"]
);

// 拖旋转手柄
const handlesForRotate = await findHandles();
const topMost = handlesForRotate.slice().sort((a, b) => b.y - a.y).pop();
const rotationStart = await toScreen(topMost.x, topMost.y);
let rotated = false;
let rotationDetail = "";
// topMost 本身就是旋转手柄，只在它附近做微小容错，避免点到相邻锚点
for (const offset of [0, -5, 5, -10, 10]) {
  const before = await readOverlayFields();
  await page.mouse.move(rotationStart.x, rotationStart.y + offset);
  await page.mouse.down();
  await page.mouse.move(rotationStart.x + 70, rotationStart.y + offset + 80, { steps: 14 });
  await page.mouse.up();
  await sleep(600);
  const after = await readOverlayFields();
  rotationDetail = "偏移 " + offset + "px: 旋转 " + before["旋转"] + "→" + after["旋转"];
  if (Number.isFinite(after["旋转"]) && Math.abs(after["旋转"] - before["旋转"]) > 3) {
    rotated = true;
    break;
  }
}
record("贴纸可以拖手柄旋转", rotated, rotationDetail);

// 5) 连续添加会错位，不会完全重叠
await page.click("[data-hero-sticker]");
await sleep(600);
await page.click('[data-sticker-id="star"]');
await sleep(700);
await page.click("[data-sticker-close]");
await sleep(700);
const starBox = await page.evaluate(() => window.__colorBox(window.__composite(), [245, 158, 11]));
record(
  "连续添加的贴纸会错开位置",
  Boolean(starBox) && Boolean(blueBox) && (starBox.minX !== blueBox.minX || starBox.minY !== blueBox.minY),
  starBox && blueBox ? "爱心x=" + blueBox.minX + " 星星x=" + starBox.minX : "无数据"
);

// 6) 删除
const beforeDelete = await page.evaluate(() => window.__colorBox(window.__composite(), [245, 158, 11]));
await page.evaluate(() => {
  const button = document.querySelector("[data-overlay-delete]");
  button?.click();
});
await sleep(800);
const afterDelete = await page.evaluate(() => window.__colorBox(window.__composite(), [245, 158, 11]));
record(
  "贴纸可以删除",
  Boolean(beforeDelete) && !afterDelete,
  beforeDelete ? "删除前=" + beforeDelete.count + " 删除后=" + (afterDelete ? afterDelete.count : 0) : "删除前就没找到"
);

// 7) 缩略图里也要画出来
const thumbHasSticker = await page.evaluate(() => {
  const thumb = document.querySelector("[data-thumb-index]");
  if (!thumb) {
    return null;
  }
  const canvases = Array.from(thumb.querySelectorAll("canvas"));
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
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  let blue = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 40) {
      continue;
    }
    if (Math.abs(data[index] - 14) < 46 && Math.abs(data[index + 1] - 165) < 46 && Math.abs(data[index + 2] - 233) < 46) {
      blue += 1;
    }
  }
  return blue;
});
record("贴纸同步出现在胶片缩略图里", typeof thumbHasSticker === "number" && thumbHasSticker > 20, "缩略图命中=" + thumbHasSticker);

// 8) 导出图里也要有
await page.evaluate(() => {
  window.__exportAnchors = [];
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__exportAnchors.push({ href: String(this.href), download: this.download });
    return originalClick.call(this);
  };
});
await clickByText("导出");
await sleep(700);
await clickByText("导出 PNG（当前页）");
await sleep(3500);
const exportBlue = await page.evaluate(async () => {
  const entry = (window.__exportAnchors || []).find((item) => item.href.indexOf("data:image/png") === 0);
  if (!entry) {
    return null;
  }
  const image = new Image();
  const loaded = await new Promise((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = entry.href;
  });
  if (!loaded) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let blue = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (Math.abs(data[index] - 14) < 46 && Math.abs(data[index + 1] - 165) < 46 && Math.abs(data[index + 2] - 233) < 46) {
      blue += 1;
    }
  }
  return blue;
});
record("贴纸进入导出图", typeof exportBlue === "number" && exportBlue > 200, "导出命中=" + exportBlue);

// 9) 撤销应当把删掉的贴纸整段恢复
await page.keyboard.down("Control");
await page.keyboard.press("KeyZ");
await page.keyboard.up("Control");
await sleep(800);
const afterUndo = await page.evaluate(() => window.__colorBox(window.__composite(), [245, 158, 11]));
record(
  "撤销可以恢复被删掉的贴纸",
  Boolean(afterUndo) && afterUndo.count > 500,
  "撤销后星星像素=" + (afterUndo ? afterUndo.count : 0)
);

// 10) 项目往返：贴纸必须能存能读，未知 id 要被安全丢弃
// sanitizeOverlays 只在加载路径上跑，这一步专门覆盖它
const projectWithStickers = {
  id: "sticker-roundtrip",
  name: "贴纸往返",
  activePageId: "sp1",
  pages: [
    {
      id: "sp1",
      name: "第 1 页",
      canvas: { width: 1200, height: 800, preset: "custom", dpi: 300 },
      backdropColor: "#ffffff",
      panels: [],
      bubbles: [],
      overlays: [
        { id: "s-heart", x: 60, y: 60, width: 240, height: 240, rotation: 0, image: "", sticker: { id: "heart", color: "#0ea5e9" } },
        { id: "s-bogus", x: 340, y: 60, width: 240, height: 240, rotation: 0, image: "", sticker: { id: "not-a-real-sticker", color: "#000000" } },
        { id: "s-star", x: 620, y: 60, width: 240, height: 240, rotation: 0, image: "", sticker: { id: "star", color: "#f59e0b" } }
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
await clickByText("更多");
await sleep(500);
await clickByText("加载项目");
await sleep(900);
const injected = await page.evaluate((jsonText) => {
  const candidates = Array.from(document.querySelectorAll('input[type="file"]')).filter(
    (element) => typeof element.accept === "string" && element.accept.includes("json")
  );
  const input = candidates[candidates.length - 1];
  if (!input) {
    return "未找到加载用的 file input";
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([jsonText], "sticker-project.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "已派发 change";
}, JSON.stringify(projectWithStickers));
void injected;
await sleep(2800);

const rtHeart = await page.evaluate(() => window.__colorBox(window.__composite(), [14, 165, 233]));
const rtStar = await page.evaluate(() => window.__colorBox(window.__composite(), [245, 158, 11]));
record(
  "加载项目后贴纸仍在（sticker 字段没被归一化丢掉）",
  Boolean(rtHeart) && rtHeart.count > 1200,
  rtHeart ? "爱心像素=" + rtHeart.count : "贴纸丢失"
);
record(
  "多张贴纸与各自颜色一起恢复",
  Boolean(rtHeart) && Boolean(rtStar) && rtStar.count > 800,
  "爱心=" + (rtHeart ? rtHeart.count : 0) + " 星星=" + (rtStar ? rtStar.count : 0)
);

const rtProbe = await page.evaluate(() => {
  const shot = window.__composite();
  const box = window.__colorBox(shot, [14, 165, 233]);
  return box ? window.__probeRow(shot, [14, 165, 233], box, 0.12) : null;
});
record(
  "恢复出来的仍是心形而不是别的形状",
  Boolean(rtProbe) && !rtProbe.centerHit && rtProbe.leftHit && rtProbe.rightHit,
  rtProbe ? "中心=" + rtProbe.centerHit + " 左=" + rtProbe.leftHit + " 右=" + rtProbe.rightHit : "无数据"
);

const bogus = await page.evaluate(() => window.__colorBox(window.__composite(), [0, 0, 0]));
record(
  "未知贴纸 id 被安全丢弃，不渲染也不报错",
  !bogus || bogus.count < 200,
  "黑色像素=" + (bogus ? bogus.count : 0)
);

const projectName = await page.evaluate(
  () => document.querySelector('input[placeholder="项目名称"]')?.value ?? null
);
record("含贴纸的项目文件能正常加载", projectName === "贴纸往返", "项目名=" + projectName);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
