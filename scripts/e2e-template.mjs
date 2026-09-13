import puppeteer from "puppeteer-core";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const TEMPLATE_DIR = "D:/dsh工作区/MangaDialogStudio/templates";
const TEST_FILE = "e2e-版式模板";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

for (const name of readdirSync(TEMPLATE_DIR)) {
  if (name.startsWith(TEST_FILE)) {
    unlinkSync(join(TEMPLATE_DIR, name));
  }
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

// 造点内容：一个气泡（默认项目已带 1 页 1 分镜）
const card = await page.$('[data-preset-id="builtin:speech-right"]');
const box = await card.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(900);

// 打开模板小窗
const opened = await clickByText("模板");
await sleep(1200);
const header = await page.evaluate(() => {
  const el = document.querySelector('[data-template-library="1"]');
  return el ? el.innerText.replace(/\s+/g, " ").slice(0, 120) : null;
});
record("模板小窗可打开", Boolean(header && header.includes("整册排版")), String(header).slice(0, 50));

// 保存为模板
await page.evaluate(() => {
  const input = document.querySelector("[data-template-save-input]");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "e2e-版式模板");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await sleep(300);
await page.click("[data-template-save-button]");
await sleep(1800);

const filePath = join(TEMPLATE_DIR, TEST_FILE + ".json");
record("保存后磁盘上生成模板文件", existsSync(filePath), readdirSync(TEMPLATE_DIR).join(", "));

let template = null;
if (existsSync(filePath)) {
  template = JSON.parse(readFileSync(filePath, "utf8"));
}

record(
  "模板保留了页面与分镜结构",
  template?.pages?.length === 1 && template?.pages?.[0]?.panels?.length === 1,
  "页=" + (template?.pages?.length ?? 0) + " 分镜=" + (template?.pages?.[0]?.panels?.length ?? 0)
);

record(
  "模板保留了气泡摆位",
  (template?.pages?.[0]?.bubbles?.length ?? 0) === 1,
  "气泡=" + (template?.pages?.[0]?.bubbles?.length ?? 0)
);

// 核心：图片必须被剥离
const panelHasImage = Boolean(template?.pages?.[0]?.panels?.[0]?.image);
const pageHasBackground = Boolean(template?.pages?.[0]?.background);
record(
  "模板不包含图片数据",
  !panelHasImage && !pageHasBackground,
  "分镜图=" + panelHasImage + " 页底图=" + pageHasBackground
);

// 从模板新建
const listShown = await page.evaluate(
  (name) => Boolean(document.querySelector('[data-template-use="' + name + '"]')),
  TEST_FILE + ".json"
);
record("小窗列出模板并显示规模", listShown, await page.evaluate(() => {
  const el = document.querySelector("[data-template-file]");
  return el ? el.innerText.replace(/\s+/g, " ").slice(0, 60) : "无";
}));

await page.click('[data-template-use="' + TEST_FILE + '.json"]');
await sleep(1800);
const afterApply = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    pages: Number((text.match(/页\s*(\d+)\s*\/\s*(\d+)/) ?? [0, 0, 0])[2]) || null,
    panels: Number((text.match(/分镜\s*(\d+)/) ?? [0, -1])[1]),
    bubbles: Number((text.match(/文字\s*(\d+)/) ?? [0, -1])[1]),
    notice: (text.match(/已从模板新建[^\n]{0,20}/) ?? [""])[0]
  };
});
record(
  "从模板新建后版式恢复",
  afterApply.panels === 1 && afterApply.bubbles === 1,
  "分镜=" + afterApply.panels + " 文字=" + afterApply.bubbles + " " + afterApply.notice
);
await page.screenshot({ path: "D:/dsh工作区/_shots/template-library.png" });

record("运行期无控制台错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
for (const name of readdirSync(TEMPLATE_DIR)) {
  if (name.startsWith(TEST_FILE)) {
    unlinkSync(join(TEMPLATE_DIR, name));
  }
}

const failed = results.filter((entry) => !entry.ok);
console.log("");
console.log("结果: " + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
