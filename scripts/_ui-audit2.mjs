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

const contrast = () => page.evaluate(() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => Number(v.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      const c = parse(s.backgroundColor);
      if (c && c.a > 0.55) return c;
      if (s.backgroundImage && s.backgroundImage !== "none") {
        const base = parse(getComputedStyle(document.documentElement).getPropertyValue("--panel-0"));
        if (base) return base;
      }
      node = node.parentElement;
    }
    const root = parse(getComputedStyle(document.documentElement).getPropertyValue("--bg-0"));
    return root ?? { r: 7, g: 11, b: 17, a: 1 };
  };
  const describe = (el) => {
    let d = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      const cls = el.className.split(/\s+/).filter((c) => c.startsWith("text-[") || c.startsWith("studio-")).slice(0, 2);
      if (cls.length) d += "." + cls.join(".");
    }
    return d.slice(0, 70);
  };

  const bad = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
    if (!ownText || ownText.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const cr = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const large = size >= 18.66 || (size >= 14 && Number(s.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    if (cr < need) bad.push({ el: describe(el), size, ratio: Math.round(cr * 100) / 100, need, text: ownText.slice(0, 16) });
  }
  const m = new Map();
  for (const b of bad) {
    const k = b.el + "|" + b.size + "|" + b.need;
    if (!m.has(k)) m.set(k, { ...b, count: 1 });
    else m.get(k).count += 1;
  }
  return Array.from(m.values()).sort((a, b) => a.ratio - b.ratio).slice(0, 25);
});

console.log("### 对比度不达标（共 " + (await contrast()).length + " 类）");
for (const b of await contrast()) {
  console.log("  " + b.ratio + ":1  (需 " + b.need + ")  " + b.size + "px  x" + b.count + "  " + b.el + "  «" + b.text + "»");
}

// 焦点可见性
const focusReport = await page.evaluate(() => {
  const describe = (el) => {
    let d = el.tagName.toLowerCase();
    if (el.getAttribute("data-tool")) d += "[tool=" + el.getAttribute("data-tool") + "]";
    if (el.className && typeof el.className === "string") {
      const cls = el.className.split(/\s+/).filter((c) => c.startsWith("studio-")).slice(0, 2);
      if (cls.length) d += "." + cls.join(".");
    }
    return d.slice(0, 70);
  };
  window.__focusProbe = [];
  const onFocus = (e) => {
    const el = e.target;
    const s = getComputedStyle(el);
    const visible =
      (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) ||
      (s.boxShadow && s.boxShadow !== "none");
    window.__focusProbe.push({ el: describe(el), visible: Boolean(visible), outline: s.outlineStyle + " " + s.outlineWidth, shadow: String(s.boxShadow).slice(0, 40) });
  };
  document.addEventListener("focusin", onFocus, true);
  return true;
});

for (let i = 0; i < 18; i += 1) {
  await page.keyboard.press("Tab");
  await sleep(90);
}
const probes = await page.evaluate(() => window.__focusProbe ?? []);
console.log("\n### Tab 焦点可见性（前 " + probes.length + " 个可聚焦元素）");
for (const p of probes) {
  console.log("  " + (p.visible ? "有焦点样式" : "**无焦点指示**") + "  " + p.el + "   outline=" + p.outline);
}

// 浏览器表面
const surfaces = await page.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const sel = getComputedStyle(document.documentElement);
  return {
    caret: sel.caretColor,
    selectionRule: Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules ?? []).some((r) => String(r.selectorText ?? "").includes("::selection"));
      } catch { return false; }
    }),
    tabSize: root.tabSize
  };
});
console.log("\n### 浏览器表面");
console.log("  ::selection 规则存在 = " + surfaces.selectionRule + "（false 说明选中文字还是浏览器默认蓝）");
console.log("  caret-color = " + surfaces.caret + "（inherit 说明继承文字色，通常可接受）");

// 窄屏溢出
for (const [w, h] of [[1440, 900], [1280, 800], [1100, 700]]) {
  await page.setViewport({ width: w, height: h });
  await sleep(900);
  const r = await page.evaluate(() => {
    const doc = { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    const hits = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === "visible") {
        hits.push(el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).slice(0, 3).join(".") + " sw=" + el.scrollWidth + " cw=" + el.clientWidth);
      }
    }
    return { doc, hits: hits.slice(0, 6) };
  });
  console.log("\n### 窄屏 " + w + "x" + h + "  doc=" + r.doc.sw + "/" + r.doc.cw + (r.doc.sw > r.doc.cw ? " <<横向滚动" : ""));
  for (const hit of r.hits) console.log("   " + hit);
}

await browser.close();
