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

// 属性面板里的字段按 label 文字定位，避免数错顺序
function readPanelField(labelText) {
  return page.evaluate((wanted) => {
    for (const label of Array.from(document.querySelectorAll("label"))) {
      const span = label.querySelector("span");
      if (span && span.textContent.trim() === wanted) {
        const input = label.querySelector('input[type="number"]');
        if (input) {
          return input.value;
        }
      }
    }
    return null;
  }, labelText);
}

const readPanelCount = () =>
  page.evaluate(() => Number((document.body.innerText.match(/分镜\s*(\d+)/) ?? [0, -1])[1]));

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

const canvasBox = await (await page.$(".studio-workspace > div")).boundingBox();
// 探测点：用于选中原分镜，需远离变换手柄
const probeX = canvasBox.x + 100;
const probeY = canvasBox.y + 100;
// 拖拽点：故意远离探测点，且整段拖拽都留在可视区域内
const dragX = canvasBox.x + 520;
const dragY = canvasBox.y + 400;

// A) 先选中默认分镜，记录原始坐标
await page.mouse.click(probeX, probeY);
await sleep(700);
const before = { x: await readPanelField("X"), y: await readPanelField("Y") };
record("可正常选中分镜并读到坐标", before.x !== null && before.y !== null, "X=" + before.x + " Y=" + before.y);
const panelsBefore = await readPanelCount();

// B) 开启矩形扣选
await clickByText("矩形扣选");
await sleep(600);
const lockHint = await page.evaluate(() => document.body.innerText.includes("画布已锁定"));
record("进入扣选后显示锁定提示", lockHint);

// C) 在已有分镜上按下并拖动 —— 这正是一直误拖分镜的操作
const probe = await page.evaluate(([x, y]) => {
  const element = document.elementFromPoint(x, y);
  const scroller = document.querySelector(".studio-workspace")?.parentElement;
  const rect = scroller?.getBoundingClientRect();
  return {
    hit: element ? element.tagName + "." + String(element.className).slice(0, 50) : "null",
    scroller: rect
      ? {
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          height: Math.round(rect.height),
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight
        }
      : null
  };
}, [Math.round(dragX), Math.round(dragY)]);
console.log(
  "  环境: 拖拽点 " + Math.round(dragX) + "," + Math.round(dragY) +
  " 命中 " + probe.hit +
  " 可视区底边 " + (probe.scroller ? probe.scroller.bottom : "?")
);

await page.mouse.move(dragX, dragY);
await page.mouse.down();
await sleep(200);
await page.mouse.move(dragX + 20, dragY + 20, { steps: 2 });
await sleep(200);
await page.mouse.move(dragX + 120, dragY + 90, { steps: 4 });
await sleep(250);

await page.screenshot({ path: SHOT_DIR + "/picking-dragging.png" });
await page.mouse.up();
await sleep(800);

const panelsAfter = await readPanelCount();
record("扣选期间拖拽确实生成了新分镜", panelsAfter === panelsBefore + 1, "分镜 " + panelsBefore + " → " + panelsAfter);
await page.screenshot({ path: SHOT_DIR + "/picking-locked.png" });

// D) 退出扣选
await clickByText("退出扣选");
await sleep(700);

// E) 回到同一位置点选原分镜，确认它没有被拖走
await page.mouse.click(probeX, probeY);
await sleep(700);
const after = { x: await readPanelField("X"), y: await readPanelField("Y") };
record(
  "扣选期间已有分镜未被拖动",
  after.x === before.x && after.y === before.y,
  "扣选前 X=" + before.x + " Y=" + before.y + " → 扣选后 X=" + after.x + " Y=" + after.y
);

// F) 退出扣选后，拖拽应当恢复正常
await page.mouse.move(probeX, probeY);
await page.mouse.down();
await page.mouse.move(probeX + 16, probeY + 16, { steps: 3 });
await page.mouse.move(probeX + 170, probeY + 150, { steps: 8 });
await page.mouse.up();
await sleep(800);
const moved = { x: await readPanelField("X"), y: await readPanelField("Y") };
record(
  "退出扣选后拖拽恢复正常",
  moved.x !== after.x || moved.y !== after.y,
  "拖动前 X=" + after.x + " Y=" + after.y + " → 拖动后 X=" + moved.x + " Y=" + moved.y
);

// G) Esc 退出：开启扣选后按一次 Esc 应直接退出工具
await clickByText("矩形扣选");
await sleep(500);
await page.keyboard.press("Escape");
await sleep(600);
const escExited = await page.evaluate(() => !document.body.innerText.includes("画布已锁定"));
record("扣选中按 Esc 可退出", escExited);

// H) 松手位置超出画布可视区时取景不应丢失（改为 window 监听后应可完成）
await clickByText("矩形扣选");
await sleep(600);
const beforeOverflow = await readPanelCount();
const overStartX = canvasBox.x + 200;
const overStartY = canvasBox.y + 100;
const overEndX = canvasBox.x + 400;
const overEndY = canvasBox.y + 774; // 仍在视口内，但已越过滚动容器底边

await page.mouse.move(overStartX, overStartY);
await page.mouse.down();
await sleep(160);
await page.mouse.move(overStartX + 30, overStartY + 30, { steps: 2 });
await sleep(160);
await page.mouse.move(overEndX, overEndY, { steps: 5 });
await sleep(220);
await page.mouse.up();
await sleep(900);

const afterOverflow = await readPanelCount();
record(
  "松手移出画布仍能完成取景",
  afterOverflow === beforeOverflow + 1,
  "分镜 " + beforeOverflow + " → " + afterOverflow
);
await clickByText("退出扣选");
await sleep(400);

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
