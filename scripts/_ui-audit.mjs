import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8737/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1720, height: 1000 }
});
const page = await browser.newPage();
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector('[data-preset-id="builtin:speech-right"]', { timeout: 30000 });
await sleep(1200);

const probe = () => page.evaluate(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const describe = (el) => {
    let d = el.tagName.toLowerCase();
    if (el.id) d += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      const cls = el.className.split(/\s+/).filter((c) => c && !c.startsWith("hover:")).slice(0, 3);
      if (cls.length) d += "." + cls.join(".");
    }
    const data = Array.from(el.attributes).filter((a) => a.name.startsWith("data-")).map((a) => a.name);
    if (data.length) d += "[" + data.slice(0, 2).join(",") + "]";
    return d.slice(0, 100);
  };

  const ICON = /[\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF\uFF0B\u2715\u2716\u2726]/;
  const fontSizes = new Map();
  const tiny = [];
  const icons = [];
  const over = [];

  for (const el of Array.from(document.querySelectorAll("*"))) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");

    if (ownText) {
      const size = Math.round(parseFloat(s.fontSize) * 10) / 10;
      fontSizes.set(size, (fontSizes.get(size) ?? 0) + 1);
      if (size < 12) tiny.push({ el: describe(el), size, text: ownText.slice(0, 16) });
      if (ownText.length <= 3 && ICON.test(ownText)) icons.push({ el: describe(el), text: ownText, size });
    }

    if (el.matches('button, a, input[type="range"], [role="button"]')) {
      if (r.width < 28 || r.height < 28) {
        tiny.push({ el: describe(el), size: "hit", w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || "").trim().slice(0, 10) });
      }
    }

    if (el.scrollWidth > el.clientWidth + 2 && s.overflowX === "visible" && el.clientWidth > 0) {
      over.push({ el: describe(el), sw: el.scrollWidth, cw: el.clientWidth });
    }
  }

  const squash = (list, key) => {
    const m = new Map();
    for (const item of list) {
      const k = item.el + "|" + (item.text ?? "") + "|" + (item.size ?? "");
      if (!m.has(k)) m.set(k, { ...item, count: 1 });
      else m.get(k).count += 1;
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 40);
  };

  return {
    doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
    fontSizes: Array.from(fontSizes.entries()).sort((a, b) => a[0] - b[0]),
    tinyText: squash(tiny.filter((t) => t.size !== "hit")),
    tinyHits: squash(tiny.filter((t) => t.size === "hit")),
    icons: squash(icons),
    overflow: squash(over)
  };
});

const print = (tag, r) => {
  console.log("\n########## " + tag + " ##########");
  console.log("doc scrollWidth=" + r.doc.sw + " clientWidth=" + r.doc.cw + (r.doc.sw > r.doc.cw ? "  << 有横向滚动" : ""));
  console.log("\n-- 字号分布（px : 节点数）--");
  console.log(r.fontSizes.map(([s, c]) => s + ":" + c).join("  "));
  console.log("\n-- 小于 12px 的文字（共 " + r.tinyText.length + " 类）--");
  for (const t of r.tinyText) console.log("  " + t.size + "px  x" + t.count + "  " + t.el + "  «" + t.text + "»");
  console.log("\n-- 小于 28px 的点击目标（共 " + r.tinyHits.length + " 类）--");
  for (const t of r.tinyHits) console.log("  " + t.w + "x" + t.h + "  x" + t.count + "  " + t.el + "  «" + t.text + "»");
  console.log("\n-- Unicode 当图标用（共 " + r.icons.length + " 类）--");
  for (const t of r.icons) console.log("  x" + t.count + "  " + t.el + "  " + JSON.stringify(t.text));
  console.log("\n-- 内容溢出容器（共 " + r.overflow.length + " 类）--");
  for (const t of r.overflow) console.log("  sw=" + t.sw + " cw=" + t.cw + "  " + t.el);
};

print("初始界面", await probe());

// 打开图层页 + 更多抽屉，再看一遍
await page.evaluate(() => document.querySelector("[data-open-layers]")?.click());
await sleep(700);
print("画布内容页", await probe());
await page.click('[data-drawer="project"]');
await sleep(700);
print("更多抽屉", await probe());

await browser.close();
