import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 }
});
const page = await browser.newPage();
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const r = await page.evaluate(() => {
  const rail = document.querySelector("[data-thumb-rail]");
  const railButtons = rail ? Array.from(rail.querySelectorAll("button")).map((b) => {
    const r2 = b.getBoundingClientRect();
    return { w: Math.round(r2.width), h: Math.round(r2.height), svg: Boolean(b.querySelector("svg")), aria: b.getAttribute("aria-label") ?? "", text: (b.innerText || "").trim() };
  }) : [];
  const svgTotal = document.querySelectorAll("svg").length;
  const unicodeLeft = Array.from(document.querySelectorAll("button")).filter((b) => /^[\u2190-\u27BF\u2B00-\u2BFF]+$/.test((b.innerText || "").trim()) && b.innerText.trim().length > 0).length;
  const sizes = new Map();
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (!own) continue;
    const s = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    sizes.set(s, (sizes.get(s) ?? 0) + 1);
  }
  const range = document.querySelector('input[type="range"]');
  const rangeBox = range ? range.getBoundingClientRect() : null;
  const sel = Array.from(document.styleSheets).some((sh) => {
    try { return Array.from(sh.cssRules ?? []).some((rr) => String(rr.selectorText ?? "").includes("::selection")); } catch { return false; }
  });
  const focusRule = Array.from(document.styleSheets).some((sh) => {
    try { return Array.from(sh.cssRules ?? []).some((rr) => String(rr.selectorText ?? "").includes(":focus-visible")); } catch { return false; }
  });
  return { railButtons, svgTotal, unicodeLeft, sizes: Array.from(sizes.entries()).sort((a, b) => a[0] - b[0]), rangeBox: rangeBox ? { w: Math.round(rangeBox.width), h: Math.round(rangeBox.height) } : null, sel, focusRule };
});

console.log("胶片栏按钮（" + r.railButtons.length + " 个）:");
for (const b of r.railButtons) console.log("  " + b.w + "x" + b.h + "  " + (b.svg ? "SVG" : "文字") + "  aria=" + (b.aria || "(无)") + "  " + b.text);
console.log("\n全页 SVG 图标数: " + r.svgTotal);
console.log("还在用 Unicode 当图标的按钮: " + r.unicodeLeft);
console.log("字号分布: " + r.sizes.map(([s, c]) => s + ":" + c).join("  "));
console.log("滑条可点区域: " + (r.rangeBox ? r.rangeBox.w + "x" + r.rangeBox.h : "无"));
console.log("::selection 已主题化: " + r.sel);
console.log(":focus-visible 规则已注入: " + r.focusRule);

await browser.close();
