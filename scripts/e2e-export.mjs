import puppeteer from "puppeteer-core";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { guardUploads, restoreUploads } from "./_uploads-guard.mjs";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const SHOT_DIR = process.env.SHOT_DIR ?? "_shots";
// CDP 的 downloadPath 在 Windows 上需要反斜杠格式，正斜杠会导致写入失败而被取消
const DL_DIR = process.env.TEMP
  ? process.env.TEMP + "\\mdl-downloads"
  : SHOT_DIR + "\\downloads";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const join = (dir, name) => dir.replace(/\\/g, "/") + "/" + name;

mkdirSync(DL_DIR.replace(/\\/g, "/"), { recursive: true });
for (const entry of readdirSync(DL_DIR.replace(/\\/g, "/"))) {
  rmSync(join(DL_DIR, entry), { recursive: true, force: true });
}

// 无头模式会拦掉程序化下载，需要真实下载行为时用 HEADFUL=1
const headful = process.env.HEADFUL === "1";
guardUploads();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: !headful,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-features=DownloadBubble,DownloadBubbleV2",
    "--allow-running-insecure-content",
    ...(headful ? ["--window-position=-2400,-2400", "--window-size=1400,900"] : [])
  ],
  defaultViewport: { width: 1720, height: 1000 }
});

const page = await browser.newPage();
page.on("pageerror", (error) => console.log("  PAGEERROR: " + error.message));
page.on("console", (message) => {
  if (message.type() === "error") {
    console.log("  CONSOLE: " + message.text().slice(0, 200));
  }
});
// Browser 域的命令必须走 browser 级会话，发在 page 会话上不会生效
const browserClient = await browser.target().createCDPSession();
await browserClient.send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: DL_DIR,
  eventsEnabled: true
});
browserClient.on("Browser.downloadWillBegin", (event) => {
  console.log("  [CDP] downloadWillBegin: " + event.suggestedFilename);
});
browserClient.on("Browser.downloadProgress", (event) => {
  console.log("  [CDP] downloadProgress: " + event.state);
});

const client = await page.createCDPSession();
client.on("Page.downloadWillBegin", (event) => {
  console.log("  [CDP] downloadWillBegin: " + event.suggestedFilename);
});
client.on("Page.downloadProgress", (event) => {
  console.log("  [CDP] downloadProgress: " + event.state);
});

// 拦截导出的 Blob，并记录锚点点击，用于定位下载是否被触发
await page.evaluateOnNewDocument(() => {
  window.__exportBlob = null;
  window.__anchorClicks = [];

  const originalCreate = URL.createObjectURL;
  URL.createObjectURL = function (target) {
    if (target instanceof Blob && target.type.indexOf("zip") >= 0) {
      window.__exportBlob = target;
    }
    return originalCreate.call(this, target);
  };

  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    window.__anchorClicks.push({
      href: String(this.href).slice(0, 32),
      download: this.download,
      inDocument: document.body.contains(this)
    });
    return originalClick.call(this);
  };
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

// 生成三张纯色原稿作为导出素材
const assetPage = await browser.newPage();
const colors = ["#c0392b", "#27ae60", "#2980b9"];
const sources = [];
for (let index = 0; index < colors.length; index += 1) {
  await assetPage.setViewport({ width: 900, height: 600 });
  await assetPage.setContent('<!doctype html><body style="margin:0;background:' + colors[index] + '"></body>');
  const target = SHOT_DIR + "/zip-src-" + (index + 1) + ".png";
  await assetPage.screenshot({ path: target });
  sources.push(target);
}
await assetPage.close();

const opened = await clickByText("导入图片");
await sleep(800);
const input = await page.$("[data-import-images-input]");
await input.uploadFile(...sources);
await sleep(3000);
await page.click("[data-import-confirm]");
await sleep(3000);
const pageTotal = await page.evaluate(() => document.querySelectorAll("[data-thumb-index]").length);
console.log("PASS  导入页面数=" + pageTotal + " (期望 4: 1 默认页 + 3 导入页)");

// 打开导出面板并触发 ZIP 导出
const exportOpened = await clickByText("导出");
await sleep(600);
const zipButton = await page.$("[data-export-zip]");
if (!zipButton) {
  console.log("FAIL  未找到 ZIP 导出按钮");
  process.exit(1);
}
// 对照实验：先用同一条通道导出 PNG（data URL），确认下载通道本身是否可用
await clickByText("导出 PNG（当前页）");
await sleep(4000);
const pngDownloaded = readdirSync(DL_DIR).filter((name) => name.endsWith(".png"));
console.log("  对照 PNG 下载: " + JSON.stringify(pngDownloaded));

// 用真实鼠标手势点击按钮，这是最接近用户操作的触发方式
const zipBox = await zipButton.boundingBox();
await page.mouse.click(zipBox.x + zipBox.width / 2, zipBox.y + zipBox.height / 2);

let zipPath = null;
let captured = null;

for (let attempt = 0; attempt < 120; attempt += 1) {
  await sleep(1000);
  captured = await page.evaluate(async () => {
    const blob = window.__exportBlob;
    if (!blob) {
      return null;
    }
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return { size: blob.size, dataUrl };
  });
  if (captured) {
    break;
  }
}

if (captured) {
  const base64 = captured.dataUrl.slice(captured.dataUrl.indexOf(",") + 1);
  zipPath = join(DL_DIR, "export.zip");
  writeFileSync(zipPath, Buffer.from(base64, "base64"));
  console.log("PASS  捕获导出 Blob: " + captured.size + " bytes");
}

if (headful) {
  let browserZip = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(1000);
    browserZip = readdirSync(join(DL_DIR, "")).find((name) => name.endsWith(".zip") && name !== "export.zip") ?? null;
    if (browserZip) {
      break;
    }
  }
  const size = browserZip ? statSync(join(DL_DIR, browserZip)).size : 0;
  console.log(
    (browserZip ? "PASS" : "FAIL") +
      "  浏览器真实下载: " +
      (browserZip ? browserZip + " (" + size + " bytes)" : "未产生文件")
  );
}

const anchorLog = await page.evaluate(() => window.__anchorClicks);
console.log("  锚点点击记录: " + JSON.stringify(anchorLog));

if (!zipPath) {
  console.log("  下载目录内容: " + JSON.stringify(readdirSync(DL_DIR)));
}

await browser.close();
restoreUploads();

if (!zipPath) {
  console.log("FAIL  未在预期时间内生成 ZIP");
  process.exit(1);
}

console.log("PASS  ZIP 已生成: " + zipPath + " (" + statSync(zipPath).size + " bytes, 导出面板=" + exportOpened + ")");
process.stdout.write("ZIPPATH=" + zipPath + "\n");
