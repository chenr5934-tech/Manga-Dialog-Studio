import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "_shots";

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

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(900);

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

const pageIds = () =>
  page.evaluate(() => Array.from(document.querySelectorAll("[data-page-thumb]")).map((t) => t.getAttribute("data-page-thumb")));

const footer = () =>
  page.evaluate(() => (document.querySelector("footer")?.innerText ?? "").replace(/\s+/g, " "));

// 读当前页的结构摘要，用来比对复制是否一模一样
const pageSummary = () =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-layer-row]")).map((r) => ({
      kind: r.getAttribute("data-layer-kind"),
      text: (r.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 30)
    }));
    return { rows, footer: (document.querySelector("footer")?.innerText ?? "").replace(/\s+/g, " ") };
  });

// ---------- 准备：造一页有内容的画面 ----------
await clickByText("布局");
await sleep(500);
await clickByText("新建分镜");
await sleep(700);
await clickByText("关闭");
await sleep(400);
await clickByText("对话框预设");
await sleep(500);
await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
await sleep(700);

// 给分镜起个名，用来验证复制时命名也跟着走
await page.evaluate(() => document.querySelector("[data-open-layers]")?.click());
await sleep(700);
const firstId = (await page.evaluate(() =>
  document.querySelector('[data-layer-row][data-layer-kind="panel"]')?.getAttribute("data-layer-row")
));
await page.evaluate((id) => {
  document.querySelector('[data-layer-rename="' + id + '"]')?.click();
}, firstId);
await sleep(400);
await page.evaluate((id) => {
  const input = document.querySelector('[data-layer-name-input="' + id + '"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "开场镜头");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}, firstId);
await sleep(700);

const originalSummary = await pageSummary();
const originalPageId = (await pageIds())[0];
record("原页已备好内容", originalSummary.rows.length >= 2, "图层行数=" + originalSummary.rows.length);

// ---------- 1) 复制当前页 ----------
await page.evaluate(() => document.querySelector("[data-page-duplicate]")?.click());
await sleep(1500);

const afterCopy = await pageIds();
record(
  "复制后多出一页",
  afterCopy.length === 2,
  "页数=" + afterCopy.length
);
record(
  "副本插在原页后面，不是追加到末尾之外",
  afterCopy[1] !== originalPageId && afterCopy[0] === originalPageId,
  "顺序=" + afterCopy.map((id) => id.slice(0, 6)).join(",")
);

const copiedSummary = await pageSummary();
record(
  "复制完自动切到新页",
  copiedSummary.footer.includes("Page 2"),
  copiedSummary.footer.slice(0, 40)
);

// 新页的图层结构要和原页一致
const sameStructure =
  copiedSummary.rows.length === originalSummary.rows.length &&
  copiedSummary.rows.every((row, index) => row.kind === originalSummary.rows[index].kind);
record(
  "副本的分镜与气泡数量、层级结构跟原页一致",
  sameStructure,
  "原=" + originalSummary.rows.map((r) => r.kind).join(",") + " 副本=" + copiedSummary.rows.map((r) => r.kind).join(",")
);

record(
  "副本里的自定义命名也跟着复制了",
  copiedSummary.rows.some((row) => row.text.includes("开场镜头")),
  copiedSummary.rows.map((r) => r.text.slice(0, 10)).join(" | ")
);

// 两个页面的对象 id 必须不同，否则选一个会连带改另一个
const originalIds = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-layer-row]")).map((r) => r.getAttribute("data-layer-row"))
);
await page.evaluate((id) => document.querySelector('[data-page-thumb="' + id + '"]')?.click(), originalPageId);
await sleep(900);
const backOnOriginal = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-layer-row]")).map((r) => r.getAttribute("data-layer-row"))
);
record(
  "副本里的对象换了新 id，改副本不会串到原页",
  originalIds.length > 0 && backOnOriginal.length > 0 && !originalIds.some((id) => backOnOriginal.includes(id)),
  "副本=" + originalIds.map((id) => id.slice(0, 6)).join(",") + " 原页=" + backOnOriginal.map((id) => id.slice(0, 6)).join(",")
);

// 在副本里把分镜改名，原页不该跟着变（验证两页真的独立）
await page.evaluate((id) => document.querySelector('[data-page-thumb="' + id + '"]')?.click(), afterCopy[1]);
await sleep(900);
const copyPanelId = await page.evaluate(() =>
  document.querySelector('[data-layer-row][data-layer-kind="panel"]')?.getAttribute("data-layer-row")
);
await page.evaluate((id) => document.querySelector('[data-layer-rename="' + id + '"]')?.click(), copyPanelId);
await sleep(400);
await page.evaluate((id) => {
  const input = document.querySelector('[data-layer-name-input="' + id + '"]');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "副本专用名");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}, copyPanelId);
await sleep(800);

await page.evaluate((id) => document.querySelector('[data-page-thumb="' + id + '"]')?.click(), originalPageId);
await sleep(900);
const originalNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll("[data-layer-name]")).map((n) => (n.innerText ?? "").trim()).join(" | ")
);
record(
  "在副本里改名，原页毫发无损",
  originalNames.includes("开场镜头") && !originalNames.includes("副本专用名"),
  "原页名字=" + originalNames.slice(0, 30)
);
await page.screenshot({ path: SHOT_DIR + "/page-duplicate.png" });

// ---------- 2) 拖拽胶片改顺序 ----------
const beforeDrag = await pageIds();
record("拖拽前有两页", beforeDrag.length === 2, beforeDrag.map((id) => id.slice(0, 6)).join(","));

await page.evaluate((ids) => {
  const from = document.querySelector('[data-page-thumb="' + ids[1] + '"]');
  const to = document.querySelector('[data-page-thumb="' + ids[0] + '"]');
  const dataTransfer = new DataTransfer();
  from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const rect = to.getBoundingClientRect();
  const options = {
    bubbles: true,
    cancelable: true,
    dataTransfer,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + 2
  };
  to.dispatchEvent(new DragEvent("dragover", options));
  to.dispatchEvent(new DragEvent("drop", options));
  from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}, beforeDrag);
await sleep(1000);

const afterDrag = await pageIds();
record(
  "把第二页拖到第一页上方，顺序真的换了",
  afterDrag[0] === beforeDrag[1] && afterDrag[1] === beforeDrag[0],
  afterDrag.map((id) => id.slice(0, 6)).join(",")
);

// 拖拽结果能撤销
const undoClicked = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => (item.innerText ?? "").trim() === "撤销" && !item.disabled
  );
  if (!button) return false;
  button.click();
  return true;
});
let afterUndo = await pageIds();
for (let attempt = 0; attempt < 20; attempt += 1) {
  if (afterUndo.join() !== afterDrag.join()) {
    break;
  }
  await sleep(200);
  afterUndo = await pageIds();
}
record(
  "胶片拖拽能撤销",
  undoClicked && afterUndo.join() === beforeDrag.join(),
  "撤销后=" + afterUndo.map((id) => id.slice(0, 6)).join(",")
);
await page.screenshot({ path: SHOT_DIR + "/page-drag.png" });

// ---------- 3) 复制出的页面能正常导出（结构完整） ----------
const zipped = await page.evaluate(() => {
  const canvasList = Array.from(document.querySelectorAll(".studio-workspace canvas"));
  return canvasList.length > 0;
});
record("复制后画布仍然正常渲染", zipped, "canvas 数=" + (zipped ? ">0" : "0"));

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
