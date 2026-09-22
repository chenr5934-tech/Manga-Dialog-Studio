import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 复核 PDF：上次 10 页是"复制"出来的，内容逐字节相同，
// jsPDF 对重复图片会去重，所以只嵌入 1 张是合理的。
// 这次让每一页的气泡数量都不同，再看图片对象数。
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 }
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));
await page.evaluateOnNewDocument(() => {
  window.__pdf = null;
  const original = URL.createObjectURL;
  URL.createObjectURL = function (target) {
    if (target instanceof Blob && target.type.includes("pdf")) window.__pdf = target;
    return original.call(this, target);
  };
});
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const clickByText = async (label) => {
  for (const handle of await page.$$("button")) {
    const text = await handle.evaluate((el) => (el.innerText ?? "").trim());
    if (text === label) { await handle.evaluate((el) => el.click()); return true; }
  }
  return false;
};
const addBubble = async () => {
  await page.evaluate(() => document.querySelector("[data-preset-id]")?.click());
  await sleep(650);
};
const bubbleCount = () => page.evaluate(() => (document.body.innerText.match(/文字\s*(\d+)/) ?? [])[1] ?? "?");

await page.click('[data-tool="presets"]');
await sleep(500);

// 第 1 页 1 个气泡，第 2 页 2 个……第 6 页 6 个，页页不同
const PAGES = 6;
for (let index = 0; index < PAGES; index += 1) {
  await addBubble();
  if (index < PAGES - 1) {
    await page.evaluate(() => document.querySelector("[data-page-duplicate]")?.click());
    await sleep(700);
  }
}
const total = await page.evaluate(() => (document.body.innerText.match(/Page\s*\d+\s*\/\s*(\d+)/) ?? [])[1] ?? "?");
console.log("页数=" + total + "，当前页气泡数=" + (await bubbleCount()));

await clickByText("导出");
await sleep(600);
await clickByText("导出 PDF（全部页）");
for (let attempt = 0; attempt < 120; attempt += 1) {
  await sleep(1000);
  if (await page.evaluate(() => Boolean(window.__pdf))) break;
}

const info = await page.evaluate(async () => {
  const blob = window.__pdf;
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return {
    kb: Math.round(bytes.length / 1024),
    pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
    images: (text.match(/\/Subtype\s*\/Image/g) ?? []).length
  };
});

console.log("PDF：" + (info ? info.kb + "KB  页对象=" + info.pages + "  图片对象=" + info.images : "**没产出**"));
console.log(info && info.pages === PAGES && info.images === PAGES
  ? "结论：每页各不相同的画面，都各自嵌了一张图 —— PDF 导出正常"
  : "结论：**两者对不上，PDF 可能有页丢了画面**");
console.log("页面异常：" + (errors.length ? errors[0] : "无"));
await browser.close();
process.exitCode = 0;
