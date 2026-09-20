import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1500);

const r = await page.evaluate(() => {
  const root = document.documentElement;
  const css = getComputedStyle(root, "::before");
  const dim = getComputedStyle(document.body, "::after");
  const probe = document.createElement("div");
  probe.style.backgroundColor = "var(--panel-1)";
  document.body.appendChild(probe);
  const panelColor = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const wallpaper = root.style.getPropertyValue("--ui-wallpaper").trim();
  return {
    state: root.dataset.wallpaper,
    wallpaperKind: wallpaper.startsWith("url(") ? "图片" : wallpaper.includes("gradient") ? "渐变" : wallpaper,
    wallpaperLength: wallpaper.length,
    painted: css.backgroundImage.slice(0, 20),
    dimOpacity: dim.opacity,
    panelAlpha: root.style.getPropertyValue("--ui-panel-alpha").trim(),
    panelColor
  };
});
console.log("壁纸状态: " + r.state);
console.log("壁纸类型: " + r.wallpaperKind + "（" + r.wallpaperLength + " 字符）");
console.log("壁纸层实际背景: " + r.painted);
console.log("压暗层不透明度: " + r.dimOpacity);
console.log("面板透明度变量: " + r.panelAlpha);
console.log("面板底色: " + r.panelColor);
await browser.close();
