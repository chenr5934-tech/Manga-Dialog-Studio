import puppeteer from "puppeteer-core";

// 导出端到底能扛多大的画布。漫画扫描件常见 4000×6000，A3 300dpi 是 3508×4961，
// 但画布尺寸输入框没有上限 —— 想知道从哪一档开始会出问题。
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1200, height: 800 }
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });

const sizes = [
  [2480, 3508],
  [4000, 6000],
  [6000, 8500],
  [8000, 11000],
  [12000, 16000],
  [16000, 22000],
  [24000, 24000]
];

for (const [width, height] of sizes) {
  const result = await page.evaluate(async (w, h) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    if (!context) {
      return { ok: false, note: "拿不到 2d 上下文" };
    }
    // 画点东西，别让压缩算法在纯色上作弊
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, w, h);
    context.fillStyle = "#1f2937";
    for (let i = 0; i < 400; i += 1) {
      context.fillRect((i * 97) % w, (i * 61) % h, 40, 40);
    }
    const started = performance.now();
    try {
      const data = canvas.toDataURL("image/png");
      const bytes = data.length * 0.75;
      return {
        ok: true,
        ms: Math.round(performance.now() - started),
        mb: (bytes / 1048576).toFixed(1),
        // 抽一个远离填充块的像素，确认画布真的被写进去了
        sample: Array.from(context.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data).join(",")
      };
    } catch (error) {
      return { ok: false, ms: Math.round(performance.now() - started), error: String(error).slice(0, 140) };
    }
  }, width, height);

  const mp = ((width * height) / 1e6).toFixed(0);
  if (result.ok) {
    console.log("  " + (width + "×" + height).padEnd(14) + mp + "MP   ok   " + String(result.ms).padStart(5) + "ms   PNG " + result.mb + "MB");
  } else {
    console.log("  " + (width + "×" + height).padEnd(14) + mp + "MP   **失败**  " + String(result.ms).padStart(5) + "ms   " + (result.error ?? result.note));
  }
}

await browser.close();
