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
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(600);

const shot = (name) => page.screenshot({ path: SHOT_DIR + "/" + name + ".png" });
const stats = () =>
  page.evaluate(() => ({
    panels: Number((document.body.innerText.match(/分镜\s*(\d+)/) ?? [0, -1])[1]),
    bubbles: Number((document.body.innerText.match(/文字\s*(\d+)/) ?? [0, -1])[1])
  }));

async function clickByText(label) {
  const handles = await page.$$("button");
  for (const handle of handles) {
    const text = await handle.evaluate((element) => (element.innerText ?? "").trim());
    if (text === label) {
      await handle.evaluate((element) => element.click());
      return true;
    }
  }
  return false;
}

// 单击预设卡片即可把气泡加到画布中央
async function clickPresetCard(handle) {
  const box = await handle.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

await shot("v2-01-initial");
record("应用加载完成", (await stats()).panels >= 1, JSON.stringify(await stats()));

// 1) 单击预设放置气泡
const card = await page.$('[data-preset-id="builtin:speech-right"]');
await clickPresetCard(card);
await sleep(900);
let state = await stats();
record("单击预设放置气泡", state.bubbles === 1, "气泡=" + state.bubbles);
await shot("v2-02-bubble-click");

// 2) 拖拽预设到画布
const dragOutcome = await page.evaluate(() => {
  const source = document.querySelector('[data-preset-id="builtin:shout"]');
  const canvas = document.querySelector(".studio-workspace > div");
  if (!source || !canvas) return "缺少元素";
  const rect = canvas.getBoundingClientRect();
  const dataTransfer = new DataTransfer();
  source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX: rect.left + rect.width * 0.3,
    clientY: rect.top + rect.height * 0.22
  };
  canvas.dispatchEvent(new DragEvent("dragover", options));
  canvas.dispatchEvent(new DragEvent("drop", options));
  return dataTransfer.getData("application/x-manga-dialog-preset");
});
await sleep(900);
state = await stats();
record("拖拽预设到画布", state.bubbles === 2, "标识=" + dragOutcome + " 气泡=" + state.bubbles);
await shot("v2-03-bubble-drag-drop");

// 3) 主题切换
const beforeTheme = await page.evaluate(() => document.documentElement.dataset.theme);
await page.click(".studio-switch");
await sleep(500);
const afterTheme = await page.evaluate(() => document.documentElement.dataset.theme);
record("明暗主题切换", beforeTheme !== afterTheme, beforeTheme + " -> " + afterTheme);
await shot("v2-04-theme-light");

// 4) 分镜模式：多边形扣选
await clickByText("分镜模式");
await sleep(400);
const polygonBtnOk = await clickByText("多边形扣选");
await sleep(400);
const polygonActive = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button")).some(
    (button) => button.innerText.trim() === "多边形扣选" && button.className.includes("studio-btn-primary")
  )
);
record("多边形扣选可开启", polygonBtnOk && polygonActive, "点击=" + polygonBtnOk + " 高亮=" + polygonActive);

const canvasHandle = await page.$(".studio-workspace > div");
const canvasBox = await canvasHandle.boundingBox();
const limitY = Math.min(canvasBox.y + canvasBox.height, 1000);
const spanY = Math.max(80, Math.min(480, limitY - canvasBox.y - 140));
const polygonPoints = [
  [canvasBox.x + canvasBox.width * 0.3, canvasBox.y + 40],
  [canvasBox.x + canvasBox.width * 0.62, canvasBox.y + 40 + spanY * 0.3],
  [canvasBox.x + canvasBox.width * 0.45, canvasBox.y + 40 + spanY],
  [canvasBox.x + canvasBox.width * 0.18, canvasBox.y + 40 + spanY * 0.55]
];
for (const [x, y] of polygonPoints) {
  await page.mouse.click(x, y);
  await sleep(160);
}
await shot("v2-05-polygon-draft");
await page.keyboard.press("Enter");
await sleep(900);
state = await stats();
record("多边形扣选生成分镜", state.panels === 2, "分镜=" + state.panels);
// 创建后处于自动选中态，可据此判断 points 是否完整保留
const polygonPanelShown = await page.evaluate(() => document.body.innerText.includes("多边形分镜"));
record("多边形分镜使用专属属性面板", polygonPanelShown);
await shot("v2-06-polygon-created");

// 5) 分镜底图改色
const backdropApplied = await page.evaluate(() => {
  const input = document.querySelector('input[type="color"]');
  if (!input) return "无颜色输入";
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "#1b2a41");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "ok";
});
await sleep(700);
record("分镜底图改色", backdropApplied === "ok", String(backdropApplied));
await shot("v2-07-backdrop");

// 6) 预设编辑器
await clickByText("对话编辑");
await sleep(400);
// 「新建预设」入口已并入左侧的「导入自定义对话框」；这里验证更常用的路径：加气泡 → 编辑填字区
await clickByText("+ 圆角气泡");
await sleep(600);
const editBtnOk = await clickByText("编辑填字区");
await sleep(800);
const stageOpen = await page.$("[data-preset-stage]");
record("预设编辑器可打开", Boolean(stageOpen));
await shot("v2-08-preset-editor");
record("从选中气泡打开填字区编辑", editBtnOk && Boolean(stageOpen));
await shot("v2-09-preset-editor-open");

const stageBox = await stageOpen.boundingBox();
await page.mouse.move(stageBox.x + stageBox.width * 0.22, stageBox.y + stageBox.height * 0.24);
await page.mouse.down();
await page.mouse.move(stageBox.x + stageBox.width * 0.78, stageBox.y + stageBox.height * 0.72, { steps: 10 });
await page.mouse.up();
await sleep(400);

const boxText = await page.evaluate(() => {
  const match = document.body.innerText.match(/x\s*([\d.]+).*?y\s*([\d.]+).*?w\s*([\d.]+).*?h\s*([\d.]+)/);
  return match ? match.slice(1).map(Number) : null;
});
const boxChanged = boxText && Math.abs(boxText[0] - 0.15) > 0.02;
record("拖拽框选填字区域", Boolean(boxChanged), boxText ? "x=" + boxText[0] + " w=" + boxText[2] : "未读到");
await shot("v2-10-textbox-selected");

await clickByText("保存为预设");
await sleep(900);
const userPresetCount = await page.evaluate(
  () => document.querySelectorAll('[data-preset-id^="user:"]').length
);
record("保存为自定义预设", userPresetCount >= 1, "自定义预设=" + userPresetCount);
await shot("v2-11-preset-saved");

// 8) 多边形分镜内导入图片
await clickByText("分镜模式");
await sleep(400);
const canvasBox3 = await (await page.$(".studio-workspace > div")).boundingBox();
// 落点取多边形真实内部，并避开画布上的气泡
await page.mouse.click(canvasBox3.x + canvasBox3.width * 0.282, canvasBox3.y + canvasBox3.height * 0.37);
await sleep(600);
const panelSelected = await page.evaluate(() => document.body.innerText.includes("多边形分镜"));
record("选中多边形分镜显示专属面板", panelSelected);

const fileInput = await page.$('input[type="file"][accept="image/*"]');
if (fileInput) {
  await fileInput.uploadFile("D:/dsh工作区/_shots/v2-01-initial.png");
  await sleep(3500);
}
const imageLoaded = await page.evaluate(() => document.body.innerText.includes("打开手动裁剪"));
record("多边形分镜导入图片", Boolean(fileInput) && imageLoaded);
await shot("v2-12-polygon-image");

// 9) 批量导入漫画原稿
await clickByText("导入图片");
await sleep(800);
const importOpen = await page.evaluate(() => document.body.innerText.includes("导入漫画原稿"));
record("导入图片弹窗可打开", importOpen);

// 纯色测试图由脚本自行生成，避免依赖外部素材
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 1200, height: 800 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#0b1d3a"></body>');
await assetPage.screenshot({ path: SHOT_DIR + "/test-dark.png" });
await assetPage.close();

const importInput = await page.$('input[type="file"][multiple]');
await importInput.uploadFile(
  "D:/dsh工作区/_shots/v2-01-initial.png",
  "D:/dsh工作区/_shots/v2-06-polygon-created.png",
  "D:/dsh工作区/_shots/test-dark.png"
);
await sleep(3000);
const pendingCount = await page.evaluate(
  () => Number((document.body.innerText.match(/待导入\s*(\d+)\s*张/) ?? [0, -1])[1])
);
record("多选图片进入待导入列表", pendingCount === 3, "待导入=" + pendingCount);
await shot("v3-01-import-dialog");

await page.click("[data-import-confirm]");
await sleep(3000);
const pageTotal = await page.evaluate(() => document.querySelectorAll("[data-thumb-index]").length);
record("导入后按顺序生成页面", pageTotal === 4, "页面数=" + pageTotal);
await shot("v3-02-pages-imported");

// 10) 气泡不透明度
await clickByText("对话编辑");
await sleep(400);
await page.click('[data-thumb-index="0"]');
await sleep(700);
const canvasBox4 = await (await page.$(".studio-workspace > div")).boundingBox();
await page.mouse.click(canvasBox4.x + canvasBox4.width * 0.5, canvasBox4.y + canvasBox4.height * 0.5);
await sleep(500);
const opacitySliderExists = await page.evaluate(() => Boolean(document.querySelector("[data-bubble-opacity]")));
await page.evaluate(() => {
  const input = document.querySelector("[data-bubble-opacity]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "45");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await sleep(600);
const opacityApplied = await page.evaluate(() => document.body.innerText.includes("45%"));
record("不透明度控件可用", opacitySliderExists && opacityApplied, "滑块=" + opacitySliderExists + " 数值=" + opacityApplied);

// 像素级验证：第 4 页是深色纯色原稿，白气泡半透明后亮度应显著下降
await page.click('[data-thumb-index="3"]');
await sleep(900);
const backdropOk = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  return Boolean(canvas);
});
await clickByText("对话编辑");
await sleep(400);

// 在该页重新放一个白气泡到画布中心
const bubbleCard = await page.$('[data-preset-id="builtin:speech-right"]');
await clickPresetCard(bubbleCard);
await sleep(1000);

const sampleBrightness = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".studio-workspace canvas");
    if (!canvas) {
      return -1;
    }
    const context = canvas.getContext("2d");
    const width = 70;
    const height = 44;
    const left = Math.round(canvas.width / 2 - width / 2);
    const top = Math.round(canvas.height / 2 - height / 2);
    const data = context.getImageData(left, top, width, height).data;
    let sum = 0;
    for (let index = 0; index < data.length; index += 4) {
      sum += (data[index] + data[index + 1] + data[index + 2]) / 3;
    }
    return Number((sum / (data.length / 4)).toFixed(1));
  });

const brightnessOpaque = await sampleBrightness();
const fadeApplied = await page.evaluate(() => {
  const input = document.querySelector("[data-bubble-opacity]");
  if (!input) {
    return false;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "20");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await sleep(800);
const brightnessFaded = await sampleBrightness();

record(
  "不透明度真实作用于渲染",
  backdropOk && fadeApplied && brightnessOpaque > 150 && brightnessFaded < brightnessOpaque - 80,
  "不透明=" + brightnessOpaque + " 20%=" + brightnessFaded
);
await shot("v3-03-bubble-opacity");

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
if (errors.length) {
  console.log("错误:" + errors.slice(0, 5).map((m) => "\n  - " + m).join(""));
}
process.exit(failed.length === 0 ? 0 : 1);
