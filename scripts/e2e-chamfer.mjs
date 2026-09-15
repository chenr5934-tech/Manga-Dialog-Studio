import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
page.on("dialog", (dialog) => void dialog.accept());

// 给多边形圆角测试准备一张大尺寸素材：有画面内容时，圆角才会在像素上留下明显痕迹
const assetPage = await browser.newPage();
await assetPage.setContent('<!doctype html><body style="margin:0"><canvas id="p"></canvas></body>');
const polySourceData = await assetPage.evaluate(() => {
  const canvas = document.getElementById("p");
  canvas.width = 1600;
  canvas.height = 1600;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
});
await assetPage.close();
writeFileSync(
  join(SHOT_DIR, "chamfer-poly-source.png"),
  Buffer.from(polySourceData.slice(polySourceData.indexOf(",") + 1), "base64")
);

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

const readPanelFields = () =>
  page.evaluate(() => {
    const values = {};
    for (const label of document.querySelectorAll("aside label")) {
      // 属性面板的标签被 CSS 转成大写，innerText 拿到的也是大写，统一转小写比对
      const name = (label.querySelector("span")?.innerText ?? "").trim().toLowerCase();
      const input = label.querySelector("input");
      // 界面改成中文后，标签也是中文；这里映射回测试里用的英文键
      const alias =
        { "宽度": "width", "高度": "height", "x 坐标": "x", "y 坐标": "y", "圆角半径": "radius", "倒角半径": "radius", "内边距": "padding" }[name] ?? name;
      if (name && input && typeof input.value === "string" && input.value !== "") {
        const numeric = Number(input.value);
        if (Number.isFinite(numeric)) {
          values[alias] = numeric;
        }
      }
    }
    return values;
  });

const setPanelNumber = (labelText, value) =>
  page.evaluate(
    (name, next) => {
      for (const label of document.querySelectorAll("aside label")) {
        const span = label.querySelector("span");
        const input = label.querySelector("input");
        // 用包含匹配："半径" 会命中当前模式显示的那个（圆角半径或倒角半径）
      if (span && input && span.innerText.trim().toLowerCase().includes(name.toLowerCase())) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, String(next));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    },
    labelText,
    value
  );

// 底图换成绿色：分镜是白底，这样角上被切掉还是没切掉一眼可分
const backdropApplied = await page.evaluate(() => {
  const input = document.querySelector("[data-tool-backdrop]");
  if (!input) {
    return false;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "#16a34a");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await sleep(700);
record("可以把底图改成纯色，便于分辨分镜边界", backdropApplied);

// 建一个分镜
await clickByText("布局");
await sleep(500);
await clickByText("新建分镜");
await sleep(700);
await clickByText("关闭");
await sleep(500);

const fields = await readPanelFields();
record(
  "分镜已选中并能读到几何参数",
  Number.isFinite(fields["x"]) && Number.isFinite(fields["width"]),
  "X=" + fields["x"] + " Y=" + fields["y"] + " W=" + fields["width"] + " H=" + fields["height"]
);

// 半径给足，倒角才看得出来
const RADIUS = 90;
await setPanelNumber("半径", RADIUS);
await sleep(700);
const withRadius = await readPanelFields();
record("倒角/圆角半径可以设置", withRadius["radius"] === RADIUS, "Radius=" + withRadius["radius"]);


// 采样工具：把画布坐标换算成画布像素后取色
// 判据：从分镜左上角沿 45° 对角线往外扫，量出"角点到分镜边界"的距离。
// 圆角的边界在 0.414r 处，倒角在 0.707r 处，倒角必然更远，且这个量法不依赖单点取色。
await page.evaluate(() => {
  window.__cornerDistance = (worldX, worldY) => {
    const canvasEl = document.querySelector(".studio-workspace canvas");
    const match = document.body.innerText.match(/Canvas\s+(\d+)\s*x\s*(\d+)/);
    if (!canvasEl || !match) {
      return null;
    }
    const zoom = canvasEl.width / Number(match[1]);
    const startX = Math.round(worldX * zoom);
    const startY = Math.round(worldY * zoom);

    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;

    for (let step = 1; step < 120; step += 1) {
      const px = startX + step;
      const py = startY + step;
      if (px >= off.width || py >= off.height) {
        break;
      }
      const index = (py * off.width + px) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      // 白色填充即分镜内部；选中虚线框是浅蓝，不满足条件
      if (r > 240 && g > 240 && b > 240) {
        return step;
      }
    }
    return -1;
  };
});

const cornerX = withRadius["x"];
const cornerY = withRadius["y"];
await page.evaluate(
  (x, y) => {
    window.__cx = x;
    window.__cy = y;
  },
  cornerX,
  cornerY
);

// 直角作基准：没有切角时，边界紧贴角点
await setPanelNumber("半径", 0);
await sleep(700);
await page.click('[data-corner-mode="round"]');
await sleep(600);
const sharpDistance = await page.evaluate(() => window.__cornerDistance(window.__cx, window.__cy));

// 圆角模式
await setPanelNumber("半径", RADIUS);
await sleep(700);
await page.click('[data-corner-mode="round"]');
await sleep(800);
const roundDistance = await page.evaluate(() => window.__cornerDistance(window.__cx, window.__cy));
record(
  "圆角会把角削掉（边界离开角点）",
  Number.isFinite(roundDistance) && roundDistance > sharpDistance,
  "直角=" + sharpDistance + "px 圆角=" + roundDistance + "px"
);
await page.screenshot({ path: SHOT_DIR + "/corner-round.png" });

// 倒角模式
await page.click('[data-corner-mode="chamfer"]');
await sleep(900);
const chamferDistance = await page.evaluate(() => window.__cornerDistance(window.__cx, window.__cy));
record(
  "倒角会把角切掉，且切得比圆角更深",
  Number.isFinite(chamferDistance) && chamferDistance > roundDistance,
  "圆角=" + roundDistance + "px 倒角=" + chamferDistance + "px（理论比 0.414r : 0.707r）"
);
await page.screenshot({ path: SHOT_DIR + "/corner-chamfer.png" });

// 倒角也应当作用在多边形上
await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll("button")).find(
    (element) => (element.innerText ?? "").trim() === "多边形"
  );
  void chip;
});
await page.click('[data-tool="panel-polygon"]');
await sleep(600);
const polyState = await page.evaluate(() => ({
  highlighted: (document.querySelector('[data-tool="panel-polygon"]')?.className ?? "").includes("studio-btn-primary"),
  hint: (document.body.innerText.match(/多边形扣选中[^\n]*|画布已锁定[^\n]*/) ?? ["(无提示)"])[0]
}));
console.log("  诊断：多边形扣选状态 = " + JSON.stringify(polyState));
const canvasBox = await (await page.$(".studio-workspace > div")).boundingBox();
// 用相对画布起点的固定偏移，和 e2e-edit-controls 里能跑通的多边形流程保持一致
const points = [
  [canvasBox.x + 150, canvasBox.y + 120],
  [canvasBox.x + 430, canvasBox.y + 170],
  [canvasBox.x + 400, canvasBox.y + 420],
  [canvasBox.x + 170, canvasBox.y + 400]
];
for (const [px, py] of points) {
  await page.mouse.click(px, py);
  await sleep(200);
}
await page.keyboard.press("Enter");
await sleep(1000);
await clickByText("退出扣选");
await sleep(600);

const polyFields = await readPanelFields();
record(
  "多边形分镜也能选中",
  Number.isFinite(polyFields["width"]),
  polyFields["width"] ? "宽度=" + polyFields["width"] : "未选中"
);

const polyCorner = await page.evaluate(() => Boolean(document.querySelector('[data-corner-mode="chamfer"]')));
record("多边形分镜同样提供圆角/倒角切换", polyCorner);

// 多边形倒角：直接比对"圆角 vs 倒角"的画布差异，而不是只数白色像素。
// 分镜填充是白的、页面底色也可能白，所以差异只会出现在边框线上，判据要看差异像素数。
await page.evaluate(() => {
  window.__snapshotCanvas = () => {
    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    return Array.from(ctx.getImageData(0, 0, off.width, off.height).data);
  };
  window.__countDiff = (a, b) => {
    let count = 0;
    for (let index = 0; index < a.length; index += 4) {
      const delta =
        Math.abs(a[index] - b[index]) +
        Math.abs(a[index + 1] - b[index + 1]) +
        Math.abs(a[index + 2] - b[index + 2]);
      if (delta > 40) {
        count += 1;
      }
    }
    return count;
  };
});

await setPanelNumber("半径", 320);
await sleep(600);
await page.click('[data-corner-mode="round"]');
await sleep(900);
const polyRound = await page.evaluate(() => window.__snapshotCanvas());

await page.click('[data-corner-mode="chamfer"]');
await sleep(900);
const polyChamfer = await page.evaluate(() => window.__snapshotCanvas());

const polyDiff = await page.evaluate((a, b) => window.__countDiff(a, b), polyRound, polyChamfer);
record(
  "多边形同样受倒角影响（圆角与倒角的画布输出不同）",
  polyDiff > 500,
  "差异像素=" + polyDiff
);

// 圆角对多边形的实际效力：给多边形放一张图，"白填充变白背景"的干扰就没了，
// 边角的弧线会实打实改变画面。没有图时同样的半径只有两千多像素的差异。
const polyImageInput = await page.$("[data-panel-image-input]");
if (polyImageInput) {
  await polyImageInput.uploadFile(join(SHOT_DIR, "chamfer-poly-source.png"));
  await sleep(2500);
}
await setPanelNumber("半径", 0);
await sleep(800);
const polySharpShot = await page.evaluate(() => window.__snapshotCanvas());
await setPanelNumber("半径", 400);
await sleep(900);
const polyRoundShot = await page.evaluate(() => window.__snapshotCanvas());
const polyRoundDiff = await page.evaluate((a, b) => window.__countDiff(a, b), polySharpShot, polyRoundShot);
record(
  "多边形的圆角在画面内容上确实生效",
  polyRoundDiff > 5000,
  "差异像素=" + polyRoundDiff
);

// 与 Radius=0 的直角对比：倒角应当改变角部
await setPanelNumber("半径", 0);
await sleep(800);
const polySharp = await page.evaluate(() => window.__snapshotCanvas());
await setPanelNumber("半径", 320);
await sleep(900);
const polyChamferBig = await page.evaluate(() => window.__snapshotCanvas());
const polyVsSharp = await page.evaluate((a, b) => window.__countDiff(a, b), polySharp, polyChamferBig);
record(
  "多边形倒角相对直角确实改变了角部",
  polyVsSharp > 500,
  "差异像素=" + polyVsSharp
);

// ---------- 内边距（Padding）必须肉眼可见 ----------
// 早先填充是铺满边框内沿的，调 Padding 只有图片会动，没图片时完全看不出，
// 现在填充也按 Padding 内缩，边框与内容之间会露出一圈底色。
await page.evaluate(() => {
  window.__segments = () => {
    const canvasEl = document.querySelector(".studio-workspace canvas");
    const match = document.body.innerText.match(/Canvas\s+(\d+)\s*x\s*(\d+)/);
    const zoom = canvasEl.width / Number(match[1]);
    const startX = Math.round(40 * zoom);
    const startY = Math.round(40 * zoom);
    const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
    const off = document.createElement("canvas");
    off.width = canvases[0].width;
    off.height = canvases[0].height;
    const ctx = off.getContext("2d");
    for (const item of canvases) {
      ctx.drawImage(item, 0, 0, off.width, off.height);
    }
    const data = ctx.getImageData(0, 0, off.width, off.height).data;
    const kind = (index) => {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      if (r > 240 && g > 240 && b > 240) return "白";
      if (r < 90 && g > 130 && b < 110) return "绿";
      if (r < 80 && g < 80 && b < 90) return "黑";
      return "其他";
    };
    const list = [];
    let current = null;
    for (let step = 0; step < 90; step += 1) {
      const index = ((startY + step) * off.width + (startX + step)) * 4;
      const k = kind(index);
      if (!current || current.kind !== k) {
        current = { kind: k };
        list.push(current);
      }
    }
    return list.map((item) => item.kind).join(",");
  };
});

// 前面新建的多边形现在是选中状态，而扫描的是左上角那个矩形分镜，
// 先把选中切回矩形，否则改的是多边形的 Padding。
const rectBox = await (await page.$(".studio-workspace > div")).boundingBox();
await page.mouse.click(rectBox.x + 60, rectBox.y + 60);
await sleep(800);
const selectedIsRect = await page.evaluate(() => {
  const values = {};
  for (const label of document.querySelectorAll("aside label")) {
    const span = label.querySelector("span");
    const input = label.querySelector("input");
    if (span && input) {
      values[span.innerText.trim().toLowerCase()] = input.value;
    }
  }
  return values["x 坐标"] === "40" && values["宽度"] === "2400";
});
record("可以重新选中矩形分镜", selectedIsRect);
await setPanelNumber("半径", 120);
await sleep(500);
await page.click('[data-corner-mode="chamfer"]');
await sleep(700);

// 先清掉内边距，取一个"边框之后直接是填充"的基线
await setPanelNumber("内边距", 0);
await sleep(800);
const withoutPadding = await page.evaluate(() => window.__segments());
const greenRuns = (value) => value.split(",").filter((part) => part === "绿").length;
record(
  "内边距为 0 时，角上只有背景这一段底色",
  greenRuns(withoutPadding) === 1,
  withoutPadding
);

await setPanelNumber("内边距", 70);
await sleep(900);
const withPadding = await page.evaluate(() => window.__segments());
record(
  "内边距大于 0 时，边框与内容之间多露出一圈底色",
  greenRuns(withPadding) === greenRuns(withoutPadding) + 1,
  withoutPadding + "   →   " + withPadding
);
await page.screenshot({ path: SHOT_DIR + "/padding-visible.png" });

// 圆角和倒角各存各的半径：切过去会沿用对方的值，但改一个不该覆盖另一个
await page.click('[data-corner-mode="round"]');
await sleep(500);
await setPanelNumber("半径", 120);
await sleep(600);
const roundBefore = (await readPanelFields())["radius"];

await page.click('[data-corner-mode="chamfer"]');
await sleep(700);
const chamferInherited = (await readPanelFields())["radius"];
record(
  "切到倒角会沿用圆角半径，不会突然归零",
  chamferInherited === roundBefore,
  "圆角=" + roundBefore + " 倒角=" + chamferInherited
);

await setPanelNumber("半径", 300);
await sleep(700);
await page.click('[data-corner-mode="round"]');
await sleep(700);
const roundAfter = (await readPanelFields())["radius"];
record(
  "改倒角半径不会覆盖圆角半径",
  roundAfter === roundBefore,
  "圆角 " + roundBefore + " → " + roundAfter
);

await page.click('[data-corner-mode="chamfer"]');
await sleep(700);
const chamferAfter = (await readPanelFields())["radius"];
record("倒角半径自己保持不变", chamferAfter === 300, "倒角=" + chamferAfter);

// 复位，后面的直角基准要从 0 开始
await page.click('[data-corner-mode="round"]');
await sleep(500);
await setPanelNumber("半径", 0);
await sleep(700);
await setPanelNumber("内边距", 0);
await sleep(700);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
