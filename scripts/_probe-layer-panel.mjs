import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

// 用户的配置正好是这次问题的现场：浅色壁纸 + 面板透明度 60%。
// 只读不改，直接在真实设置下量「画布内容」栏。
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const config = JSON.parse(readFileSync("config/ui.json", "utf8"));
console.log("当前配置：壁纸=" + (config.wallpaper || "(无)") + "  面板透明度=" + config.panelOpacity + "%  压暗=" + config.wallpaperDim);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 900 }
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8737/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1500);

// 加两个气泡，让「画布内容」栏里有行可看
await page.click('[data-tool="presets"]');
await sleep(500);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[0]?.click());
await sleep(700);
await page.evaluate(() => document.querySelectorAll("[data-preset-id]")[2]?.click());
await sleep(700);

const opened = await page.evaluate(() => {
  const button = document.querySelector("[data-open-layers]");
  if (!button) return false;
  button.click();
  return true;
});
await sleep(1000);
console.log("切到「画布内容」：" + opened);

const report = await page.evaluate(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => Number(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const panel = document.querySelector("[data-layer-panel]");
  if (!panel) return { error: "没找到面板" };
  const s = getComputedStyle(panel);

  // 面板底 → 往下一层层合成，看到底最终落在什么颜色上
  let stack = [];
  let node = panel.parentElement;
  while (node && node !== document.documentElement) {
    const c = parse(getComputedStyle(node).backgroundColor);
    if (c && c.a > 0) stack.push(c);
    if (c && c.a >= 0.999) break;
    node = node.parentElement;
  }
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor) ?? { r: 10, g: 12, b: 16, a: 1 };
  let effective = bodyBg;
  for (let i = stack.length - 1; i >= 0; i -= 1) effective = blend(stack[i], effective);
  const panelBg = parse(s.backgroundColor);
  const painted = panelBg ? blend(panelBg, effective) : effective;

  const rows = [];
  for (const el of Array.from(panel.querySelectorAll("p, span, button"))) {
    const text = (el.innerText ?? "").trim();
    if (!text || text.length < 2) continue;
    const color = parse(getComputedStyle(el).color);
    if (!color) continue;
    const fg = color.a < 1 ? blend(color, painted) : color;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) continue;
    rows.push({ text: text.slice(0, 14), size: Math.round(parseFloat(getComputedStyle(el).fontSize)), cr: Math.round(ratio(fg, painted) * 100) / 100 });
  }
  return {
    panelBg: s.backgroundColor,
    panelRadius: s.borderRadius,
    effective: "rgb(" + Math.round(painted.r) + "," + Math.round(painted.g) + "," + Math.round(painted.b) + ")",
    rows: rows.slice(0, 8)
  };
});
console.log(JSON.stringify(report, null, 1));

await browser.close();
process.exitCode = 0;
