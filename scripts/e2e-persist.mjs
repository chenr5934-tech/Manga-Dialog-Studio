import puppeteer from "puppeteer-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const TMP = "D:/dsh工作区/_shots";

mkdirSync(TMP, { recursive: true });
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

// 1) 造一张底图，用于验证页面底图的往返
const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 1200, height: 800 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#0e7490"></body>');
const pngPath = TMP + "/persist-bg.png";
await assetPage.screenshot({ path: pngPath });
await assetPage.close();

// 2) 构造带全部新增字段的项目文件
const dataUrl = "data:image/png;base64," + readFileSync(pngPath).toString("base64");
const project = {
  id: "persist-test",
  name: "往返测试项目",
  activePageId: "p1",
  pages: [
    {
      id: "p1",
      name: "第 1 页",
      canvas: { width: 1200, height: 800, preset: "custom", dpi: 300 },
      backdropColor: "#102030",
      background: { original: dataUrl, naturalWidth: 1200, naturalHeight: 800, mimeType: "image/png" },
      panels: [
        {
          id: "panel-poly",
          x: 200,
          y: 150,
          width: 500,
          height: 400,
          rotation: 0,
          shape: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0.1 },
            { x: 0.8, y: 1 },
            { x: 0.1, y: 0.7 }
          ],
          borderWidth: 4,
          borderColor: "#ff0000",
          borderRadius: 0,
          gap: 0
        }
      ],
      bubbles: [
        {
          id: "bubble-1",
          type: "rect",
          x: 100,
          y: 100,
          width: 300,
          height: 200,
          text: "往返测试文字",
          direction: "horizontal",
          fontSize: 32,
          fontFamily: "Noto Sans SC",
          textColor: "#141a22",
          background: "#ffffff",
          borderColor: "#111827",
          borderWidth: 3,
          opacity: 0.42,
          textBox: { x: 0.2, y: 0.25, width: 0.6, height: 0.5 }
        }
      ]
    }
  ]
};
const jsonPath = TMP + "/persist-project.json";
writeFileSync(jsonPath, JSON.stringify(project, null, 2));

// 3) 加载它
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

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

// 加载用的 input 是动态创建后立刻移除的，puppeteer 的文件选择器拦不住，
// 因此保留该 input 的引用，直接在页面内注入 File 并派发 change，
// 走的仍是同一段加载逻辑。
// loadProject 在支持 showDirectoryPicker 时会走目录选择器，自动化无法模拟；
// 这里屏蔽掉它，强制走 JSON 文件加载分支（两条分支最终都经同一套归一化逻辑）
await page.evaluate(() => {
  Object.defineProperty(window, "showDirectoryPicker", {
    value: undefined,
    configurable: true,
    writable: true
  });
});

await clickByText("更多");
await sleep(500);
const clickOk = await clickByText("加载项目");
await sleep(900);

const diag = await page.evaluate(() => ({
  clickTargetFound: true,
  pickerType: typeof window.showDirectoryPicker,
  fileInputs: document.querySelectorAll('input[type="file"]').length,
  notice: (document.body.innerText.match(/正在加载项目|已取消加载|项目数据格式无效|项目加载完成|旧版项目/) ?? ["(无提示)"])[0]
}));
console.log("  诊断: 点击=" + clickOk + " " + JSON.stringify(diag));

const dispatchResult = await page.evaluate((jsonText) => {
  // 该 input 在等待选择期间仍在 DOM 中，取最后一个 json 类输入即为它
  const candidates = Array.from(document.querySelectorAll('input[type="file"]')).filter(
    (element) => typeof element.accept === "string" && element.accept.includes("json")
  );
  const input = candidates[candidates.length - 1];
  if (!input) {
    return "未找到加载用的 file input";
  }
  const transfer = new DataTransfer();
  transfer.items.add(new File([jsonText], "persist-project.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return "已派发 change（候选 " + candidates.length + " 个）";
}, JSON.stringify(project));
console.log("  注入结果: " + dispatchResult);
await sleep(2500);

const bodyText = await page.evaluate(() => document.body.innerText);
record("项目文件加载不报错", errors.length === 0, errors.slice(0, 1).join(""));

// 项目名在输入框的 value 里，innerText 读不到
const projectName = await page.evaluate(
  () => document.querySelector('input[placeholder="项目名称"]')?.value ?? null
);
record("项目名已恢复", projectName === "往返测试项目", "值=" + projectName);
record("画布尺寸已恢复", bodyText.includes("1200 x 800"), (bodyText.match(/Canvas [\d x]+/) ?? ["-"])[0]);
record("分镜与文字数量已恢复", /分镜\s*1/.test(bodyText) && /文字\s*1/.test(bodyText));

// 底图是否真的渲染出来了：采样画布左上角（该处无分镜无气泡）
const pixel = await page.evaluate(() => {
  const canvas = document.querySelector(".studio-workspace canvas");
  if (!canvas) return null;
  const context = canvas.getContext("2d");
  const data = context.getImageData(20, 20, 6, 6).data;
  return [data[0], data[1], data[2]];
});
const isTeal = pixel && pixel[0] < 80 && pixel[1] > 80 && pixel[2] > 100;
record("页面底图已恢复渲染", Boolean(isTeal), "左上角像素 rgb(" + (pixel ?? []).join(",") + ") 期望接近青色(14,116,144)");

// 选中多边形分镜（点其内部、避开气泡）
const canvasBox = await (await page.$(".studio-workspace > div")).boundingBox();
await page.mouse.click(canvasBox.x + 450 * 0.27, canvasBox.y + 350 * 0.27);
await sleep(700);
const afterPanelClick = await page.evaluate(() =>
  Array.from(document.querySelectorAll("h3")).map((h) => h.innerText.trim())
);
record("多边形顶点已保留（专属面板）", afterPanelClick.includes("多边形分镜"), afterPanelClick.join("/"));

// 选中气泡，检查不透明度与填字区域
await page.mouse.click(canvasBox.x + 250 * 0.27, canvasBox.y + 200 * 0.27);
await sleep(700);
const bubbleState = await page.evaluate(() => {
  const slider = document.querySelector("[data-bubble-opacity]");
  const text = document.body.innerText;
  const box = text.match(/x\s*([\d.]+).*?y\s*([\d.]+).*?w\s*([\d.]+).*?h\s*([\d.]+)/);
  return {
    opacity: slider ? slider.value : null,
    textBox: box ? box.slice(1).join(",") : null,
    hasText: text.includes("往返测试文字")
  };
});
record("气泡不透明度已恢复", bubbleState.opacity === "42", "滑块=" + bubbleState.opacity);

// 气泡文字渲染在 Konva 画布上，需要读属性面板的输入框
const bubbleText = await page.evaluate(() => {
  const textarea = document.querySelector("textarea");
  return textarea ? textarea.value : null;
});
record("气泡文字已恢复", bubbleText === "往返测试文字", "值=" + JSON.stringify(bubbleText));

// 填字区域只在预设编辑器里可见，打开它读取
await clickByText("编辑填字区");
await sleep(900);
const textBoxValue = await page.evaluate(() => {
  const match = document.body.innerText.match(/x\s*([\d.]+)\s*·\s*y\s*([\d.]+)\s*·\s*w\s*([\d.]+)\s*·\s*h\s*([\d.]+)/);
  return match ? match.slice(1).join(",") : null;
});
const textBoxParts = (textBoxValue ?? "").split(",").map(Number);
const expectedTextBox = [0.2, 0.25, 0.6, 0.5];
const textBoxOk =
  textBoxParts.length === 4 && textBoxParts.every((value, index) => Math.abs(value - expectedTextBox[index]) < 0.001);
record("填字区域已恢复", textBoxOk, "值=" + textBoxValue);
await page.keyboard.press("Escape");
await sleep(400);
record("加载过程无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: TMP + "/persist-loaded.png" });
await browser.close();

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
