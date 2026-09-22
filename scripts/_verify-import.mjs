import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

// 端到端校验：真的从界面导入十几张图，走的是用户那条路。
// 覆盖三件事：不会报错、分批真的发生了、图真的落了盘（刷新后还在）。
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? ROOT + "/_shots";
const LIBRARY = ROOT + "/uploads/已导入图片.json";

mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (detail ? "   [" + detail + "]" : ""));
}

guardUploads();
rmSync(LIBRARY, { force: true });

const libraryNow = () => {
  if (!existsSync(LIBRARY)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(LIBRARY, "utf8"));
  } catch {
    return null;
  }
};

const IMAGE_COUNT = 12;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 900 }
});

const errors = [];
const uploadCalls = [];
let files = [];

try {
  // ---- 造 12 张真图：1600×1200 满噪点，PNG 压不动，每张约 3MB ----
  const assetPage = await browser.newPage();
  for (let index = 0; index < IMAGE_COUNT; index += 1) {
    const dataUrl = await assetPage.evaluate((seed) => {
      const width = 1600;
      const height = 1200;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const image = context.createImageData(width, height);
      const data = image.data;
      for (let p = 0; p < data.length; p += 4) {
        data[p] = (p * 7 + seed * 11) % 255;
        data[p + 1] = (p * 13 + seed * 29) % 255;
        data[p + 2] = (p * 29 + seed * 47) % 255;
        data[p + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    }, index);
    const file = SHOT_DIR + "/import-probe-" + index + ".png";
    writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    files.push(file);
  }
  await assetPage.close();
  const totalBytes = files.reduce((sum, file) => sum + readFileSync(file).length, 0);
  // 真正决定写入体积的是 base64 之后的字符数，比原始 PNG 大约 1/3
  const encodedMb = (totalBytes * 4) / 3 / 1048576;
  console.log("造好 " + files.length + " 张原稿，PNG 合计 " + (totalBytes / 1048576).toFixed(1) + "MB，编码后约 " + encodedMb.toFixed(1) + "MB");
  record("测试素材够大，能压出真实的写入体积", encodedMb > 24, encodedMb.toFixed(1) + "MB（base64 后）");

  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push("console: " + message.text().slice(0, 160));
    }
  });

  // 拦一次 append 让它返回 500，验证"写不进去"时界面会不会吭声。
  // 顺便统计每次 append 的体积，用来看切批有没有真的发生。
  let failNextAppend = false;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().includes("/api/uploads/append")) {
      uploadCalls.push({ bytes: (request.postData() ?? "").length });
      if (failNextAppend) {
        failNextAppend = false;
        void request.respond({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "模拟写入失败" })
        });
        return;
      }
    }
    void request.continue();
  });

  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(1200);

  const poolCount = () => page.evaluate(() => document.querySelectorAll("[data-pooled-image]").length);

  // ---- 走界面导入 ----
  const opened = await page.evaluate(() => {
    const button = document.querySelector('[data-tool="import-images"]');
    if (!button) {
      return false;
    }
    button.click();
    return true;
  });
  record("能打开导入窗口", opened);
  await sleep(800);

  await (await page.$("[data-import-images-input]")).uploadFile(...files);
  await sleep(4000);

  const staged = await page.evaluate(() => {
    const modal = document.querySelector("[data-import-images-modal]") ?? document.body;
    return modal.innerText.match(/(\d+)\s*张/)?.[1] ?? null;
  });
  console.log("待导入列表提示：" + staged);

  await page.click("[data-import-confirm]");
  // 36MB 要上传 + 落盘，给足时间
  await sleep(12000);

  record("导入过程没有抛出页面错误", errors.length === 0, errors.slice(0, 3).join(" | "));

  const afterImport = libraryNow();
  record(
    "十几张一次导入全部落盘",
    afterImport?.images?.length === IMAGE_COUNT,
    "磁盘上=" + (afterImport?.images?.length ?? "无文件") + " / 期望 " + IMAGE_COUNT
  );

  const appendCalls = uploadCalls.length;
  const maxBatch = uploadCalls.reduce((max, call) => Math.max(max, call.bytes), 0);
  record("走了增量追加接口（不是全量写回）", appendCalls > 0, "append 请求 " + appendCalls + " 次");
  record(
    "按体积切成了多批，每批都在上限内",
    appendCalls >= 2 && maxBatch < 64 * 1024 * 1024,
    "最大单批 " + (maxBatch / 1048576).toFixed(1) + "MB"
  );

  await page.click('[data-tool="images"]');
  await sleep(900);
  const poolAfterImport = await poolCount();
  record("「已导入图片」栏显示的数量与库一致", poolAfterImport === IMAGE_COUNT, "栏里=" + poolAfterImport);

  // ---- 刷新后仍在（证明是落了盘而不是只在内存）----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
  await sleep(2500);
  const persisted = libraryNow();
  record("刷新之后库还在", persisted?.images?.length === IMAGE_COUNT, "磁盘上=" + (persisted?.images?.length ?? "无"));

  await page.click('[data-tool="images"]');
  await sleep(1200);
  const poolAfterReload = await poolCount();
  record("刷新之后栏里照样是这些图", poolAfterReload === IMAGE_COUNT, "栏里=" + poolAfterReload);

  // ---- 第二条反馈：编辑画面不该往这一栏里加东西 ----
  const beforeEdit = await poolCount();
  await page.click('[data-tool="presets"]');
  await sleep(600);
  await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[0]?.click());
  await sleep(900);
  await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[2]?.click());
  await sleep(900);
  await page.click('[data-tool="images"]');
  await sleep(800);
  const afterBubbles = await poolCount();
  record("加了两个对话框之后栏里条数不变", afterBubbles === beforeEdit, "加之前 " + beforeEdit + " → 加之后 " + afterBubbles);

  const kinds = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-pooled-image-kind]")).map((el) =>
      el.getAttribute("data-pooled-image-kind")
    )
  );
  record("栏里只有素材库条目", kinds.length > 0 && kinds.every((k) => k === "stored"), "kind=" + Array.from(new Set(kinds)).join(","));

  // ---- 写不进去时必须吭声（原来是把失败整个吞掉的）----
  const spareFile = SHOT_DIR + "/import-probe-spare.png";
  const sparePage = await browser.newPage();
  const spareData = await sparePage.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 700;
    const context = canvas.getContext("2d");
    const image = context.createImageData(900, 700);
    const data = image.data;
    for (let p = 0; p < data.length; p += 4) {
      data[p] = (p * 31) % 255;
      data[p + 1] = (p * 17) % 255;
      data[p + 2] = (p * 53) % 255;
      data[p + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  });
  await sparePage.close();
  writeFileSync(spareFile, Buffer.from(spareData.split(",")[1], "base64"));
  files.push(spareFile);

  failNextAppend = true;
  await page.evaluate(() => document.querySelector('[data-tool="import-images"]')?.click());
  await sleep(800);
  await (await page.$("[data-import-images-input]")).uploadFile(spareFile);
  await sleep(2500);
  await page.click("[data-import-confirm]");
  await sleep(3000);

  const warned = await page.evaluate(() => document.body.innerText.includes("没能写进素材库"));
  const warningText = await page.evaluate(() => {
    const match = document.body.innerText.match(/原稿没能写进素材库[^\n]*/);
    return match ? match[0] : null;
  });
  record("写入失败时会明确提示，不再静默丢数据", warned, warningText ?? "（界面上没看到提示）");

  // 上面故意注入了一次 500，浏览器必然会记一条资源加载失败，那是预期内的
  const unexpected = errors.filter((line) => !line.includes("status of 500"));
  record("全程没有预期之外的控制台错误", unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  // 十几兆的探针图用完就扔
  for (const file of files) {
    rmSync(file, { force: true });
  }
  rmSync(LIBRARY, { force: true });
  rmSync(LIBRARY + ".bak", { force: true });
  restoreUploads();
}

const failed = results.filter((item) => !item.ok);
console.log("");
console.log("通过 " + (results.length - failed.length) + "/" + results.length);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
}
process.exitCode = failed.length ? 1 : 0;
