import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "D:/dsh工作区/_shots";
const ROOT = "D:/dsh工作区/MangaDialogStudio";
const LIBRARY = ROOT + "/uploads/已导入图片.json";

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(ROOT + "/uploads", { recursive: true });

// 素材库的隔离统一由 _uploads-guard 负责，这里不要再自己备份一遍，
// 两套还原叠加会互相把对方的备份搬回来
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

const assetPage = await browser.newPage();
await assetPage.setViewport({ width: 600, height: 400 });
await assetPage.setContent('<!doctype html><body style="margin:0;background:#0ea5e9"></body>');
const SOURCE_PNG = SHOT_DIR + "/uploads-source.png";
await assetPage.screenshot({ path: SOURCE_PNG });
await assetPage.close();

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

const poolCount = () => page.evaluate(() => document.querySelectorAll("[data-pooled-image]").length);
const readFooter = () =>
  page.evaluate(() => {
    const footer = document.querySelector("footer");
    return footer ? footer.innerText.replace(/\s+/g, " ") : "";
  });

// ---------- 1) 导入原稿，应该同时落一份到 uploads/ ----------
await clickByText("导入图片");
await sleep(700);
const importInput = await page.$("[data-import-images-input]");
await importInput.uploadFile(SOURCE_PNG);
await sleep(2500);
await page.click("[data-import-confirm]");
await sleep(3000);

// 导入只进素材库，要变成胶片页得拖到胶片栏上
async function materialToPage() {
  await page.click('[data-tool="images"]');
  await sleep(700);
  await page.evaluate(() => {
    const tile = document.querySelector("[data-pooled-image]");
    const list = document.querySelector("[data-thumb-list]");
    if (!tile || !list) return;
    const dataTransfer = new DataTransfer();
    tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer };
    list.dispatchEvent(new DragEvent("dragover", options));
    list.dispatchEvent(new DragEvent("drop", options));
  });
  await sleep(2000);
}

// 先把它拖成一张胶片页，后面要验证「删掉页面后原稿还在」
await materialToPage();

record("原稿导入后写入了 uploads/", existsSync(LIBRARY), existsSync(LIBRARY) ? LIBRARY.split("/").pop() : "文件不存在");

const libraryPayload = await page.evaluate(async () => {
  const response = await fetch("/api/uploads", { cache: "no-store" });
  const payload = await response.json();
  return { files: Array.isArray(payload?.files) ? payload.files : [] };
});
record(
  "服务端能列出 uploads/ 库文件",
  libraryPayload.files.length >= 1,
  libraryPayload.files.map((item) => String(item.name) + "(" + String(item.detail ?? "") + ")").join(", ")
);

await page.click('[data-tool="images"]');
await sleep(700);
const afterImport = await poolCount();
record("导入的原稿出现在「已导入图片」栏", afterImport >= 1, "图片数=" + afterImport);

// ---------- 2) 删掉页面，原稿应该还在 ----------
const footerBefore = await readFooter();
const pagesBefore = Number((footerBefore.match(/Page\s*(\d+)/) ?? [0, 0])[1]);
record("导入后确实生成了页面", pagesBefore >= 1, footerBefore.slice(0, 60));

// 胶片栏的删除按钮文案是 ✕
const removed = await page.evaluate(() => {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    (item.innerText ?? "").trim() === "✕"
  );
  if (!button || button.disabled) {
    return false;
  }
  button.click();
  return true;
});
record("能在胶片栏删掉这一页", removed);
await sleep(1500);

const footerAfter = await readFooter();
const pagesAfter = Number((footerAfter.match(/Page\s*(\d+)/) ?? [0, 0])[1]);
record("页面确实被删掉了", pagesAfter < pagesBefore || pagesAfter === 0, "删除前 " + pagesBefore + " 页 → 删除后 " + pagesAfter + " 页");

await sleep(600);
const afterDelete = await poolCount();
record(
  "删掉页面后，左侧「已导入图片」里的原稿仍然保留",
  afterDelete >= 1,
  "删除前 " + afterImport + " 张 → 删除后 " + afterDelete + " 张"
);
await page.screenshot({ path: SHOT_DIR + "/uploads-after-delete.png" });

// ---------- 3) 刷新后仍在（证明是文件而不是内存） ----------
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);
await page.click('[data-tool="images"]');
await sleep(1200);
const afterReload = await poolCount();
record(
  "刷新页面后原稿仍在（来自 uploads/ 而非内存）",
  afterReload >= 1,
  "刷新后图片数=" + afterReload
);

// ---------- 4) 拖回来还能用 ----------
const dropped = await page.evaluate(() => {
  const tile = document.querySelector("[data-pooled-image]");
  const canvas = document.querySelector(".studio-workspace > div");
  if (!tile || !canvas) {
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + rect.width * 0.5;
  const clientY = rect.top + rect.height * 0.5;
  const dataTransfer = new DataTransfer();
  tile.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
  const options = { bubbles: true, cancelable: true, dataTransfer, clientX, clientY };
  canvas.dispatchEvent(new DragEvent("dragover", options));
  canvas.dispatchEvent(new DragEvent("drop", options));
  return true;
});
await sleep(1500);
const backOnCanvas = await page.evaluate(() => document.body.innerText.includes("图片层"));
record("保留下来的原稿可以重新拖回画布", dropped && backOnCanvas, backOnCanvas ? "已生成图片层" : "未生成");

record("全过程没有抛出页面错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
restoreUploads();

const failed = results.filter((item) => !item.ok);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
process.exit(failed.length === 0 ? 0 : 1);
