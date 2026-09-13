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

const readSize = (label) =>
  page.evaluate((wanted) => {
    const input = document.querySelector('[data-bubble-size-input="' + wanted + '"]');
    return input ? Number(input.value) : null;
  }, label);

const readSlider = (label) =>
  page.evaluate((wanted) => {
    const input = document.querySelector('[data-bubble-size-slider="' + wanted + '"]');
    return input
      ? { min: Number(input.min), max: Number(input.max), value: Number(input.value) }
      : null;
  }, label);

// 走原生 setter，确保 React 能收到变更
const setControl = (selector, value) =>
  page.evaluate(
    ([sel, val]) => {
      const input = document.querySelector(sel);
      if (!input) {
        return false;
      }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, String(val));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    [selector, value]
  );

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(600);

// 单击预设放置气泡（会自动选中，属性面板随之出现）
const card = await page.$('[data-preset-id="builtin:speech-right"]');
const box = await card.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(900);

const slider = await readSlider("宽度");
record(
  "宽度滑条范围为 30–1000",
  Boolean(slider) && slider.min === 30 && slider.max === 1000,
  slider ? slider.min + " – " + slider.max : "未找到滑条"
);

const heightSlider = await readSlider("高度");
record(
  "高度滑条范围为 30–1000",
  Boolean(heightSlider) && heightSlider.min === 30 && heightSlider.max === 1000,
  heightSlider ? heightSlider.min + " – " + heightSlider.max : "未找到滑条"
);

// 拖动滑条到中段
await setControl('[data-bubble-size-slider="宽度"]', 800);
await sleep(500);
record("拖动滑条可改变宽度", (await readSize("宽度")) === 800, "宽度=" + (await readSize("宽度")));

await setControl('[data-bubble-size-slider="高度"]', 640);
await sleep(500);
record("拖动滑条可改变高度", (await readSize("高度")) === 640, "高度=" + (await readSize("高度")));

// 手动输入不受滑条上限约束
await setControl('[data-bubble-size-input="宽度"]', 2500);
await sleep(500);
const wide = await readSize("宽度");
record("手动输入可超过 1000", wide === 2500, "宽度=" + wide);

const sliderWhenExceed = await readSlider("宽度");
record(
  "超出范围时滑条停在末端且不回写",
  sliderWhenExceed.value === 1000 && (await readSize("宽度")) === 2500,
  "滑条=" + sliderWhenExceed.value + " 实际=" + (await readSize("宽度"))
);

const hintShown = await page.evaluate(() => document.body.innerText.includes("已超出滑条范围"));
record("超出范围有文字提示", hintShown);

// 低于下限应被抬到 30
await setControl('[data-bubble-size-input="高度"]', 5);
await sleep(500);
const tiny = await readSize("高度");
record("输入低于 30 会被抬到 30", tiny === 30, "高度=" + tiny);

await setControl('[data-bubble-size-slider="高度"]', 30);
await sleep(500);
record("滑条可拉到最小 30", (await readSize("高度")) === 30, "高度=" + (await readSize("高度")));

// 属性面板较长，把尺寸控件滚进视野再截图，便于确认布局
await page.evaluate(() => {
  document.querySelector('[data-bubble-size-slider="宽度"]')?.scrollIntoView({ block: "center" });
});
await sleep(600);
await page.screenshot({ path: SHOT_DIR + "/bubble-size-slider.png" });
record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
