import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

console.log("宽度扫描（窗口宽 -> 文档 scrollWidth / clientWidth）");
for (const w of [1720, 1600, 1500, 1440, 1400, 1360, 1320, 1280, 1240, 1200, 1160, 1100, 1024, 900]) {
  await page.setViewport({ width: w, height: 900 });
  await sleep(650);
  const r = await page.evaluate(() => {
    const doc = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    // 找出真正把布局撑宽的元素
    let widest = null;
    for (const el of Array.from(document.querySelectorAll("main *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 200) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed") continue;
      if (!widest || rect.width > widest.w) {
        widest = { w: Math.round(rect.width), el: el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).slice(0, 4).join("."), scrollW: el.scrollWidth, clientW: el.clientWidth };
      }
    }
    // 四栏各自的宽度
    const cols = Array.from(document.querySelectorAll("main > section > *")).map((el) => {
      const r2 = el.getBoundingClientRect();
      return el.tagName.toLowerCase() + ":" + Math.round(r2.width);
    });
    return { doc, widest, cols };
  });
  const over = r.doc.sw > r.doc.cw ? "  << 溢出 " + (r.doc.sw - r.doc.cw) + "px" : "";
  console.log("  " + w + " -> " + r.doc.sw + "/" + r.doc.cw + over);
  console.log("        最宽子元素 " + r.widest.w + "px  " + r.widest.el);
  console.log("        四栏 " + r.cols.join("  "));
}

await browser.close();
