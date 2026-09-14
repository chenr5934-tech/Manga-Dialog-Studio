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

const readPanelFields = () =>
  page.evaluate(() => {
    const values = {};
    for (const label of document.querySelectorAll("aside label")) {
      // 属性面板的标签被 CSS 转成大写，innerText 拿到的也是大写，统一转小写比对
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

const setPanelNumber = (labelText, value) =>
  page.evaluate(
    (name, next) => {
      for (const label of document.querySelectorAll("aside label")) {
        const span = label.querySelector("span");
        const input = label.querySelector("input");
        if (span && input && span.innerText.trim().toLowerCase() === name.toLowerCase()) {
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
await setPanelNumber("Radius", RADIUS);
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
await setPanelNumber("Radius", 0);
await sleep(700);
await page.click('[data-corner-mode="round"]');
await sleep(600);
const sharpDistance = await page.evaluate(() => window.__cornerDistance(window.__cx, window.__cy));

// 圆角模式
await setPanelNumber("Radius", RADIUS);
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

await page.click('[data-corner-mode="chamfer"]');
await sleep(700);
await setPanelNumber("Radius", 120);
await sleep(900);
const polyStillThere = await page.evaluate(() => {
  const canvases = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  const off = document.createElement("canvas");
  off.width = canvases[0].width;
  off.height = canvases[0].height;
  const ctx = off.getContext("2d");
  for (const item of canvases) {
    ctx.drawImage(item, 0, 0, off.width, off.height);
  }
  const data = ctx.getImageData(0, 0, off.width, off.height).data;
  let white = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] > 235 && data[index + 1] > 235 && data[index + 2] > 235 && data[index + 3] > 200) {
      white += 1;
    }
  }
  return white;
});
record("多边形倒角后仍正常渲染", polyStillThere > 3000, "白色像素=" + polyStillThere);

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
  return values["x"] === "40" && values["width"] === "2400";
});
record("可以重新选中矩形分镜", selectedIsRect);
await setPanelNumber("Radius", 120);
await sleep(500);
await page.click('[data-corner-mode="chamfer"]');
await sleep(700);

// 先清掉内边距，取一个"边框之后直接是填充"的基线
await setPanelNumber("Padding", 0);
await sleep(800);
const withoutPadding = await page.evaluate(() => window.__segments());
const greenRuns = (value) => value.split(",").filter((part) => part === "绿").length;
record(
  "内边距为 0 时，角上只有背景这一段底色",
  greenRuns(withoutPadding) === 1,
  withoutPadding
);

await setPanelNumber("Padding", 70);
await sleep(900);
const withPadding = await page.evaluate(() => window.__segments());
record(
  "内边距大于 0 时，边框与内容之间多露出一圈底色",
  greenRuns(withPadding) === greenRuns(withoutPadding) + 1,
  withoutPadding + "   →   " + withPadding
);
await page.screenshot({ path: SHOT_DIR + "/padding-visible.png" });

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
